/**
 * Registration guard and response interceptors — the two safety boundaries.
 *
 * Neither is a per-tool concern, so neither lives in a tool module: a boundary
 * that has to be re-applied in sixty-eight places is a boundary that will be
 * missed in one of them. Both are installed once, in index.js, and every tool
 * inherits them whether or not its author knew they existed.
 */

import { projectResponse, projectStorageListing, projectErrorBody, shapeFor, normalisePath, RAW } from "./project.js";

/**
 * Wraps an McpServer so write-capable tools are never registered in read-only
 * mode — absent from `tools/list`, not merely discouraged.
 *
 * The MCP `destructiveHint` is advice to a *client*; a client is free to ignore
 * it, and an agent that never sees the tool cannot call it either way. Gating
 * registration is the difference between a warning and a control.
 *
 * FAIL CLOSED: a tool is registered in read-only mode only when it declares
 * `readOnlyHint: true`. A tool with no annotations at all — a new one whose
 * author forgot them — counts as a writer and is withheld. The alternative
 * (withhold only what declares `destructiveHint`) would let an unannotated
 * delete tool through, which is exactly the tool you cannot afford to miss.
 *
 * @param {object} server   The McpServer to wrap.
 * @param {boolean} readOnly Whether to withhold write-capable tools.
 * @returns {{server: object, withheld: string[]}}
 */
export function guardRegistration(server, readOnly) {
  const withheld = [];
  if (!readOnly) return { server, withheld };

  const proxy = Object.create(server);
  proxy.tool = (name, description, schema, annotations, handler) => {
    const isRead = annotations !== null
      && typeof annotations === "object"
      && annotations.readOnlyHint === true;
    if (!isRead) {
      withheld.push(name);
      return undefined;
    }
    return server.tool(name, description, schema, annotations, handler);
  };
  return { server: proxy, withheld };
}

/**
 * Installs the projection interceptor on an axios instance.
 *
 * Redaction happens here — at the transport, before any tool sees the payload —
 * rather than in each tool's response formatting. A tool cannot forget to
 * redact something it never receives, and a tool added later is covered on the
 * day it is written.
 *
 * `mode` is "api" for the management/stream/origin hosts (path-keyed shapes) or
 * "storage" for the storage host (every JSON response is a file listing).
 *
 * A path with no declared shape raises, carrying the projector's message. The
 * tool modules already funnel thrown errors through `handleToolError`, so the
 * operator gets a clear "add this path" message instead of a leak.
 *
 * @param {import("axios").AxiosInstance} http
 * @param {"api"|"storage"} mode
 */
/**
 * The response's media type, lower-cased.
 *
 * A media type is case-insensitive by RFC 9110, and an intermediary is free to
 * send `Application/JSON`. Comparing the raw header made that spelling read as
 * "not JSON", which on the storage client meant a directory listing skipped the
 * projector and returned every unknown field.
 */
function mediaType(res) {
  return String(res?.headers?.["content-type"] ?? "").toLowerCase();
}

export function installProjection(http, mode = "api", allowSource = false) {
  http.interceptors.response.use((res) => {
    // A file download is the operator's own stored content, not Bunny account
    // metadata, so it passes through whole. The discriminator is the REQUEST,
    // never the response's content type: the download tool asks for an
    // arraybuffer, and a stored .json file comes back as `application/json`
    // — content-type alone would hand that buffer to the listing projector,
    // which would reduce the operator's file to `{}` and call it success.
    if (String(res.config?.responseType ?? "") === "arraybuffer") return res;

    if (mode === "storage") {
      // Everything left here is a LISTING. A download was already returned
      // above, identified by the request asking for an arraybuffer — which is
      // knowledge about what was asked for, not a claim by the responder. The
      // header is not consulted at all: a listing mislabelled `text/plain` or
      // `application/octet-stream` would otherwise skip the allow-list and
      // return every unknown field, and lower-casing the header does nothing
      // about a header that is simply wrong.
    } else {
      // A non-JSON body on the management API is not automatically a file. It
      // passes only where the route declares RAW — and what happens to a RAW
      // body is decided below, by the ROUTE, so that a missing or misleading
      // Content-Type cannot route source around the source policy.
      const type = mediaType(res);
      if (type && !type.includes("json") && shapeFor(res.config?.url ?? "") !== RAW) {
        throw new Error(
          `A non-JSON response from "${normalisePath(res.config?.url ?? "")}" has no declared policy. ` +
          "Declare the route RAW in lib/project.js if its body is safe to return.",
        );
      }
    }
    if (res.data === undefined || res.data === null || res.data === "") return res;

    if (mode === "storage") {
      res.data = projectStorageListing(res.data);
      return res;
    }

    const path = res.config?.url ?? "";
    const projected = projectResponse(path, res.data);
    if (!projected.ok) throw new Error(projected.error);

    // The source policy is applied HERE, keyed on the route, for every RAW
    // response — whatever its Content-Type said, or failed to say. Deciding it
    // in the non-JSON branch meant a code endpoint answering with no header, or
    // with `application/json`, walked past the gate.
    if (projected.raw && !allowSource) {
      const size = typeof projected.data === "string"
        ? projected.data.length
        : (projected.data?.length ?? 0);
      res.data = `(withheld: ${size} bytes of operator-authored source. Set BUNNY_ALLOW_SOURCE=1 to return it.)`;
      return res;
    }
    res.data = projected.data;
    return res;
  },
  (err) => {
    // The other half of the boundary. Axios sends a non-2xx response to THIS
    // handler, not the one above, so without it every error body bypassed
    // projection entirely — and `handleToolError` forwards `body.Message`
    // verbatim to the client. Bunny quotes submitted values back in validation
    // messages, and what these tools submit includes edge-script secrets.
    if (err?.response && "data" in err.response) {
      // "Did we submit anything that could be quoted back?" — and a query
      // string is submitting. `bunny_purge_url` puts the URL to purge in
      // `?url=...` with no body at all, and a signed URL's token is in that
      // query string, so keying on the body alone left the one tool whose
      // parameter IS a credential uncovered.
      const cfg          = err.config ?? {};
      const hasBody      = cfg.data !== undefined && cfg.data !== null && cfg.data !== "";
      const hasQuery     = String(cfg.url ?? "").includes("?")
        || (cfg.params !== undefined && cfg.params !== null && Object.keys(cfg.params).length > 0);
      const sentPayload  = hasBody || hasQuery;
      err.response.data = projectErrorBody(err.response.data, sentPayload);
    }
    return Promise.reject(err);
  });
}

/** Reads BUNNY_READONLY from the environment. Anything but an explicit off is on. */
export function readOnlyFromEnv(env = process.env) {
  const raw = String(env.BUNNY_READONLY ?? "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

/**
 * Reads BUNNY_ALLOW_SOURCE. Off unless explicitly on — the mirror image of
 * BUNNY_READONLY, because the safe default is the opposite one here.
 */
export function allowSourceFromEnv(env = process.env) {
  const raw = String(env.BUNNY_ALLOW_SOURCE ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}
