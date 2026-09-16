import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NAME, VERSION, DESCRIPTION } from "../lib/meta.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

// The server advertises these over MCP. They are literals so the esbuild
// bundle can run outside the repo, which means nothing else keeps them in step
// with package.json — this does.
describe("lib/meta.js", () => {
  it("matches package.json name", () => {
    assert.equal(NAME, pkg.name);
  });

  it("matches package.json version", () => {
    assert.equal(VERSION, pkg.version);
  });

  it("matches package.json description", () => {
    assert.equal(DESCRIPTION, pkg.description);
  });
});
