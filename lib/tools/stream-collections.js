/**
 * Stream Video Collection tools via Stream API (3 tools).
 * Only registered when BUNNY_STREAM_KEY is provided.
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString } from "../helpers.js";

export function registerStreamCollectionTools(server, http, cache) {
  // ─── bunny_list_collections ───────────────────────────────────────────────

  server.tool(
    "bunny_list_collections",
    "List video collections in a Bunny Stream library. Collections are folders for organizing videos within a library.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      page: z.number().min(1).optional().describe("Page number. Default: 1"),
      items_per_page: z.number().min(1).max(100).optional().describe("Items per page (max 100). Default: 100"),
      search: z.string().optional().describe("Search term to filter collections"),
      order_by: z.string().optional().describe("Sort field: date, title. Default: date"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Collections" },
    async ({ library_id, page, items_per_page, search, order_by }) => {
      try {
        const qs = buildQueryString({ page, itemsPerPage: items_per_page, search, orderBy: order_by });
        const cacheKey = `collections:${library_id}${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/library/${library_id}/collections${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_collection ─────────────────────────────────────────────────

  server.tool(
    "bunny_get_collection",
    "Retrieve collection details including name, video count, total storage size, and preview thumbnail URLs.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      collection_id: z.string().min(1).describe("Collection GUID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Collection" },
    async ({ library_id, collection_id }) => {
      try {
        const cacheKey = `collection:${library_id}:${collection_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/library/${library_id}/collections/${collection_id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_collection ──────────────────────────────────────────────

  server.tool(
    "bunny_manage_collection",
    "Create, update, or delete a video collection within a library. Collections organize videos into logical groups. Deleting a collection does not delete the videos inside it.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      action: z.enum(["create", "update", "delete"]).describe("Action: create, update, or delete"),
      collection_id: z.string().optional().describe("Collection GUID (required for update/delete)"),
      name: z.string().optional().describe("Collection name (required for create, optional for update)"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage Collection" },
    async ({ library_id, action, collection_id, name }) => {
      try {
        switch (action) {
          case "create": {
            const res = await http.post(`/library/${library_id}/collections`, { name });
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.post(`/library/${library_id}/collections/${collection_id}`, { name });
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/library/${library_id}/collections/${collection_id}`);
            return formatResponse({ success: true, message: `Collection ${collection_id} deleted` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
