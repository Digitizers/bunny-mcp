import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shapeFor } from "../lib/project.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "..", "lib", "tools");

/**
 * Every request path the tool modules can build, read out of their source.
 *
 * The route table is an allow-list that fails closed, which means a path
 * nobody declared does not leak — it breaks. The first review round of this
 * fork found seven such breaks, and every one was the same mistake: the table
 * was written by reading the Bunny docs instead of reading the callers.
 *
 * So the callers are the source of truth. This derives the path set from them,
 * and a tool added later is covered on the day it is written rather than the
 * day someone remembers.
 */
function pathsUsedByTools() {
  const found = new Set();

  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(TOOLS_DIR, file), "utf-8");

    // Template literals and plain strings that look like API paths, whether
    // passed straight to the client or assigned to a variable first (the edge
    // scripting tools build `basePath` and then append to it).
    for (const m of src.matchAll(/[`"'](\/[A-Za-z0-9_\-./${}]*)[`"']/g)) {
      found.add(m[1]);
    }
  }
  return [...found];
}

/** `${id}` and friends stand in for a value; give the matcher a plausible one. */
function concretise(template) {
  return template
    .replace(/\$\{qs\}/g, "")
    .replace(/\$\{[^}]*(?:id|Id|ID)\}/g, "12345")
    .replace(/\$\{[^}]*\}/g, "abc");
}

test("every path the tools can request has a declared shape", () => {
  const undeclared = [];

  for (const template of pathsUsedByTools()) {
    const path = concretise(template);

    // Not every quoted string starting with "/" is a request path — cache keys,
    // descriptions and regexes live in these files too. A path segment that is
    // not a known Bunny root is not this test's business.
    if (!/^\/(pullzone|purge|storagezone|dnszone|library|videolibrary|compute|shield|mc|user|billing|statistics|country|region|search)\b/i.test(path)) {
      continue;
    }
    if (shapeFor(path) === null) undeclared.push(`${template}  ->  ${path}`);
  }

  assert.deepEqual(
    undeclared,
    [],
    `these tool request paths have no entry in ROUTES:\n  ${undeclared.join("\n  ")}`,
  );
});

/**
 * The edge-scripting tools compose `${basePath}/${resource_id}`, where
 * basePath is itself a template. Static extraction sees the two halves and
 * never the whole, so the composed shapes are asserted by name — the one place
 * this test knowingly hand-lists, called out so nobody mistakes it for
 * coverage the extractor provides.
 */
test("composed paths the extractor cannot see are declared too", () => {
  for (const path of [
    "/compute/script/12345/variables/9",
    "/compute/script/12345/secrets/9",
    "/compute/script/12345/publish/6f1c-uuid",
    "/mc/apps/abc/deploy",
    "/mc/apps/abc/undeploy",
    "/mc/apps/abc/restart",
    "/library/12345/videos/abc/statistics",
    "/12345/2026-08-26", // origin logging, on its own host
  ]) {
    assert.notEqual(shapeFor(path), null, `undeclared: ${path}`);
  }
});

/**
 * The narrowest shape in the table, and the reason the table cannot be lazy:
 * this endpoint returns each entry's VALUE. Variables share the secrets shape
 * because an operator putting an API key in a plain variable is the normal
 * thing to do, not a misuse.
 */
test("edge script variables and secrets never return their values", () => {
  for (const path of ["/compute/script/1/secrets", "/compute/script/1/variables"]) {
    const shape = shapeFor(path);
    assert.ok(Array.isArray(shape), `${path} must have a field shape, not passthrough`);
    assert.ok(!shape.includes("Value"), `${path} must not return Value`);
    assert.ok(shape.includes("Name"), `${path} must still identify the entry`);
  }
});
