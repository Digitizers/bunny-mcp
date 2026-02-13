/**
 * Storage Zone management tools via Core API (4 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, pageParam, perPageParam, idParam, dateFromParam, dateToParam } from "../helpers.js";

export function registerStorageZoneTools(server, http, cache) {
  // ─── bunny_list_storage_zones ─────────────────────────────────────────────

  server.tool(
    "bunny_list_storage_zones",
    "List all Edge Storage zones in the account. Each storage zone is a file storage container with a primary region and optional replication. Storage zones can serve as origins for pull zones.",
    {
      page: pageParam(),
      per_page: perPageParam(),
      include_deleted: z.boolean().optional().describe("Include deleted storage zones"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Storage Zones" },
    async ({ page, per_page, include_deleted }) => {
      try {
        const qs = buildQueryString({ page, perPage: per_page, includeDeleted: include_deleted });
        const cacheKey = `storagezones${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/storagezone${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_storage_zone ───────────────────────────────────────────────

  server.tool(
    "bunny_get_storage_zone",
    "Retrieve storage zone details by ID, including primary region, replication regions, connected pull zones, storage used, and file count.",
    {
      id: idParam("Storage Zone"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Storage Zone" },
    async ({ id }) => {
      try {
        const cacheKey = `storagezone:${id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/storagezone/${id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_create_storage_zone ────────────────────────────────────────────

  server.tool(
    "bunny_create_storage_zone",
    "Create a new Edge Storage zone. Choose a primary region and optional replication regions for geo-redundancy. Region codes: DE (Falkenstein), UK (London), NY (New York), LA (Los Angeles), SG (Singapore), SYD (Sydney), BR (Sao Paulo), JH (Johannesburg). Default primary region is DE.",
    {
      name: z.string().min(1).describe("Storage zone name (3-20 chars, lowercase alphanumeric and hyphens)"),
      region: z.string().optional().describe("Primary region code: DE, UK, NY, LA, SG, SYD, BR, JH. Default: DE"),
      replication_regions: z.array(z.string()).optional().describe("Array of region codes for replication, e.g. ['UK', 'NY']"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Create Storage Zone" },
    async ({ name, region, replication_regions }) => {
      try {
        const body = { Name: name };
        if (region) body.Region = region;
        if (replication_regions) body.ReplicationRegions = replication_regions;
        const res = await http.post("/storagezone", body);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_storage_zone_statistics ────────────────────────────────────

  server.tool(
    "bunny_get_storage_zone_statistics",
    "Retrieve storage zone usage statistics over a date range: storage space used, file count, and bandwidth consumed.",
    {
      id: idParam("Storage Zone"),
      date_from: dateFromParam(),
      date_to: dateToParam(),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Storage Zone Statistics" },
    async ({ id, date_from, date_to }) => {
      try {
        const qs = buildQueryString({ dateFrom: date_from, dateTo: date_to });
        const cacheKey = `storagezone:${id}:stats${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/storagezone/${id}/statistics${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
