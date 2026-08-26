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

/** Envelope fields Bunny wraps paginated collections in — never resource data. */
const PAGE_FIELDS = ["CurrentPage", "TotalItems", "HasMoreItems", "Items"];

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

const PULL_ZONE = [
  "Id", "Name", "Type", "Enabled", "Suspended", "OriginUrl", "OriginType",
  "StorageZoneId", ["Hostnames", HOSTNAME], "EnableGeoZoneUS", "EnableGeoZoneEU",
  "EnableGeoZoneASIA", "EnableGeoZoneSA", "EnableGeoZoneAF",
  "ZoneSecurityEnabled", "MonthlyBandwidthLimit", "MonthlyBandwidthUsed",
  "MonthlyCharges", "CacheControlMaxAgeOverride", "EnableSmartCache",
  "AddHostHeader", "IgnoreQueryStrings", "BlockRootPathAccess",
  "EnableCacheSlice", "OptimizerEnabled", "EnableWebPVary", "EnableAvifVary",
  "DisableCookies", "BudgetRedirectedCountries", "BlockedCountries",
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
  [/^\/pullzone\/\d+\/purgeCache$/i, PASSTHROUGH],       // empty body
  [/^\/pullzone\/\d+\/(add|remove)Hostname$/i, PASSTHROUGH],
  [/^\/pullzone\/\d+\/edgerules(\/.*)?$/i, PASSTHROUGH], // edge rules carry no credential
  [/^\/pullzone(\/\d+)?$/i, PULL_ZONE],
  [/^\/purge$/i, PASSTHROUGH],

  // Storage
  [/^\/storagezone\/\d+\/statistics$/i, PASSTHROUGH],
  [/^\/storagezone(\/\d+)?$/i, STORAGE_ZONE],

  // DNS
  [/^\/dnszone\/\d+\/statistics$/i, PASSTHROUGH],
  [/^\/dnszone\/\d+\/records(\/\d+)?$/i, DNS_RECORD],
  [/^\/dnszone(\/\d+)?$/i, DNS_ZONE],

  // Stream
  [/^\/videolibrary(\/\d+)?$/i, VIDEO_LIBRARY],
  [/^\/library\/\d+\/collections(\/[^/]+)?$/i, COLLECTION],
  [/^\/library\/\d+\/videos\/[^/]+\/heatmap$/i, PASSTHROUGH],
  [/^\/library\/\d+\/videos(\/[^/]+)?$/i, VIDEO],

  // Edge scripting
  [/^\/compute\/script\/\d+\/code$/i, PASSTHROUGH],      // the operator's own source
  [/^\/compute\/script(\/\d+)?$/i, EDGE_SCRIPT],

  // Shield
  [/^\/shield\/metrics\//i, PASSTHROUGH],
  [/^\/shield\/waf\/(custom-)?rules?(\/.*)?$/i, WAF_RULE],
  [/^\/shield\/waf\/profiles(\/.*)?$/i, PASSTHROUGH],
  [/^\/shield\/rate-limits?(\/.*)?$/i, RATE_LIMIT_RULE],
  [/^\/shield\/shield-zone(\/.*)?$/i, SHIELD_ZONE],

  // Magic Containers
  [/^\/mc\/apps\/[^/]+\/(overview|statistics)$/i, PASSTHROUGH],
  [/^\/mc\/apps(\/[^/]+)?$/i, MAGIC_CONTAINER_APP],
  [/^\/mc\/registries$/i, MC_REGISTRY],
  [/^\/mc\/regions$/i, PASSTHROUGH],

  // Account & misc
  [/^\/user$/i, ACCOUNT],
  [/^\/billing(\/.*)?$/i, PASSTHROUGH],
  [/^\/statistics$/i, PASSTHROUGH],
  [/^\/countries$/i, PASSTHROUGH],
  [/^\/region$/i, PASSTHROUGH],
  [/^\/search$/i, PASSTHROUGH],
  [/^\/origin-?errors?(\/.*)?$/i, PASSTHROUGH],
];

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
  if (Array.isArray(value.Items)) {
    const out = pick(value, PAGE_FIELDS.filter((f) => f !== "Items"));
    out.Items = value.Items.map((v) => projectValue(v, fields));
    return out;
  }
  return pick(value, fields);
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
