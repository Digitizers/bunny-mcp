import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectResponse,
  projectStorageListing,
  shapeFor,
  normalisePath,
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
