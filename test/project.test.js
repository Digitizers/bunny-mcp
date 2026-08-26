import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// ─── What the structural rule must NOT cost ──────────────────────────────────

test("a video keeps its chapters, moments and transcoding notes", () => {
  const out = projectResponse("/library/5/videos/abc", {
    guid: "abc", title: "v",
    chapters: [{ title: "Intro", start: 0, end: 30 }],
    moments: [{ label: "demo", timestamp: 90 }],
    transcodingMessages: [{ level: 1, issueCode: 3, message: "low bitrate" }],
    metaTags: [{ property: "token", value: "sk_live_x" }],
  });
  assert.equal(out.data.chapters[0].title, "Intro", "the tool promises chapters");
  assert.equal(out.data.moments[0].timestamp, 90);
  assert.equal(out.data.transcodingMessages[0].message, "low bitrate");
  assert.equal("metaTags" in out.data, false, "a free-form operator bag stays dropped");
});

test("a video library reports whether token auth is on, without any key", () => {
  // The same distinction PULL_ZONE draws: the STATE is the operational answer,
  // the KEY is the secret. Knowing signing is on requires no key.
  const out = projectResponse("/videolibrary/9", {
    Id: 9, Name: "clips",
    EnableTokenAuthentication: true, EnableTokenIPVerification: false,
    ApiKey: "k", WebhookSignatureKey: "w",
  });
  assert.equal(out.data.EnableTokenAuthentication, true);
  assert.equal(out.data.EnableTokenIPVerification, false);
  assert.equal("ApiKey" in out.data, false);
  assert.equal("WebhookSignatureKey" in out.data, false);
});

test("a WAF rule shows WHERE it matches, and its operand only where that is safe", () => {
  // matchValues is the rule's substance and also its operand. When a rule
  // matches on a header, a cookie or a query argument, the operand IS the
  // credential the rule was written around — so the decision is made by WHERE,
  // from an allow-list of locations that cannot carry one.
  const out = projectResponse("/shield/waf/rules/7", {
    id: 1, name: "block bots", enabled: true,
    variables: [
      { type: "REQUEST_HEADERS", matchValues: ["Bearer sk_live_x"] },
      { type: "REQUEST_URI", matchValues: ["/admin"] },
    ],
    actionParameters: { header: "Authorization", value: "Bearer sk_live_x" },
    ruleConfiguration: { raw: "sk_live_x" },
  });

  const [header, uri] = out.data.variables;
  assert.equal(header.type, "REQUEST_HEADERS", "the rule's shape stays reviewable");
  assert.ok(!JSON.stringify(header.matchValues).includes("sk_live_x"));
  assert.match(String(header.matchValues), /1 value\(s\)/, "and says how many were withheld");
  assert.deepEqual(uri.matchValues, ["/admin"], "a path cannot carry a secret");

  assert.equal("actionParameters" in out.data, false);
  assert.equal("ruleConfiguration" in out.data, false);
});

// ─── Free-form scalars are bags too ──────────────────────────────────────────

test("operator-authored markup does not come back", () => {
  // Round 5 judged every structured field and left scalars alone. A bag is a
  // bag whether it arrives as an object or as a string: CustomHTML is where an
  // embedded player token or an authenticated third-party URL ends up.
  const out = projectResponse("/videolibrary/9", {
    Id: 9, Name: "clips",
    CustomHTML: '<script>const t="sk_live_x";</script>',
  });
  assert.equal("CustomHTML" in out.data, false);
  assert.equal(out.data.Name, "clips");
});



test("an edge-script variable returns no value under any of its names", () => {
  // Dropping `Value` alone left the credential reachable through `DefaultValue`,
  // a sibling whose name sounds like a placeholder and whose content is the
  // configured value: `API_KEY=sk_live_...` IS a default value.
  const out = projectResponse("/compute/script/1/variables", [
    { Id: 3, Name: "API_KEY", Required: true, Value: "sk_live_x", DefaultValue: "sk_live_x" },
  ]);
  const v = out.data[0];
  assert.equal(v.Name, "API_KEY", "the name is the point of listing them");
  assert.equal(v.Required, true);
  assert.equal("Value" in v, false);
  assert.equal("DefaultValue" in v, false);
});

test("a field called Value is not automatically a secret", () => {
  // The counter-case, so the rule above is not read as "drop anything named
  // Value". A hostname's Value is the hostname; a DNS record's Value is data
  // the whole internet can already query.
  const zone = projectResponse("/pullzone/1", {
    Id: 1, Hostnames: [{ Id: 2, Value: "cdn.example.com", HasCertificate: true }],
  });
  assert.equal(zone.data.Hostnames[0].Value, "cdn.example.com");

  const rec = projectResponse("/dnszone/1/records/2", { Id: 2, Type: 0, Name: "www", Value: "203.0.113.4" });
  assert.equal(rec.data.Value, "203.0.113.4");
});



test("a private registry URL goes through the same reduction as an origin", () => {
  const out = projectResponse("/mc/registries", [
    { id: "r", name: "priv", registryUrl: "https://u:p@registry.example.com/v2?token=t", username: "u" },
  ]);
  assert.equal(out.data[0].registryUrl, "https://registry.example.com/v2");
});

test("a video library reports the watermark and transcription settings it advertises", () => {
  const out = projectResponse("/videolibrary/9", {
    Id: 9, Name: "clips",
    WatermarkPositionLeft: 10, WatermarkPositionTop: 5, WatermarkWidth: 100, WatermarkHeight: 40,
    EnableTranscribing: true, TranscribingCaptionLanguages: ["en", "he"],
    ApiKey: "k",
  });
  assert.equal(out.data.WatermarkWidth, 100, "the tool's own description promises watermark settings");
  assert.equal(out.data.EnableTranscribing, true);
  assert.deepEqual(out.data.TranscribingCaptionLanguages, ["en", "he"]);
  assert.equal("ApiKey" in out.data, false, "and still no key");
});

test("a Magic Container app reports where its volumes are mounted", () => {
  const out = projectResponse("/mc/apps/abc", {
    id: "abc", name: "svc",
    volumes: [{ id: "v1", name: "data", mountPath: "/data", sizeGb: 20, status: "attached", secretRef: "s3cret" }],
  });
  assert.equal(out.data.volumes[0].mountPath, "/data");
  assert.equal(out.data.volumes[0].sizeGb, 20);
  assert.equal("secretRef" in out.data.volumes[0], false, "a field nobody vetted still drops");
});

test("a DNS record keeps what DNS publishes and drops the operator's private note", () => {
  const out = projectResponse("/dnszone/1/records/2", {
    Id: 2, Type: 0, Name: "www", Value: "203.0.113.4",
    Comment: "origin basic auth: svc / s3cret",
  });
  assert.equal(out.data.Value, "203.0.113.4", "DNS answers this to anyone who asks");
  assert.equal("Comment" in out.data, false, "a control-plane note never leaves Bunny — until now");
});

// ─── The comments and the code must agree ────────────────────────────────────

test("no shape allow-lists a field its own comment says it excludes", () => {
  // Round 12's P1: WAF_RULE carried `actionParameters` in the list AND a
  // comment saying it was excluded. The structural rule hid it — an object
  // value dropped for having no declared shape — so it only leaked when Bunny
  // returned the field as a plain string. A comment is not enforcement; this is.
  const src = readFileSync(new URL("../lib/project.js", import.meta.url), "utf-8");
  const shapes = [...src.matchAll(/^const ([A-Z_][A-Z0-9_]*) = \[\n([\s\S]*?)\n\];/gm)];
  assert.ok(shapes.length > 5, "the shapes must actually be found");

  const contradictions = [];
  for (const [, name, body] of shapes) {
    const listed = new Set([...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
    for (const line of body.split("\n")) {
      const not = line.match(/\/\/\s*NOT:\s*(.+)$/);
      if (!not) continue;
      // Only the NAMES, which run until the first em dash or full stop — the
      // prose after that explains the reason and mentions fields that are kept.
      const names = not[1].split(/[—.]/)[0];
      for (const word of names.matchAll(/\b([A-Za-z][A-Za-z0-9_]{2,})\b/g)) {
        if (listed.has(word[1])) contradictions.push(`${name}: "${word[1]}" is excluded by comment and present in the list`);
      }
    }
  }
  assert.deepEqual(contradictions, [], contradictions.join("\n  "));
});

test("a Magic Container app names its variables without revealing them", () => {
  const out = projectResponse("/mc/apps/abc", {
    id: "abc", name: "svc",
    environmentVariables: [{ id: "e1", name: "API_KEY", required: true, isSecret: true, value: "sk_live_x" }],
  });
  const env = out.data.environmentVariables[0];
  assert.equal(env.name, "API_KEY", "knowing a variable exists is the half an operator can act on");
  assert.equal(env.required, true);
  assert.equal("value" in env, false);
});

test("a WAF rule's action parameters never come back, scalar or object", () => {
  for (const params of ["Bearer sk_live_x", { header: "Authorization", value: "Bearer sk_live_x" }]) {
    const out = projectResponse("/shield/waf/rules/7", { id: 1, name: "r", action: 2, actionParameters: params });
    assert.equal("actionParameters" in out.data, false, `scalar or object: ${typeof params}`);
  }
});

test("every URL-valued field goes through the scrubber", () => {
  // The URL class has produced two findings (an origin's userinfo, then its
  // query). Rather than remember to scrub the next one, this asserts the rule:
  // a field whose NAME says it holds a URL must declare the scrubber.
  const src = readFileSync(new URL("../lib/project.js", import.meta.url), "utf-8");
  const shapes = src.slice(0, src.indexOf("const ROUTES = ["));

  const unscrubbed = [];
  for (const m of shapes.matchAll(/"([A-Za-z0-9_]*(?:Url|URL|url))"/g)) {
    // A bare "Name" entry — a declared one reads ["Name", scrubUrl] and so the
    // quoted name is preceded by `[`.
    const before = shapes.slice(Math.max(0, m.index - 2), m.index);
    if (!before.includes("[")) unscrubbed.push(m[1]);
  }
  assert.deepEqual(unscrubbed, [], `URL fields not routed through scrubUrl: ${unscrubbed.join(", ")}`);
});

test("a private repository URL loses its access token", () => {
  const out = projectResponse("/compute/script/3", {
    Id: 3, Name: "s",
    RepositoryUrl: "https://x-access-token:ghp_secret@github.com/org/repo.git",
    IntegrationType: 1,
  });
  assert.equal(out.data.RepositoryUrl, "https://github.com/org/repo.git");
  assert.equal(out.data.IntegrationType, 1);
});

test("a DNS zone reports DNSSEC state and the public DS material, never the private key", () => {
  const out = projectResponse("/dnszone/1", {
    Id: 1, Domain: "example.com",
    DnsSecEnabled: true, DnsSecStatus: 2, DnsSecDsRecord: "2371 13 2 ABCDEF",
    DnsSecPublicKey: "mFWF+p...", DnsSecPrivateKey: "-----BEGIN PRIVATE KEY-----",
  });
  assert.equal(out.data.DnsSecEnabled, true, "the status is what the tool promises");
  assert.equal(out.data.DnsSecDsRecord, "2371 13 2 ABCDEF", "a DS record is published in the parent zone");
  assert.equal("DnsSecPrivateKey" in out.data, false);
});

test("an account reports which products are on, and no key", () => {
  const out = projectResponse("/user", {
    Id: 1, Email: "a@b.c", IsCdnEnabled: true, IsStreamEnabled: false,
    FeatureFlags: ["beta"], ApiKey: "the-account-key",
  });
  assert.equal(out.data.IsCdnEnabled, true);
  assert.deepEqual(out.data.FeatureFlags, ["beta"]);
  assert.equal("ApiKey" in out.data, false);
});

test("a release is identified by when and which, never by its note", () => {
  const out = projectResponse("/compute/script/3", {
    Id: 3, Name: "s",
    Releases: [{ Id: 1, Uuid: "u", Status: 2, DatePublished: "2026-08-26", Note: "deploy key: sk_live_x" }],
  });
  const rel = out.data.Releases[0];
  assert.equal(rel.Uuid, "u");
  assert.equal(rel.DatePublished, "2026-08-26");
  assert.equal("Note" in rel, false, "bunny_publish_edge_script accepts an arbitrary note");
});

test("a REQUEST_URI operand keeps its path and loses its query", () => {
  // A URI includes its query, and `/callback?token=secret` is an ordinary thing
  // to write a rule against — REQUEST_PATH does not have that problem, which is
  // why the two cannot share one verdict.
  const out = projectResponse("/shield/waf/rules/7", {
    id: 1, name: "r",
    variables: [
      { type: "REQUEST_URI", matchValues: ["/callback?token=secret", "/plain"] },
      { type: "REQUEST_PATH", matchValues: ["/admin"] },
    ],
  });
  assert.deepEqual(out.data.variables[0].matchValues, ["/callback", "/plain"]);
  assert.deepEqual(out.data.variables[1].matchValues, ["/admin"], "a path has no query to lose");
});

test("a rate-limit rule scrubs its operand in both representations", () => {
  // The operand can sit at the TOP level as well as inside variables[], and the
  // two say the same thing in different shapes. The nested hook covered one.
  const header = projectResponse("/shield/rate-limits/1", {
    id: 1, value: "Bearer secret",
    variables: [{ type: "REQUEST_HEADERS", matchValues: ["Bearer secret"] }],
  });
  assert.ok(!String(header.data.value).includes("Bearer secret"));
  assert.ok(!JSON.stringify(header.data.variables).includes("Bearer secret"));

  const path = projectResponse("/shield/rate-limits/1", {
    id: 1, value: "/api", variables: [{ type: "REQUEST_PATH", matchValues: ["/api"] }],
  });
  assert.equal(path.data.value, "/api", "a path operand is readable");

  const unnamed = projectResponse("/shield/rate-limits/1", { id: 1, value: "Bearer secret" });
  assert.ok(!String(unnamed.data.value).includes("Bearer secret"), "no stated location means nobody can vouch for it");
});

test("bot detection has its own shape, not the whole zone's", () => {
  const out = projectResponse("/shield/shield-zone/5/bot-detection", {
    shieldZoneId: 5, enabled: true, mode: "challenge", threshold: 20, categories: ["scraper"],
  });
  assert.equal(out.ok, true, "a response of only bot fields must not read as a shape mismatch");
  assert.equal(out.data.threshold, 20, "the tool advertises thresholds");
  assert.deepEqual(out.data.categories, ["scraper"]);
});

// ─── Diagnostics quote the request that failed ───────────────────────────────





test("scrubText does not mangle prose that merely contains a colon", () => {
  const out = projectResponse("/12345/08-26-2026", [
    { Timestamp: 1, Message: "timeout after 10s: origin did not respond" },
  ]);
  assert.equal(out.data[0].Message, "timeout after 10s: origin did not respond");
});

test("the top-level operand's verdict does not depend on array order", () => {
  // Reading variables[0] let a safe REQUEST_PATH sitting in front of a
  // REQUEST_HEADERS publish the operand on the strength of its neighbour.
  const mixed = projectResponse("/shield/rate-limits/1", {
    id: 1, value: "Bearer secret",
    variables: [{ type: "REQUEST_PATH" }, { type: "REQUEST_HEADERS" }],
  });
  assert.ok(!String(mixed.data.value).includes("Bearer secret"), "one unsafe location is enough to withhold");

  const reversed = projectResponse("/shield/rate-limits/1", {
    id: 1, value: "Bearer secret",
    variables: [{ type: "REQUEST_HEADERS" }, { type: "REQUEST_PATH" }],
  });
  assert.deepEqual(mixed.data.value, reversed.data.value, "and the order cannot change the answer");
});





test("a pull zone returns the caching and shielding configuration it advertises", () => {
  const out = projectResponse("/pullzone/1", {
    Id: 1, Name: "z",
    EnableOriginShield: true, OriginShieldZoneCode: "FR",
    EnableQueryStringSort: true, QueryStringVaryParameters: ["v", "lang"],
    OptimizerImageQuality: 82, BlockedIps: ["203.0.113.9"],
    Hostnames: [{ Id: 1, Value: "cdn.example.com", CertificateKey: "-----BEGIN PRIVATE KEY-----" }],
  });
  assert.equal(out.data.EnableOriginShield, true, "bunny_update_pull_zone names this field");
  assert.equal(out.data.OriginShieldZoneCode, "FR");
  assert.deepEqual(out.data.QueryStringVaryParameters, ["v", "lang"]);
  assert.equal(out.data.OptimizerImageQuality, 82);
  assert.deepEqual(out.data.BlockedIps, ["203.0.113.9"]);
  assert.equal("CertificateKey" in out.data.Hostnames[0], false, "and the private key still never appears");
});

test("global search returns matches without their secrets", () => {
  // Not a reported finding — found sweeping every PASSTHROUGH route for "does
  // this answer with a RESOURCE?". bunny_global_search is a READ tool available
  // in the default mode, and it answers with every shape whose secrets the rest
  // of this file exists to remove.
  const out = projectResponse("/search?search=x", {
    PullZones: [{ Id: 1, Name: "z", ZoneSecurityKey: "secret" }],
    StorageZones: [{ Id: 2, Name: "s", Password: "pw", ReadOnlyPassword: "ro" }],
    VideoLibraries: [{ Id: 3, Name: "v", ApiKey: "k" }],
    SomethingBunnyAddsLater: [{ Secret: "x" }],
  });
  const json = JSON.stringify(out.data);
  for (const secret of ["secret", "\"pw\"", "\"ro\"", "\"k\""]) {
    assert.ok(!json.includes(secret), `search leaked ${secret}`);
  }
  assert.equal(out.data.PullZones[0].Name, "z", "and the search still answers");
  assert.equal("SomethingBunnyAddsLater" in out.data, false, "an unvetted container drops");
});

test("a publish answers with the release, and the release has no note", () => {
  const out = projectResponse("/compute/script/3/publish", {
    Id: 9, Uuid: "u", Status: 1, DatePublished: "2026-08-26", Note: "deploy key sk_live_x",
  });
  assert.equal(out.data.Uuid, "u");
  assert.equal("Note" in out.data, false);
});

test("every PASSTHROUGH route is a status or a statistic, never a resource", () => {
  // The rule the publish finding taught, written down: a write that returns a
  // resource is a read wearing a different verb, and a passthrough on such a
  // route is the projector switched off.
  const src = readFileSync(new URL("../lib/project.js", import.meta.url), "utf-8");
  const routes = src.slice(src.indexOf("const ROUTES = ["));
  const passthrough = [...routes.matchAll(/\[(\/[^,]+\/i), PASSTHROUGH\]/g)].map((m) => m[1]);
  assert.ok(passthrough.length > 0, "there should still be some");

  const resourceish = passthrough.filter((r) =>
    !/statistic|metric|overview|purge|Hostname|setEdgeRuleEnabled|heatmap|reencode|code|billing|country|region|deploy|undeploy|restart|start|stop|\[a-z-\]\+|profiles/i.test(r),
  );
  assert.deepEqual(resourceish, [], `these passthrough routes may answer with a resource: ${resourceish.join(", ")}`);
});


test("a pull zone's structured cache-error settings come back", () => {
  const out = projectResponse("/pullzone/1", {
    Id: 1,
    CacheErrorResponses: [{ StatusCode: 502, CacheAge: 30, Enabled: true, Unvetted: "x" }],
  });
  assert.equal(out.data.CacheErrorResponses[0].CacheAge, 30);
  assert.equal("Unvetted" in out.data.CacheErrorResponses[0], false);
});









// ─── Diagnostics: withhold the target, keep the sentence ─────────────────────
//
// Nine rounds were spent teaching a reducer the shapes a URL takes in prose,
// and each round found the shape the last pattern had not met. Nothing is
// parsed now: a token either carries the marks of a credential-bearing target
// or it does not, so there is no interior left to miss.

test("every shape that ever leaked is withheld whole", () => {
  const leaked = [
    "https://user:pass@origin.example/file?token=secret",   // scheme + userinfo + query
    "//user:pass@[2001:db8::1]/file?token=secret",          // protocol-relative, IPv6 host
    "user:pa:ss@origin.example/file",                       // colon inside the password
    "origin.example/file?eyJhbGciOiJIUzI1NiJ9",             // opaque query, no `=`
    "origin.example/file#secret-token",                     // fragment
    "origin.example/video(foo)?token=secret",               // parenthesis in the path
    "(https://user:pass@origin.example/file)",              // wrapped in punctuation
    "fetch_url=https://user:pass@origin.example/file",      // behind a label
    "fetch_url=callback?token=secret",                      // relative, no dot or slash
    "callback#access_token=secret",                         // relative fragment
    "?token=secret",                                        // query-only reference
    "#access_token=secret",                                 // fragment-only reference
    "?eyJhbGciOiJIUzI1NiJ9",                                // query-only, opaque
    "?abc123",                                              // short and opaque — a PIN is a secret too
    "#abc123",
    "?123456",                                              // a PIN is digits, and still a secret
  ];
  for (const target of leaked) {
    const out = projectResponse("/12345/08-26-2026", [{ Timestamp: 1, Message: `failed for ${target} after 10s` }]);
    assert.equal(out.data[0].Message, "failed for (withheld: URL) after 10s", target);
  }
});

test("a plain target and ordinary prose are returned as written", () => {
  // A target with no userinfo, query or fragment carries nothing, and which
  // host failed is most of a diagnostic's value.
  const kept = [
    "https://origin.example/ok is fine",
    "origin.example/file was not found",
    "timeout after 10s: origin did not respond",
    "see section #3 for details",
    "see section #42 for details",
    "wat ? really",
    "why? because it timed out",
    "is it ready? not yet",
    "ratio was 3.5 and rising",
    "origin   did not respond;  retried 3 times, then gave up.",
  ];
  for (const msg of kept) {
    const out = projectResponse("/12345/08-26-2026", [{ Timestamp: 1, Message: msg }]);
    assert.equal(out.data[0].Message, msg, msg);
  }
});

test("both the structured target and the prose about it are covered", () => {
  // Url and Path go through scrubUrl — a real URL parser, on a field that IS a
  // URL. The prose beside them goes through the token rule.
  const out = projectResponse("/12345/08-26-2026", [{
    Timestamp: 1,
    Url: "https://origin/x?token=secret",
    Path: "/callback?token=secret",
    StatusCode: 502,
    ErrorCode: "http_timeout",
    Message: "failed fetching https://svc:pw@origin/x?token=secret",
  }]);
  const e = out.data[0];
  assert.equal(e.Url, "https://origin/x", "a URL field is reduced, not withheld");
  assert.equal(e.Path, "/callback");
  assert.equal(e.StatusCode, 502);
  assert.equal(e.ErrorCode, "http_timeout");
  assert.equal(e.Message, "failed fetching (withheld: URL)");
});

test("a primitive where a shape was expected is refused, not passed", () => {
  // Returning a primitive as-is treated "there are no fields to pick" as "there
  // is nothing here to hide". A double-encoded /user arrives as a JSON STRING
  // with the account's ApiKey inside it, and a string has no fields at all.
  assert.throws(
    () => projectResponse("/user", JSON.stringify({ Id: 1, ApiKey: "the-account-key" })),
    /expected an object and received string/,
  );
  assert.throws(
    () => projectResponse("/pullzone", [1, 2]),
    /expected an object and received number/,
  );
  assert.throws(
    () => projectResponse("/compute/script/1/secrets", ["sk_live_x"]),
    /expected an object/,
  );

  // A route that legitimately answers with a primitive says so: /code is RAW.
  const raw = projectResponse("/compute/script/1/code", "const KEY='x';");
  assert.equal(raw.ok, true);
  assert.equal(raw.raw, true);
});

test("an absent optional block comes back as null, not as a failure", () => {
  // Round 32's refusal over-corrected. Bunny serialises an absent optional
  // block as null — `autoscaling: null` on an app that does not autoscale,
  // `wafEngineConfig: null` with WAF off — and there are no contents to vet, so
  // refusing it would fail an entire valid listing over a field saying
  // "nothing here".
  const app = projectResponse("/mc/apps/abc", { id: "abc", name: "svc", autoscaling: null, volumes: null });
  assert.equal(app.ok, true);
  assert.equal(app.data.autoscaling, null);
  assert.equal(app.data.volumes, null);
  assert.equal(app.data.name, "svc");

  const zone = projectResponse("/shield/shield-zones", [{ id: 1, wafEnabled: false, wafEngineConfig: null }]);
  assert.equal(zone.data[0].wafEngineConfig, null);

  // …and every other primitive is still refused.
  assert.throws(() => projectResponse("/user", "a string"), /expected an object/);
});

test("a scrubbed field that arrives as structure is dropped, not passed", () => {
  // Every scrubber is a string function and returns a non-string unchanged, so
  // an Error or an OriginUrl that arrived as an OBJECT would have been handed
  // back whole — past the rule that structure survives only through a declared
  // nested shape.
  const out = projectResponse("/12345/08-26-2026", [{
    Timestamp: 1,
    StatusCode: 502,
    Url: { href: "https://u:p@h/f?token=secret", extra: "sk_live_x" },
    Message: { text: "failed", token: "sk_live_x" },
    Path: ["/a?token=x"],
  }]);
  const e = out.data[0];
  const json = JSON.stringify(e);
  assert.ok(!json.includes("sk_live_x"));
  assert.ok(!json.includes("token=secret"));
  assert.equal("Url" in e, false);
  assert.equal("Message" in e, false);
  assert.equal("Path" in e, false);
  assert.equal(e.StatusCode, 502, "the rest of the entry still reports");
});

test("a scrubbed field that arrives as text still comes back scrubbed", () => {
  const out = projectResponse("/12345/08-26-2026", [
    { Timestamp: 1, Url: "https://o/x?t=1", Message: "failed for ?tok=1" },
  ]);
  assert.equal(out.data[0].Url, "https://o/x");
  assert.equal(out.data[0].Message, "failed for (withheld: URL)");
});
