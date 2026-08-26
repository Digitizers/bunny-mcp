/**
 * Response projection — the redaction boundary.
 *
 * Bunny's API returns credentials inline with ordinary metadata: a pull zone
 * carries `ZoneSecurityKey`, a storage zone carries `Password` and
 * `ReadOnlyPassword`, a video library carries `ApiKey`. A tool that hands the
 * raw response to a model puts those values in its context, its logs, and its
 * transcript, where they are effectively published.
 *
 * So nothing reaches a tool unprojected. Every response passes through here
 * first, keyed by the request path, and only the fields named below survive.
 *
 * ALLOW-LIST, NEVER DENY-LIST. Stripping a known set of secret-looking names
 * fails the moment Bunny adds a field: the new one ships in the clear, and
 * nothing tells you. Naming what may pass fails the other way — a new field is
 * invisible until someone decides it is safe, which is a bug report, not a
 * breach.
 *
 * FAIL CLOSED. A path with no entry below yields no data and an explicit
 * error naming the path. A tool that stops working is a five-minute fix; a
 * tool that quietly leaks is not.
 */

/** Marks a shape whose entire payload is non-sensitive by inspection. */
export const PASSTHROUGH = Symbol("passthrough");

/**
 * Marks a route that legitimately answers with a non-JSON body.
 *
 * The interceptor used to wave EVERY non-JSON response through, on the
 * reasoning that a file download is the operator's own content. That was a
 * blanket exemption in a file whose entire argument is that exemptions must be
 * named — and it covered `/compute/script/<id>/code`, which returns edge-script
 * SOURCE. Source is operator-authored text with hard-coded keys in it about as
 * often as `CustomHTML` is, and that one is dropped.
 *
 * So a non-JSON body now passes only where a route says it may, and what
 * happens to it is that route's decision rather than a default.
 */
export const RAW = Symbol("raw");

/**
 * Envelope fields Bunny wraps paginated collections in — never resource data.
 *
 * BOTH CASINGS, because Bunny is two APIs wearing one name: the management API
 * answers `{ Items, CurrentPage, TotalItems, HasMoreItems }` and the Stream API
 * answers `{ items, currentPage, totalItems, itemsPerPage }`. Recognising only
 * the first made the projector treat a Stream listing as a single resource,
 * match none of its fields, and return `{}` — every video silently discarded
 * while the call reported success.
 */
const PAGE_FIELDS = [
  "CurrentPage", "TotalItems", "HasMoreItems", "TotalPages", "PageSize",
  "currentPage", "totalItems", "hasMoreItems", "itemsPerPage", "totalPages",
];

/** The two names Bunny gives the array inside an envelope. */
const ITEM_KEYS = ["Items", "items"];

// ─── Shapes ──────────────────────────────────────────────────────────────────
//
// One entry per resource type. Fields are the ones an operator or an agent
// needs to identify, inspect and act on the resource. Anything absent is
// dropped — including fields that are merely uninteresting, because "not
// obviously a secret" is not the test being applied here.

// A hostname carries the zone's TLS material. `HasCertificate` answers the only
// question an operator asks; `Certificate` and `CertificateKey` are the cert and
// its PRIVATE KEY, and neither belongs in a model's context.
// `Value` here is the hostname itself (`cdn.example.com`) — the field's name is
// generic, its content is not a secret. Kept deliberately; see EDGE_SCRIPT_VARIABLE
// for the case where a field called Value really is one.
const HOSTNAME = ["Id", "Value", "ForceSSL", "IsSystemHostname", "HasCertificate"];

// An edge rule's triggers and action, minus the action's parameters: those are
// operator-supplied strings, and a rule that adds a header is exactly where an
// API key or an origin auth token gets typed.
// A secondary action on an edge rule. Same fields as the primary one and the
// same exclusions: an extra action is where the SECOND header gets added, so
// vetting the primary and waving this through defeats the point.
const EDGE_RULE_ACTION = ["ActionType"];

const EDGE_RULE = [
  "Guid", "ActionType", "TriggerMatchingType", "Enabled", "Description",
  "OrderIndex", ["ExtraActions", EDGE_RULE_ACTION],
  // NOT: ActionParameter1 / ActionParameter2 — free-text, often a credential.
  // NOT: Triggers — PatternMatches carry operator-written URLs with tokens.
];

const PULL_ZONE = [
  "Id", "Name", "Type", "Enabled", "Suspended", ["OriginUrl", scrubUrl], "OriginType",
  "StorageZoneId", ["Hostnames", HOSTNAME], "EnableGeoZoneUS", "EnableGeoZoneEU",
  "EnableGeoZoneASIA", "EnableGeoZoneSA", "EnableGeoZoneAF",
  "ZoneSecurityEnabled", "MonthlyBandwidthLimit", "MonthlyBandwidthUsed",
  "MonthlyCharges", "CacheControlMaxAgeOverride", "EnableSmartCache",
  "AddHostHeader", "IgnoreQueryStrings", "BlockRootPathAccess",
  "EnableCacheSlice", "OptimizerEnabled", "EnableWebPVary", "EnableAvifVary",
  "DisableCookies", "BudgetRedirectedCountries", "BlockedCountries",
  ["EdgeRules", EDGE_RULE],
  // NOT: ZoneSecurityKey — the token-authentication signing secret.
];

// A pull zone as it appears nested inside another resource: enough to identify
// and follow, never the full zone (which carries ZoneSecurityKey).
const LINKED_PULL_ZONE = ["Id", "Name", "Enabled", "Type"];

const STORAGE_ZONE = [
  "Id", "Name", "Region", "ReplicationRegions", "StorageUsed", "FilesStored",
  "Deleted", "DateModified", ["PullZones", LINKED_PULL_ZONE], "Custom404FilePath",
  "StorageHostname", "ZoneTier",
  // NOT: Password, ReadOnlyPassword — full read-write and read storage keys.
];

const STORAGE_FILE = [
  "Guid", "StorageZoneName", "Path", "ObjectName", "Length", "LastChanged",
  "IsDirectory", "ServerId", "UserId", "DateCreated", "ContentType", "Checksum",
];

const DNS_RECORD = [
  // `Value` is the record's data — an A record's address, a TXT record's text.
  // DNS is a public directory by construction: anything here is already
  // answerable by anyone who queries the zone, so withholding it would hide
  // from the operator what the world can already read.
  "Id", "Type", "Ttl", "Value", "Name", "Weight", "Priority", "Port", "Flags",
  "Tag", "Accelerated", "AcceleratedPullZoneId", "MonitorType", "MonitorStatus",
  "GeolocationLatitude", "GeolocationLongitude", "LatencyZone", "Disabled",
  "EnviromentalVariables",
  // NOT: Comment. The record's Value is public by construction — DNS answers it
  // to anyone who asks — but a Comment is control-plane annotation that never
  // leaves Bunny, which is exactly the kind of place an operator writes down a
  // password or an authenticated URL. Name, Type and Value identify the record
  // without it.
  //
  // The line this draws, since several shapes have free text: a field that
  // IDENTIFIES the resource stays (a WAF rule's `description` is how you know
  // which rule you are reviewing); a field that merely ANNOTATES it goes.
];

const DNS_ZONE = [
  "Id", "Domain", ["Records", DNS_RECORD], "DateModified", "DateCreated", "NameserversDetected",
  "CustomNameserversEnabled", "Nameserver1", "Nameserver2", "SoaEmail",
  "NameserversNextCheck", "LoggingEnabled", "LoggingIPAnonymizationEnabled",
  // DNSSEC STATE and the public half of it: promised by bunny_get_dns_zone, and
  // a DS record is published in the parent zone — it is public by design, the
  // same argument that keeps a record's Value.
  "DnsSecEnabled", "DnsSecStatus", "DnsSecDsRecord", "DnsSecKeyTag",
  "DnsSecAlgorithm", "DnsSecDigestType", "DnsSecDigest", "DnsSecPublicKey",
  // NOT: DnsSecPrivateKey or any signing material, whatever Bunny names it.
];

const VIDEO_LIBRARY = [
  "Id", "Name", "VideoCount", "TrafficUsage", "StorageUsage", "DateCreated",
  "ReplicationRegions", "EnabledResolutions", "PullZoneId", "StorageZoneId",
  "PlayerKeyColor", "EnableMP4Fallback", "KeepOriginalFiles", "AllowDirectPlay",
  "EnableDRM", "Bitrate240p", "Bitrate360p", "Bitrate480p", "Bitrate720p",
  "Bitrate1080p", "Bitrate1440p", "Bitrate2160p", "AllowedReferrers",
  "BlockedReferrers", "BlockNoneReferrer", "UILanguage",
  // NOT: CustomHTML — operator-authored markup, and markup is where an embedded
  // player token or an authenticated third-party URL ends up. A free-form bag is
  // a free-form bag whether it arrives as an object or as a string; round 5 only
  // judged the ones with structure.
  // Watermark and transcription, both named in bunny_get_video_library's own
  // description and in the update tool's field list. Geometry and booleans —
  // there is no credential in a watermark's position or a caption language.
  "WatermarkPositionLeft", "WatermarkPositionTop", "WatermarkWidth", "WatermarkHeight",
  "EnableTranscribing", "EnableTranscribingTitleGeneration",
  "EnableTranscribingDescriptionGeneration", "TranscribingCaptionLanguages",
  // The token-auth STATE, which is a boolean and the operational answer — the
  // same distinction PULL_ZONE already draws between ZoneSecurityEnabled (kept)
  // and ZoneSecurityKey (dropped). Knowing whether signing is on requires no key.
  "EnableTokenAuthentication", "EnableTokenIPVerification",
  // NOT: ApiKey, ReadOnlyApiKey, WebhookSignatureKey, ViAiPublisherId.
];

// Time-anchored annotations on a video. Operator-authored text, but text the
// tool exists to return — a chapter title is content, not configuration.
const VIDEO_MOMENT   = ["label", "timestamp"];
const VIDEO_CHAPTER  = ["title", "start", "end"];
const TRANSCODE_NOTE = ["timeStamp", "level", "issueCode", "message", "value"];

const VIDEO = [
  "videoLibraryId", "guid", "title", "dateUploaded", "views", "isPublic",
  "length", "status", "framerate", "rotation", "width", "height",
  "availableResolutions", "outputCodecs", "thumbnailCount", "encodeProgress",
  "storageSize", ["captions", ["srclang", "label"]], "hasMP4Fallback", "collectionId",
  "thumbnailFileName", "averageWatchTime", "totalWatchTime", "category",
  ["chapters", VIDEO_CHAPTER], ["moments", VIDEO_MOMENT],
  ["transcodingMessages", TRANSCODE_NOTE],
  // NOT: metaTags — a free-form operator key/value bag. The one place on a
  // video where a token would end up if anywhere did.
];

const COLLECTION = ["videoLibraryId", "guid", "name", "videoCount", "totalSize", "previewVideoIds"];

// A release of an edge script: when it went out and which one it is. Not its
// code — that is /code, which is RAW and gated behind BUNNY_ALLOW_SOURCE.
const EDGE_SCRIPT_RELEASE = [
  "Id", "Uuid", "DateCreated", "DatePublished", "Status",
  // NOT: Note. bunny_publish_edge_script accepts an arbitrary note, so it is
  // operator-authored annotation — the DNS `Comment` case exactly. When and
  // which identify a release; the note only describes it.
];

const EDGE_SCRIPT = [
  "Id", "Name", "ScriptType", "SystemHostname", "Deployable", "LastDeployment",
  "DateCreated", "Deleted", "CurrentReleaseId", ["LinkedPullZones", LINKED_PULL_ZONE],
  // Integration type and release history, both promised by bunny_get_edge_script.
  "IntegrationType", "IntegrationId", ["RepositoryUrl", scrubUrl], "RepositoryBranch",
  ["Releases", EDGE_SCRIPT_RELEASE],
  // NOT: environment variables — an edge script's variables hold API keys.
];

const SHIELD_ZONE = [
  "id", "pullZoneId", "shieldZoneStatus", "wafEnabled",
  ["wafEngineConfig", ["wafEngineVersion", "rulesetVersion"]],
  "wafDisabledRules", "wafLogOnlyRules", "wafRequestHeaderLoggingEnabled",
  "wafRuleTriggerThreshold", "ddosEnabled", "ddosExecutionMode",
  "ddosChallengeWindow", "learningMode", "learningModeUntil",
  "botDetectionEnabled", "botDetectionMode",
  // NOT: wafRequestIgnoredHeaders — operators put auth header names there.
];

/**
 * Where a rule matches, and — only sometimes — what it matches against.
 *
 * `matchValues` is the rule's substance: a WAF rule whose conditions you cannot
 * read cannot be reviewed. It is also the operand, and when the rule matches on
 * a header, a cookie or a query argument, the operand IS the credential the
 * rule was written around.
 *
 * So the decision is made by WHERE, from an allow-list of locations that cannot
 * carry a secret: a path, a country, an IP, a method. Anything else keeps the
 * type and the count and drops the values, which still says "this rule matches
 * three things in the Authorization header" — enough to review the rule's shape
 * without reading the secret it names.
 */
const SAFE_MATCH_LOCATIONS = new Set([
  "REQUEST_URI", "REQUEST_METHOD", "REMOTE_ADDR", "GEO_COUNTRY_CODE",
  "REQUEST_PATH", "HOST", "REQUEST_PROTOCOL",
]);

export function scrubMatchValues(values, type) {
  if (!Array.isArray(values)) return values;
  if (SAFE_MATCH_LOCATIONS.has(String(type ?? "").toUpperCase())) return values;
  return `(withheld: ${values.length} value(s) matched in ${type ?? "an unnamed location"})`;
}

const RULE_VARIABLE = ["type", "matchValues"];

/**
 * A per-object hook, for the case a per-FIELD shape cannot express: the
 * decision about one field depends on a sibling. `matchValues` is judged by
 * `type`, and neither is meaningful without the other.
 */
const OBJECT_HOOKS = new Map([
  [RULE_VARIABLE, (out, src) => {
    if ("matchValues" in out) out.matchValues = scrubMatchValues(src.matchValues, src.type);
    return out;
  }],
]);

const WAF_RULE = [
  "id", "ruleId", "name", "description", "enabled", "action",
  "ruleType", ["variables", RULE_VARIABLE], "operator", "transformations",
  "shieldZoneId",
  // NOT: actionParameters / ruleConfiguration — free-form, and an action that
  // adds a header is where a credential goes.
];

const RATE_LIMIT_RULE = [
  "id", "shieldZoneId", "name", "description", "enabled", "requestCount",
  "timeframeSeconds", "blockTime", "action", ["variables", RULE_VARIABLE],
  "operator", "transformations", "value",
];

const MAGIC_CONTAINER_APP = [
  "id", "name", "status", "createdAt", "updatedAt",
  ["regions", ["code", "name", "replicas"]],
  ["endpoints", ["type", "host", "port"]],
  "imageName", "imageTag", "replicas", "cpu", "memory",
  ["autoscaling", ["minReplicas", "maxReplicas", "targetCpu", "targetMemory"]],
  // Where a volume is mounted and how big it is — advertised by bunny_get_mc_app.
  // NOT its contents, and not an environment block if one ever appears here.
  ["volumes", ["id", "name", "mountPath", "sizeGb", "status", "region"]],
  // Which variables an app REQUIRES, never what they are set to — the same
  // split as an edge script's variables. bunny_get_mc_app advertises the
  // environment configuration, and knowing a variable exists is the half an
  // operator can act on.
  ["environmentVariables", ["id", "name", "required", "isSecret"]],
  // NOT: any variable's value, and not registry credentials.
];

// A private registry URL can carry userinfo and a token query just as an
// origin can, so it goes through the same reduction.
const MC_REGISTRY = ["id", "name", ["registryUrl", scrubUrl], "username", "type"];

// An edge script's variables and secrets. The list endpoint returns each entry's
// `Value`, and a secret is a secret whichever of the two lists it sits in.
const EDGE_SCRIPT_VARIABLE = [
  "Id", "Name", "Required",
  // NOT: Value, and NOT DefaultValue either. `DefaultValue` is where an edge
  // script's configured value actually lives — `API_KEY=sk_live_...` is a
  // default value, not a placeholder — so dropping `Value` alone left the
  // credential reachable through its sibling under a name that sounds harmless.
];

const ACCOUNT = [
  "Id", "Email", "FirstName", "LastName", "BillingEmail", "StreetAddress",
  "City", "ZipCode", "Country", "CompanyName", "VATNumber", "Balance",
  "BillingType", "TrialBalance", "TotalBandwidthUsed", "TotalStorageUsed",
  // Product and feature STATE, promised by bunny_get_account. Booleans and
  // names about what the account may do — no credential is expressible here.
  "EnabledProducts", "FeatureFlags", "IsStreamEnabled", "IsCdnEnabled",
  "IsDnsEnabled", "IsStorageEnabled", "IsMagicContainersEnabled",
  "TwoFactorAuthenticationEnabled", "EmailVerified", "IsSuspended",
  // NOT: ApiKey / ApiKeys — the account key the server itself authenticates with.
];

// ─── Path → shape ────────────────────────────────────────────────────────────
//
// First match wins, so specific paths precede their collections. Query strings
// are stripped before matching.

const ROUTES = [
  // Pull zones
  [/^\/pullzone\/\d+\/(purgeCache|addHostname|removeHostname)$/i, PASSTHROUGH],
  // `setEdgeRuleEnabled` answers with status; `addOrUpdate` and the item route
  // answer with the RULE, whose action parameters are the credentials the
  // pull-zone read already projects away. A write path that returns a resource
  // is a read path wearing a different verb.
  [/^\/pullzone\/\d+\/edgerules\/[^/]+\/setEdgeRuleEnabled$/i, PASSTHROUGH],
  [/^\/pullzone\/\d+\/edgerules(\/.*)?$/i, EDGE_RULE],
  [/^\/pullzone(\/\d+)?$/i, PULL_ZONE],
  [/^\/purge$/i, PASSTHROUGH],

  // Storage
  [/^\/storagezone\/\d+\/statistics$/i, PASSTHROUGH],
  [/^\/storagezone(\/\d+)?$/i, STORAGE_ZONE],

  // DNS
  [/^\/dnszone\/\d+\/statistics$/i, PASSTHROUGH],
  [/^\/dnszone\/\d+\/records(\/\d+)?$/i, DNS_RECORD],
  [/^\/dnszone(\/\d+)?$/i, DNS_ZONE],

  // Stream. Statistics and heatmap are aggregates; `fetch` and `reencode`
  // answer with job status, not a video record.
  [/^\/library\/\d+\/(videos\/[^/]+\/)?statistics$/i, PASSTHROUGH],
  [/^\/library\/\d+\/videos\/[^/]+\/(heatmap|reencode)$/i, PASSTHROUGH],
  [/^\/library\/\d+\/videos\/fetch$/i, PASSTHROUGH],
  [/^\/library\/\d+\/videos(\/[^/]+)?$/i, VIDEO],
  [/^\/library\/\d+\/collections(\/[^/]+)?$/i, COLLECTION],
  [/^\/videolibrary(\/\d+)?$/i, VIDEO_LIBRARY],

  // Edge scripting. `secrets` is the reason this table cannot be lazy: the
  // endpoint returns each secret's VALUE, so it gets the narrowest shape here
  // and `variables` shares it — an operator who puts an API key in a plain
  // variable, which is the normal thing to do, is protected the same way.
  [/^\/compute\/script\/\d+\/(variables|secrets)(\/[^/]+)?$/i, EDGE_SCRIPT_VARIABLE],
  [/^\/compute\/script\/\d+\/publish(\/[^/]+)?$/i, PASSTHROUGH],
  // Edge-script source. RAW, not PASSTHROUGH: see BUNNY_ALLOW_SOURCE — the
  // body is withheld unless the operator has said it may be read.
  [/^\/compute\/script\/\d+\/code$/i, RAW],
  [/^\/compute\/script(\/\d+)?$/i, EDGE_SCRIPT],

  // Shield
  [/^\/shield\/metrics\//i, PASSTHROUGH],
  [/^\/shield\/waf\/(custom-rule|rules)(\/[^/]+)?$/i, WAF_RULE],
  [/^\/shield\/waf\/profiles(\/[^/]+)?$/i, PASSTHROUGH],
  [/^\/shield\/rate-limits?(\/[^/]+)?$/i, RATE_LIMIT_RULE],
  // `get-by-pullzone/<id>` answers with a shield zone like the direct lookup,
  // so it takes the same shape rather than a passthrough.
  [/^\/shield\/shield-zone\/get-by-pullzone\/[^/]+$/i, SHIELD_ZONE],
  [/^\/shield\/shield-zones?(\/[^/]+)?(\/bot-detection)?$/i, SHIELD_ZONE],

  // Magic Containers
  [/^\/mc\/apps\/[^/]+\/(overview|statistics)$/i, PASSTHROUGH],
  // The lifecycle tool's own schema is z.enum(["deploy","undeploy","restart"]).
  // Matched by shape rather than by that list: an action added to the enum
  // later would otherwise arrive here undeclared, and a lifecycle response
  // reports job status — there is no resource in it to project.
  [/^\/mc\/apps\/[^/]+\/[a-z-]+$/i, PASSTHROUGH],
  [/^\/mc\/apps(\/[^/]+)?$/i, MAGIC_CONTAINER_APP],
  [/^\/mc\/registries$/i, MC_REGISTRY],
  [/^\/mc\/regions$/i, PASSTHROUGH],

  // Account & misc
  [/^\/user$/i, ACCOUNT],
  [/^\/billing(\/.*)?$/i, PASSTHROUGH],
  [/^\/statistics$/i, PASSTHROUGH],
  [/^\/country$/i, PASSTHROUGH],
  [/^\/region$/i, PASSTHROUGH],
  [/^\/search$/i, PASSTHROUGH],

  // Origin logging lives on its own host and its path is /<pullZoneId>/<date>,
  // which looks like nothing else here — hence the anchored numeric-then-date
  // shape rather than a catch-all.
  [/^\/\d+\/[0-9-]+$/i, PASSTHROUGH],
];

/**
 * What may survive from an error body.
 *
 * `Message` is deliberately conditional, not listed here — see
 * `projectErrorBody()`. Bunny echoes submitted values back in validation
 * messages, and the values a tool submits include edge-script secrets.
 */
const ERROR_FIELDS = ["ErrorKey", "HttpCode", "Field", "field"];

/**
 * Projects an error body.
 *
 * A non-2xx response never reaches the response projector — axios routes it to
 * the rejection handler instead — so the redaction boundary had a door in it:
 * `handleToolError` forwards `body.Message` straight to the client.
 *
 * The rule is about the REQUEST, because that is what decides whether an echo
 * is possible at all. A request that carried no body cannot have its own
 * payload quoted back at it, so its message is diagnostic and passes through. A
 * request that carried one can, so the message is dropped and the caller is
 * told why — the status and `ErrorKey` still say what went wrong.
 *
 * @param {unknown} body        The error response body.
 * @param {boolean} sentPayload Whether the request carried a body.
 * @returns {unknown} A projected body, safe to show.
 */
export function projectErrorBody(body, sentPayload) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    // A string body is the whole message, and there is no way to tell an echo
    // from a description inside one. Withheld when a payload was sent.
    return sentPayload ? { Message: "(withheld: the request body may be quoted back)" } : body;
  }
  const out = pick(body, ERROR_FIELDS);
  if (typeof body.Message === "string" || typeof body.message === "string") {
    out.Message = sentPayload
      ? "(withheld: the request body may be quoted back)"
      : (body.Message ?? body.message);
  }
  return out;
}

/** Strips the query string and normalises a trailing slash away. */
export function normalisePath(url) {
  const path = String(url ?? "").split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path === "" ? "/" : path;
}

/** The shape for a path, or `null` when none is declared. */
export function shapeFor(url) {
  const path = normalisePath(url);
  for (const [test, shape] of ROUTES) {
    if (test.test(path)) return shape;
  }
  return null;
}

/**
 * Reduces a URL to the parts that say WHERE it points.
 *
 * Scheme, host, port and path survive. Userinfo, query and fragment do not.
 *
 * Allow-list, like everything else here. The first version of this stripped
 * `user:password@` and kept the rest, which is a deny-list wearing a scrubber's
 * coat — it removed the one place a credential was known to sit and left every
 * other one open, so `?token=…` walked straight through. Naming what may pass
 * is the only version of this that survives the next place someone hides a
 * secret.
 *
 * The cost is real and small: an origin URL's query string is rare, and when it
 * is there it is usually authentication. Where it points is what an operator
 * needs to read.
 */
export function scrubUrl(value) {
  if (typeof value !== "string" || value === "") return value;
  try {
    const u = new URL(value);
    const port = u.port ? `:${u.port}` : "";
    const path = u.pathname === "/" && !value.replace(/^[a-z]+:\/\/[^/]*/i, "").startsWith("/") ? "" : u.pathname;
    return `${u.protocol}//${u.hostname}${port}${path}`;
  } catch {
    // Not parseable. A bare host is harmless; anything carrying userinfo or a
    // query is withheld rather than guessed at.
    return /[@?#]/.test(value) ? "(withheld: unparseable URL)" : value;
  }
}

/** A value with no interior for a secret to hide in. */
function isScalar(v) {
  return v === null || (typeof v !== "object");
}

/** An array of scalars is as safe as the scalars in it. */
function isScalarArray(v) {
  return Array.isArray(v) && v.every(isScalar);
}

/**
 * Picks the allow-listed fields off one object.
 *
 * A field is either a name or a `[name, nestedFields]` pair. And a bare name
 * may only carry a SCALAR — or an array of them.
 *
 * That restriction is the lesson of four review rounds. Allow-listing a field
 * name says "this field is safe"; it says nothing about the objects underneath
 * it, and every leak found in this file lived one level down from a name
 * somebody had already vetted. `Hostnames` looked safe and held the TLS private
 * key. `EdgeRules` was given a shape, and `ExtraActions` inside it still
 * carried the very `ActionParameter2` that shape existed to drop.
 *
 * So structure is not vetted by naming its parent. An object or an array of
 * objects survives only where a nested shape is declared for it; otherwise it
 * is dropped, whatever its name suggests. A field that genuinely needs its
 * interior must say what may pass — which is the same rule the top level has
 * always followed, applied all the way down.
 */
function pick(obj, fields) {
  const out = {};
  for (const f of fields) {
    const [name, nested] = Array.isArray(f) ? f : [f, null];
    if (!Object.prototype.hasOwnProperty.call(obj, name)) continue;

    const value = obj[name];
    if (typeof nested === "function") {
      // A scrubber: the field comes back, with the part that carries a secret
      // taken out of it. Used where dropping would cost real information.
      out[name] = nested(value);
      continue;
    }
    if (nested) {
      out[name] = projectValue(value, nested);
      continue;
    }
    if (isScalar(value) || isScalarArray(value)) {
      out[name] = value;
    }
    // Structure with no declared shape: dropped. Fail closed, one level at a
    // time, all the way down.
  }
  const hook = OBJECT_HOOKS.get(fields);
  return hook ? hook(out, obj) : out;
}

function projectValue(value, fields) {
  if (Array.isArray(value)) return value.map((v) => projectValue(v, fields));
  if (value === null || typeof value !== "object") return value;

  // A paginated envelope: keep the page counters, project the items.
  const itemKey = ITEM_KEYS.find((k) => Array.isArray(value[k]));
  if (itemKey) {
    const out = pick(value, PAGE_FIELDS);
    out[itemKey] = value[itemKey].map((v) => projectValue(v, fields));
    return out;
  }

  const out = pick(value, fields);

  // A shape that matches NOTHING in a non-empty payload is a shape that does
  // not belong to this payload — the projector would otherwise hand back `{}`
  // and let the call report success on nothing at all. That is the failure the
  // camel-case envelope caused, and silence is what made it a bug rather than
  // an error, so it is loud now. Same doctrine as an undeclared path.
  if (Object.keys(value).length > 0 && Object.keys(out).length === 0) {
    throw new Error(
      "Response projection matched no fields. The declared shape does not fit this payload " +
      `(keys seen: ${Object.keys(value).slice(0, 8).join(", ")}). Fix the shape in lib/project.js.`,
    );
  }
  return out;
}

/**
 * Projects a response for `url`.
 *
 * @returns {{ok: true, data: unknown} | {ok: false, error: string}}
 */
export function projectResponse(url, data) {
  const shape = shapeFor(url);
  if (shape === null) {
    return {
      ok: false,
      error:
        `No response projection is declared for "${normalisePath(url)}". ` +
        "Refusing to return the raw payload — it may contain credentials. " +
        "Add the path to ROUTES in lib/project.js.",
    };
  }
  if (shape === RAW) return { ok: true, raw: true, data };
  if (shape === PASSTHROUGH) return { ok: true, data };
  return { ok: true, data: projectValue(data, shape) };
}

/**
 * Projects a storage-zone directory listing.
 *
 * Storage paths are operator-chosen, so they cannot be matched by pattern the
 * way the management API's routes are — the host is the discriminator instead.
 * Everything the storage endpoint returns as JSON is a file listing, and file
 * *contents* are streamed by the download tool without passing through here.
 */
export function projectStorageListing(data) {
  return projectValue(data, STORAGE_FILE);
}
