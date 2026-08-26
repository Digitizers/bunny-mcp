import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { guardRegistration, installProjection, readOnlyFromEnv } from "../lib/guard.js";

function fakeServer() {
  const registered = [];
  return {
    registered,
    tool(name, _d, _s, _a, _h) { registered.push(name); return name; },
  };
}

// ─── The registration gate ───────────────────────────────────────────────────

test("read-only mode withholds anything that is not declared read-only", () => {
  const srv = fakeServer();
  const { server, withheld } = guardRegistration(srv, true);

  server.tool("bunny_list_pull_zones", "", {}, { readOnlyHint: true }, () => {});
  server.tool("bunny_delete_pull_zone", "", {}, { destructiveHint: true }, () => {});
  server.tool("bunny_update_pull_zone", "", {}, { readOnlyHint: false }, () => {});

  assert.deepEqual(srv.registered, ["bunny_list_pull_zones"]);
  assert.deepEqual(withheld, ["bunny_delete_pull_zone", "bunny_update_pull_zone"]);
});

test("an unannotated tool is withheld — the gate fails closed", () => {
  // The failure this guards against: someone adds a delete tool and forgets the
  // annotations. Gating on "declares destructiveHint" would register it.
  const srv = fakeServer();
  const { server, withheld } = guardRegistration(srv, true);

  server.tool("bunny_delete_everything", "", {}, undefined, () => {});
  server.tool("bunny_delete_everything_else", "", {}, {}, () => {});

  assert.deepEqual(srv.registered, []);
  assert.equal(withheld.length, 2);
});

test("with the gate off, every tool registers", () => {
  const srv = fakeServer();
  const { server, withheld } = guardRegistration(srv, false);
  server.tool("a", "", {}, { readOnlyHint: true }, () => {});
  server.tool("b", "", {}, { destructiveHint: true }, () => {});
  assert.deepEqual(srv.registered, ["a", "b"]);
  assert.deepEqual(withheld, []);
});

// ─── The environment switch ──────────────────────────────────────────────────

test("read-only is the default, and only an explicit off turns it off", () => {
  assert.equal(readOnlyFromEnv({}), true, "unset means on");
  assert.equal(readOnlyFromEnv({ BUNNY_READONLY: "" }), true);
  assert.equal(readOnlyFromEnv({ BUNNY_READONLY: "1" }), true);
  assert.equal(readOnlyFromEnv({ BUNNY_READONLY: "yes" }), true);
  assert.equal(readOnlyFromEnv({ BUNNY_READONLY: "banana" }), true, "a typo must not disarm the gate");

  for (const off of ["0", "false", "FALSE", "no", "off", " off "]) {
    assert.equal(readOnlyFromEnv({ BUNNY_READONLY: off }), false, `${off} turns it off`);
  }
});

// ─── The interceptor ─────────────────────────────────────────────────────────

test("the interceptor projects before a tool ever sees the payload", async () => {
  const http = axios.create();
  installProjection(http, "api");
  const [fulfilled] = http.interceptors.response.handlers
    .filter(Boolean)
    .map((h) => [h.fulfilled]);

  const res = fulfilled[0]({
    config: { url: "/pullzone" },
    headers: { "content-type": "application/json" },
    data: [{ Id: 1, Name: "z", ZoneSecurityKey: "secret" }],
  });
  assert.equal("ZoneSecurityKey" in res.data[0], false);
});

test("an undeclared path throws rather than returning the raw payload", () => {
  const http = axios.create();
  installProjection(http, "api");
  const handler = http.interceptors.response.handlers.filter(Boolean)[0].fulfilled;

  assert.throws(
    () => handler({
      config: { url: "/brand/new/route" },
      headers: { "content-type": "application/json" },
      data: { Secret: "x" },
    }),
    /No response projection is declared/,
  );
});

test("a non-JSON body is streamed through untouched", () => {
  const http = axios.create();
  installProjection(http, "api");
  const handler = http.interceptors.response.handlers.filter(Boolean)[0].fulfilled;

  const body = Buffer.from("binary file content");
  const res = handler({
    config: { url: "/whatever/file.png" },
    headers: { "content-type": "image/png" },
    data: body,
  });
  assert.equal(res.data, body, "a download is the operator's own content, not account metadata");
});
