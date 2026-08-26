/**
 * Registration guard and response interceptors — the two safety boundaries.
 *
 * Neither is a per-tool concern, so neither lives in a tool module: a boundary
 * that has to be re-applied in sixty-eight places is a boundary that will be
 * missed in one of them. Both are installed once, in index.js, and every tool
 * inherits them whether or not its author knew they existed.
 */

import { projectResponse, projectStorageListing, projectErrorBody } from "./project.js";

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
export function installProjection(http, mode = "api") {
  http.interceptors.response.use((res) => {
    // A file download is the operator's own stored content, not Bunny account
    // metadata, so it passes through whole. The discriminator is the REQUEST,
    // never the response's content type: the download tool asks for an
    // arraybuffer, and a stored .json file comes back as `application/json`
    // — content-type alone would hand that buffer to the listing projector,
    // which would reduce the operator's file to `{}` and call it success.
    if (String(res.config?.responseType ?? "") === "arraybuffer") return res;

    const type = String(res.headers?.["content-type"] ?? "");
    if (type && !type.includes("json")) return res;
    if (res.data === undefined || res.data === null || res.data === "") return res;

    if (mode === "storage") {
      res.data = projectStorageListing(res.data);
      return res;
    }

    const path = res.config?.url ?? "";
    const projected = projectResponse(path, res.data);
    if (!projected.ok) throw new Error(projected.error);
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
      const sentPayload = err.config?.data !== undefined && err.config?.data !== null && err.config?.data !== "";
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
