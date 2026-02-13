/**
 * Origin error log tools (1 tool).
 */

import { z } from "zod";
import { formatResponse, handleToolError, idParam } from "../helpers.js";

export function registerOriginErrorTools(server, http, cache) {
  // ─── bunny_get_origin_errors ──────────────────────────────────────────────

  server.tool(
    "bunny_get_origin_errors",
    "Retrieve origin error logs for a pull zone on a specific date. Shows exactly why origin requests failed, including error codes: dns_lookup, http_timeout, http_request_exception, http_request_failure, http_invalid_range, http_loop_detected, http_invalid_compression, network_socket_exception, network_io_error, notfound_localdb. Essential for debugging 502/504 errors.",
    {
      pull_zone_id: idParam("Pull Zone"),
      date: z.string().describe("Date in MM-dd-yyyy format, e.g. '02-13-2026'"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Origin Errors" },
    async ({ pull_zone_id, date }) => {
      try {
        const cacheKey = `originerrors:${pull_zone_id}:${date}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/${pull_zone_id}/${date}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
