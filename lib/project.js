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
const HOSTNAME = ["Id", "Value", "ForceSSL", "IsSystemHostname", "HasCertificate"];

// An edge rule's triggers and action, minus the action's parameters: those are
// operator-supplied strings, and a rule that adds a header is exactly where an
// API key or an origin auth token gets typed.
const EDGE_RULE = [
  "Guid", "ActionType", "TriggerMatchingType", "Enabled", "Description",
  "OrderIndex", "ExtraActions",
  // NOT: ActionParameter1 / ActionParameter2 — free-text, often a credential.
  // NOT: Triggers — PatternMatches carry operator-written URLs with tokens.
];

const PULL_ZONE = [
  "Id", "Name", "Type", "Enabled", "Suspended", "OriginUrl", "OriginType",
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

const STORAGE_ZONE = [
  "Id", "Name", "Region", "ReplicationRegions", "StorageUsed", "FilesStored",
  "Deleted", "DateModified", "PullZones", "Custom404FilePath",
  "StorageHostname", "ZoneTier",
  // NOT: Password, ReadOnlyPassword — full read-write and read storage keys.
];

const STORAGE_FILE = [
  "Guid", "StorageZoneName", "Path", "ObjectName", "Length", "LastChanged",
  "IsDirectory", "ServerId", "UserId", "DateCreated", "ContentType", "Checksum",
];

const DNS_RECORD = [
  "Id", "Type", "Ttl", "Value", "Name", "Weight", "Priority", "Port", "Flags",
  "Tag", "Accelerated", "AcceleratedPullZoneId", "MonitorType", "MonitorStatus",
  "GeolocationLatitude", "GeolocationLongitude", "LatencyZone", "Disabled",
  "Comment", "EnviromentalVariables",
];

const DNS_ZONE = [
  "Id", "Domain", "Records", "DateModified", "DateCreated", "NameserversDetected",
  "CustomNameserversEnabled", "Nameserver1", "Nameserver2", "SoaEmail",
  "NameserversNextCheck", "LoggingEnabled", "LoggingIPAnonymizationEnabled",
  // NOT: DnsSecPrivateKey or any signing material, whatever Bunny names it.
];

const VIDEO_LIBRARY = [
  "Id", "Name", "VideoCount", "TrafficUsage", "StorageUsage", "DateCreated",
  "ReplicationRegions", "EnabledResolutions", "PullZoneId", "StorageZoneId",
  "PlayerKeyColor", "EnableMP4Fallback", "KeepOriginalFiles", "AllowDirectPlay",
  "EnableDRM", "Bitrate240p", "Bitrate360p", "Bitrate480p", "Bitrate720p",
  "Bitrate1080p", "Bitrate1440p", "Bitrate2160p", "AllowedReferrers",
  "BlockedReferrers", "BlockNoneReferrer", "UILanguage", "CustomHTML",
  // NOT: ApiKey, ReadOnlyApiKey, WebhookSignatureKey, ViAiPublisherId.
];

const VIDEO = [
  "videoLibraryId", "guid", "title", "dateUploaded", "views", "isPublic",
  "length", "status", "framerate", "rotation", "width", "height",
  "availableResolutions", "outputCodecs", "thumbnailCount", "encodeProgress",
  "storageSize", "captions", "hasMP4Fallback", "collectionId",
  "thumbnailFileName", "averageWatchTime", "totalWatchTime", "category",
  "chapters", "moments", "metaTags", "transcodingMessages",
];

const COLLECTION = ["videoLibraryId", "guid", "name", "videoCount", "totalSize", "previewVideoIds"];

const EDGE_SCRIPT = [
  "Id", "Name", "ScriptType", "SystemHostname", "Deployable", "LastDeployment",
  "DateCreated", "Deleted", "CurrentReleaseId", "LinkedPullZones",
  // NOT: environment variables — an edge script's variables hold API keys.
];

const SHIELD_ZONE = [
  "id", "pullZoneId", "shieldZoneStatus", "wafEnabled", "wafEngineConfig",
  "wafDisabledRules", "wafLogOnlyRules", "wafRequestHeaderLoggingEnabled",
  "wafRuleTriggerThreshold", "ddosEnabled", "ddosExecutionMode",
  "ddosChallengeWindow", "learningMode", "learningModeUntil",
  "botDetectionEnabled", "botDetectionMode",
  // NOT: wafRequestIgnoredHeaders — operators put auth header names there.
];

const WAF_RULE = [
  "id", "ruleId", "name", "description", "enabled", "action", "actionParameters",
  "ruleType", "ruleConfiguration", "variables", "operator", "transformations",
  "shieldZoneId",
];

const RATE_LIMIT_RULE = [
  "id", "shieldZoneId", "name", "description", "enabled", "requestCount",
  "timeframeSeconds", "blockTime", "action", "variables", "operator",
  "transformations", "value",
];

const MAGIC_CONTAINER_APP = [
  "id", "name", "status", "createdAt", "updatedAt", "regions", "endpoints",
  "imageName", "imageTag", "replicas", "cpu", "memory", "autoscaling",
  // NOT: environment variables or registry credentials.
];

const MC_REGISTRY = ["id", "name", "registryUrl", "username", "type"];

// An edge script's variables and secrets. The list endpoint returns each entry's
// `Value`, and a secret is a secret whichever of the two lists it sits in.
const EDGE_SCRIPT_VARIABLE = ["Id", "Name", "Required", "DefaultValue"];

const ACCOUNT = [
  "Id", "Email", "FirstName", "LastName", "BillingEmail", "StreetAddress",
  "City", "ZipCode", "Country", "CompanyName", "VATNumber", "Balance",
  "BillingType", "TrialBalance", "TotalBandwidthUsed", "TotalStorageUsed",
  // NOT: ApiKey / ApiKeys — the account key the server itself authenticates with.
];

// ─── Path → shape ────────────────────────────────────────────────────────────
//
// First match wins, so specific paths precede their collections. Query strings
// are stripped before matching.

const ROUTES = [
  // Pull zones
  [/^\/pullzone\/\d+\/(purgeCache|addHostname|removeHostname)$/i, PASSTHROUGH],
  [/^\/pullzone\/\d+\/edgerules(\/.*)?$/i, PASSTHROUGH],
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
  [/^\/compute\/script\/\d+\/code$/i, PASSTHROUGH],
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
 * Picks the allow-listed fields off one object.
 *
 * A field is either a name (kept as-is) or a `[name, nestedFields]` pair, whose
 * value is itself projected — a pull zone's `Hostnames` must not arrive whole,
 * because each hostname carries the zone's certificate and private key.
 */
function pick(obj, fields) {
  const out = {};
  for (const f of fields) {
    const [name, nested] = Array.isArray(f) ? f : [f, null];
    if (!Object.prototype.hasOwnProperty.call(obj, name)) continue;
    out[name] = nested ? projectValue(obj[name], nested) : obj[name];
  }
  return out;
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
