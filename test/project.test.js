import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectResponse,
  projectStorageListing,
  shapeFor,
  normalisePath,
  projectErrorBody,
  PASSTHROUGH,
} from "../lib/project.js";

// ─── The secrets, named ──────────────────────────────────────────────────────
//
// One case per credential Bunny returns inline. Each asserts the value is gone
// AND that the surrounding metadata survived — a projector that returned {} for
// everything would pass a leak test and be useless, so both halves are checked.

test("a pull zone loses its token-authentication key and keeps its identity", () => {
  const raw = {
    Items: [{
      Id: 5032500,
      Name: "achdutnow",
      OriginUrl: "https://achdutnow.org.il",
      Enabled: true,
      ZoneSecurityEnabled: false,
      ZoneSecurityKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      Hostnames: [{ Id: 1, Value: "achdutnow.b-cdn.net", HasCertificate: true, Certificate: "MIIF…", CertificateKey: "-----BEGIN PRIVATE KEY-----" }],
    }],
    CurrentPage: 1,
    TotalItems: 1,
    HasMoreItems: false,
  };
  const out = projectResponse("/pullzone?page=1&perPage=1000", raw);
  assert.equal(out.ok, true);
  const zone = out.data.Items[0];

  assert.equal("ZoneSecurityKey" in zone, false);
  assert.equal(zone.Name, "achdutnow");
  assert.equal(zone.ZoneSecurityEnabled, false, "the flag is the operational answer and must survive");
  assert.equal(out.data.TotalItems, 1, "pagination counters survive");

  const host = zone.Hostnames[0];
  assert.equal(host.Value, "achdutnow.b-cdn.net");
  assert.equal(host.HasCertificate, true);
  assert.equal("Certificate" in host, false, "the certificate is nested one level down — projection must recurse");
  assert.equal("CertificateKey" in host, false, "and so is its private key");
});

test("a storage zone loses both passwords", () => {
  const out = projectResponse("/storagezone", [{
    Id: 7, Name: "assets", Region: "DE", StorageUsed: 42,
    Password: "read-write-secret", ReadOnlyPassword: "read-secret",
  }]);
  assert.equal(out.ok, true);
  assert.equal("Password" in out.data[0], false);
  assert.equal("ReadOnlyPassword" in out.data[0], false);
  assert.equal(out.data[0].Name, "assets");
});

test("a video library loses its api keys", () => {
  const out = projectResponse("/videolibrary/99", {
    Id: 99, Name: "clips", VideoCount: 3,
    ApiKey: "k", ReadOnlyApiKey: "r", WebhookSignatureKey: "w",
  });
  assert.equal(out.ok, true);
  for (const k of ["ApiKey", "ReadOnlyApiKey", "WebhookSignatureKey"]) {
    assert.equal(k in out.data, false, `${k} must not survive`);
  }
  assert.equal(out.data.Name, "clips");
});

test("the account loses the api key the server itself authenticates with", () => {
  const out = projectResponse("/user", { Id: 1, Email: "a@b.c", ApiKey: "the-account-key", Balance: 12 });
  assert.equal(out.ok, true);
  assert.equal("ApiKey" in out.data, false);
  assert.equal(out.data.Email, "a@b.c");
});

test("a storage listing keeps file metadata and nothing else", () => {
  const out = projectStorageListing([{
    Guid: "g", ObjectName: "logo.png", Length: 10, IsDirectory: false,
    StorageZoneName: "assets", Password: "leaked",
  }]);
  assert.equal("Password" in out[0], false);
  assert.equal(out[0].ObjectName, "logo.png");
});

// ─── The allow-list property ─────────────────────────────────────────────────

test("a field Bunny adds tomorrow does not ship in the clear", () => {
  // The whole reason this is an allow-list: nobody edits project.js when Bunny
  // ships a new field, so the new field must be absent by default.
  const out = projectResponse("/pullzone/1", {
    Id: 1, Name: "z", SomeFutureSigningSecret: "surprise",
  });
  assert.equal(out.ok, true);
  assert.equal("SomeFutureSigningSecret" in out.data, false);
});

test("an undeclared path returns no data and says which path to declare", () => {
  const out = projectResponse("/some/new/endpoint", { Secret: "value" });
  assert.equal(out.ok, false);
  assert.match(out.error, /\/some\/new\/endpoint/);
  assert.match(out.error, /project\.js/);
});

test("passthrough is a declared decision, not a fallback", () => {
  assert.equal(shapeFor("/statistics"), PASSTHROUGH);
  assert.equal(shapeFor("/nope"), null, "an unknown path is null, never PASSTHROUGH");
});

// ─── Path handling ───────────────────────────────────────────────────────────

test("query strings, fragments and trailing slashes do not defeat matching", () => {
  assert.notEqual(shapeFor("/pullzone?page=2"), null);
  assert.notEqual(shapeFor("/pullzone/"), null);
  assert.notEqual(shapeFor("/pullzone/5032500?includeCertificate=true"), null);
  assert.equal(normalisePath("/pullzone/?a=1#x"), "/pullzone");
});

test("a more specific route wins over its collection", () => {
  assert.equal(shapeFor("/pullzone/1/purgeCache"), PASSTHROUGH);
  assert.notEqual(shapeFor("/pullzone/1"), PASSTHROUGH);
});

// ─── Envelopes ───────────────────────────────────────────────────────────────

test("a camel-case Stream envelope is recognised, not flattened to nothing", () => {
  // Round-2 P2: Bunny is two APIs wearing one name. The management API answers
  // `{ Items, CurrentPage, ... }`; Stream answers `{ items, currentPage, ... }`.
  // Matching only the first treated a whole video listing as one resource,
  // matched none of its fields, and returned `{}` — every video discarded while
  // the call reported success.
  const raw = {
    totalItems: 2,
    currentPage: 1,
    itemsPerPage: 100,
    items: [
      { guid: "a", title: "one", views: 3, thumbnailFileName: "t.jpg" },
      { guid: "b", title: "two", views: 9 },
    ],
  };
  const out = projectResponse("/library/5/videos", raw);
  assert.equal(out.ok, true);
  assert.equal(out.data.items.length, 2, "every video survives");
  assert.equal(out.data.items[0].title, "one");
  assert.equal(out.data.totalItems, 2, "the page counters survive too");
  assert.equal(out.data.currentPage, 1);
});

test("both envelope casings project their entries", () => {
  const upper = projectResponse("/pullzone", { Items: [{ Id: 1, Name: "z", ZoneSecurityKey: "s" }], TotalItems: 1 });
  assert.equal("ZoneSecurityKey" in upper.data.Items[0], false);

  const lower = projectResponse("/library/5/collections", { items: [{ guid: "g", name: "c" }], totalItems: 1 });
  assert.equal(lower.data.items[0].name, "c");
});

test("a shape that fits nothing raises instead of returning an empty object", () => {
  // Silence is what turned the envelope bug into a bug rather than an error.
  assert.throws(
    () => projectResponse("/pullzone/1", { totallyDifferent: 1, alsoUnexpected: 2 }),
    /matched no fields/,
  );
});

test("an empty payload is not mistaken for a mismatched shape", () => {
  const out = projectResponse("/pullzone/1", {});
  assert.equal(out.ok, true);
  assert.deepEqual(out.data, {});
});

// ─── Error bodies ────────────────────────────────────────────────────────────

test("an error message is withheld when the request could be quoted back", () => {
  // Round-3 P2: axios routes a non-2xx to the REJECTION handler, so error
  // bodies bypassed the response projector entirely — and handleToolError
  // forwards body.Message verbatim. Bunny quotes submitted values back in
  // validation errors, and what these tools submit includes edge-script secrets.
  const body = { Message: "Invalid value: sk_live_abcdef123456", ErrorKey: "invalid.value", HttpCode: 400 };

  const sent = projectErrorBody(body, true);
  assert.ok(!String(sent.Message).includes("sk_live"), "a submitted value must not come back");
  assert.equal(sent.ErrorKey, "invalid.value", "the diagnosis survives");
  assert.equal(sent.HttpCode, 400);

  const notSent = projectErrorBody(body, false);
  assert.match(notSent.Message, /Invalid value/, "a GET cannot have its own payload echoed — keep the message");
});

test("an error body's unknown fields never survive", () => {
  const out = projectErrorBody({ ErrorKey: "e", EchoedRequest: { Password: "hunter2" } }, false);
  assert.equal("EchoedRequest" in out, false);
});

test("a string error body is withheld when a payload was sent", () => {
  // There is no way to tell an echo from a description inside a bare string.
  assert.match(String(projectErrorBody("Invalid value: sk_live_x", true).Message), /withheld/);
  assert.equal(projectErrorBody("Not found", false), "Not found");
});

// ─── Edge rules ──────────────────────────────────────────────────────────────

test("a pull zone keeps its edge rules but not their free-text parameters", () => {
  const out = projectResponse("/pullzone/1", {
    Id: 1,
    Name: "z",
    EdgeRules: [{
      Guid: "g1",
      ActionType: 3,
      Enabled: true,
      Description: "add auth header",
      ActionParameter1: "Authorization",
      ActionParameter2: "Bearer sk_live_secret",
      Triggers: [{ PatternMatches: ["https://origin/?token=abc"] }],
    }],
  });
  assert.equal(out.ok, true);
  const rule = out.data.EdgeRules[0];
  assert.equal(rule.Description, "add auth header", "the rule is still inspectable");
  assert.equal(rule.Enabled, true);
  assert.equal("ActionParameter1" in rule, false);
  assert.equal("ActionParameter2" in rule, false, "an operator types credentials here");
  assert.equal("Triggers" in rule, false, "pattern matches carry tokenised URLs");
});

// ─── Structure is never vetted by naming its parent ──────────────────────────

test("an allow-listed field cannot smuggle an unvetted object through", () => {
  // Four review rounds, and every leak in this file lived one level below a
  // name somebody had already vetted: Hostnames held the TLS private key;
  // EdgeRules got a shape and ExtraActions inside it still carried the
  // ActionParameter2 that shape existed to drop. So a bare field name may only
  // carry a scalar — structure survives only where a shape is declared for it.
  const out = projectResponse("/pullzone/1", {
    Id: 1,
    Name: "z",
    EdgeRules: [{
      Guid: "g",
      ActionType: 3,
      Enabled: true,
      ExtraActions: [{ ActionType: 4, ActionParameter1: "Authorization", ActionParameter2: "Bearer sk_live_x" }],
    }],
  });
  const extra = out.data.EdgeRules[0].ExtraActions[0];
  assert.equal(extra.ActionType, 4, "the extra action is still visible");
  assert.equal("ActionParameter2" in extra, false, "a second header action is where the SECOND credential is typed");
});

test("a scalar array passes; an object array without a shape does not", () => {
  const out = projectResponse("/storagezone/1", {
    Id: 1,
    Name: "assets",
    ReplicationRegions: ["DE", "NY"],
    PullZones: [{ Id: 9, Name: "cdn", Password: "leaked" }],
  });
  assert.deepEqual(out.data.ReplicationRegions, ["DE", "NY"], "scalars have no interior to hide in");
  assert.equal(out.data.PullZones[0].Name, "cdn", "a declared nested shape survives");
  assert.equal("Password" in out.data.PullZones[0], false);
});

test("an edge-rule write answers with the rule, so it is projected like a read", () => {
  // A write path that returns a resource is a read path wearing a different verb.
  const out = projectResponse("/pullzone/1/edgerules/addOrUpdate", {
    Guid: "g", ActionType: 3, Enabled: true,
    ActionParameter1: "Authorization", ActionParameter2: "Bearer sk_live_x",
  });
  assert.equal(out.ok, true);
  assert.equal("ActionParameter2" in out.data, false);
  assert.equal(shapeFor("/pullzone/1/edgerules/5/setEdgeRuleEnabled"), PASSTHROUGH, "status-only stays passthrough");
});
