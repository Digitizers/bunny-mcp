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

test("a JSON file download is not mistaken for a directory listing", () => {
  // Round-1 P2: the storage tools ask for an arraybuffer, but a stored .json
  // file comes back as `application/json`. Discriminating on content-type alone
  // handed the operator's file to the listing projector, which reduced it to
  // `{}` and reported success. The REQUEST is the discriminator.
  const http = axios.create();
  installProjection(http, "storage");
  const handler = http.interceptors.response.handlers.filter(Boolean)[0].fulfilled;

  const file = Buffer.from(JSON.stringify({ my: "config", nested: { deep: true } }));
  const res = handler({
    config: { url: "/assets/config.json", responseType: "arraybuffer" },
    headers: { "content-type": "application/json" },
    data: file,
  });
  assert.equal(res.data, file, "the operator's own file must survive whole");

  // …while an actual listing on the same host is still projected.
  const listing = handler({
    config: { url: "/assets/" },
    headers: { "content-type": "application/json" },
    data: [{ ObjectName: "a.png", Password: "leaked" }],
  });
  assert.equal("Password" in listing.data[0], false);
});

test("the rejection interceptor projects error bodies", async () => {
  const http = axios.create();
  installProjection(http, "api");
  const rejected = http.interceptors.response.handlers.filter(Boolean)[0].rejected;
  assert.equal(typeof rejected, "function", "a rejection handler must be installed at all");

  // A write that echoes what it was given.
  await assert.rejects(
    () => rejected({
      config: { url: "/compute/script/1/secrets", data: JSON.stringify({ Value: "sk_live_x" }) },
      response: { status: 400, data: { Message: "Invalid value: sk_live_x", ErrorKey: "bad" } },
    }),
    (err) => {
      assert.ok(!String(err.response.data.Message).includes("sk_live_x"));
      assert.equal(err.response.data.ErrorKey, "bad");
      return true;
    },
  );

  // A read cannot have its own payload quoted back.
  await assert.rejects(
    () => rejected({
      config: { url: "/pullzone/999" },
      response: { status: 404, data: { Message: "Pull zone not found", ErrorKey: "notfound" } },
    }),
    (err) => {
      assert.match(err.response.data.Message, /not found/i, "diagnostics survive a GET");
      return true;
    },
  );
});

test("a network error with no response still propagates", async () => {
  const http = axios.create();
  installProjection(http, "api");
  const rejected = http.interceptors.response.handlers.filter(Boolean)[0].rejected;
  const boom = new Error("ECONNRESET");
  await assert.rejects(() => rejected(boom), (err) => err === boom);
});
