import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCache, buildQueryString, formatResponse, formatError, handleToolError, pageParam, perPageParam, dateFromParam, dateToParam, idParam } from "../lib/helpers.js";

// ─── createCache ────────────────────────────────────────────────────────────

describe("createCache", () => {
  it("returns undefined for missing key", () => {
    const cache = createCache();
    assert.equal(cache.get("missing"), undefined);
  });

  it("stores and retrieves values", () => {
    const cache = createCache();
    cache.set("key", { value: 42 });
    assert.deepEqual(cache.get("key"), { value: 42 });
  });

  it("expires entries after TTL", async () => {
    const cache = createCache({ ttl: 50 });
    cache.set("key", "data");
    assert.equal(cache.get("key"), "data");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(cache.get("key"), undefined);
  });

  it("evicts oldest entry when at capacity", () => {
    const cache = createCache({ max: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.get("b"), 2);
    assert.equal(cache.get("c"), 3);
  });

  it("reports size", () => {
    const cache = createCache();
    assert.equal(cache.size, 0);
    cache.set("a", 1);
    assert.equal(cache.size, 1);
  });

  it("clears all entries", () => {
    const cache = createCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get("a"), undefined);
  });
});

// ─── buildQueryString ───────────────────────────────────────────────────────

describe("buildQueryString", () => {
  it("returns empty string for empty params", () => {
    assert.equal(buildQueryString({}), "");
  });

  it("filters undefined and null values", () => {
    assert.equal(buildQueryString({ a: 1, b: undefined, c: null, d: "x" }), "?a=1&d=x");
  });

  it("encodes special characters", () => {
    const qs = buildQueryString({ q: "hello world" });
    assert.equal(qs, "?q=hello%20world");
  });

  it("handles boolean and number values", () => {
    const qs = buildQueryString({ enabled: true, count: 5 });
    assert.equal(qs, "?enabled=true&count=5");
  });
});

// ─── formatResponse ─────────────────────────────────────────────────────────

describe("formatResponse", () => {
  it("wraps data in MCP content format", () => {
    const result = formatResponse({ id: 1 });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.deepEqual(JSON.parse(result.content[0].text), { id: 1 });
  });

  it("does not set isError", () => {
    const result = formatResponse("ok");
    assert.equal(result.isError, undefined);
  });
});

// ─── formatError ────────────────────────────────────────────────────────────

describe("formatError", () => {
  it("returns error format with isError true", () => {
    const result = formatError("bad request");
    assert.equal(result.content[0].text, "bad request");
    assert.equal(result.isError, true);
  });
});

// ─── handleToolError ────────────────────────────────────────────────────────

describe("handleToolError", () => {
  it("formats HTTP error with BunnyCDN error body", () => {
    const err = {
      response: {
        status: 404,
        data: { ErrorKey: "pullZone.not_found", Field: "PullZone", Message: "The requested Pull Zone was not found" },
      },
    };
    const result = handleToolError(err);
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("404"));
    assert.ok(result.content[0].text.includes("The requested Pull Zone was not found"));
  });

  it("formats HTTP error without body", () => {
    const err = { response: { status: 500, data: null } };
    const result = handleToolError(err);
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("500"));
  });

  it("formats network error", () => {
    const err = { message: "ECONNREFUSED" };
    const result = handleToolError(err);
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("ECONNREFUSED"));
  });
});

// ─── Reusable Zod Params ────────────────────────────────────────────────────

describe("reusable zod params", () => {
  it("pageParam creates valid zod schema", () => {
    const schema = pageParam();
    assert.equal(schema.safeParse(1).success, true);
    assert.equal(schema.safeParse(0).success, false);
    assert.equal(schema.safeParse(undefined).success, true);
  });

  it("perPageParam creates valid zod schema", () => {
    const schema = perPageParam();
    assert.equal(schema.safeParse(100).success, true);
    assert.equal(schema.safeParse(1001).success, false);
  });

  it("dateFromParam creates valid zod schema", () => {
    const schema = dateFromParam();
    assert.equal(schema.safeParse("2026-01-01").success, true);
    assert.equal(schema.safeParse(undefined).success, true);
  });

  it("dateToParam creates valid zod schema", () => {
    const schema = dateToParam();
    assert.equal(schema.safeParse("2026-12-31").success, true);
  });

  it("idParam creates valid zod schema with label", () => {
    const schema = idParam("Pull Zone");
    assert.equal(schema.safeParse(1).success, true);
    assert.equal(schema.safeParse(-1).success, false);
    assert.equal(schema.safeParse(0).success, false);
    assert.ok(schema.description.includes("Pull Zone"));
  });
});

// ─── loadApiKey ─────────────────────────────────────────────────────────────

import { loadApiKey } from "../lib/helpers.js";

describe("loadApiKey", () => {
  const readOk = () => "  key-from-file\n";
  const readThrows = () => { throw new Error("ENOENT"); };

  it("prefers BUNNY_API_KEY over the file", () => {
    assert.equal(loadApiKey({ BUNNY_API_KEY: "env-key", BUNNY_API_KEY_FILE: "/x" }, readOk), "env-key");
  });

  it("reads and trims the file when only BUNNY_API_KEY_FILE is set", () => {
    assert.equal(loadApiKey({ BUNNY_API_KEY_FILE: "/x" }, readOk), "key-from-file");
  });

  it("returns null when the file cannot be read", () => {
    assert.equal(loadApiKey({ BUNNY_API_KEY_FILE: "/x" }, readThrows), null);
  });

  it("returns null for a whitespace-only file", () => {
    assert.equal(loadApiKey({ BUNNY_API_KEY_FILE: "/x" }, () => "  \n"), null);
  });

  it("returns null when neither variable is set", () => {
    assert.equal(loadApiKey({}, readOk), null);
  });
});
