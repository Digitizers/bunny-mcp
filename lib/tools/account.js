/**
 * Account, billing, statistics, search, and utility tools (7 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, pageParam, perPageParam, dateFromParam, dateToParam } from "../helpers.js";

export function registerAccountTools(server, http, cache) {
  // ─── bunny_get_account ────────────────────────────────────────────────────

  server.tool(
    "bunny_get_account",
    "Retrieve the current bunny.net account details: email, name, balance, billing type, enabled features, and feature flags. Use this to check account status or remaining balance before provisioning resources.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Account Details" },
    async () => {
      try {
        const cacheKey = "account";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/user");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_billing_summary ────────────────────────────────────────────

  server.tool(
    "bunny_get_billing_summary",
    "Retrieve the billing summary for the account: current balance, this month's charges, and per-service usage breakdown (CDN, Storage, DNS, Stream, etc.).",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Billing Summary" },
    async () => {
      try {
        const cacheKey = "billing:summary";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/billing");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_statistics ─────────────────────────────────────────────────

  server.tool(
    "bunny_get_statistics",
    "Retrieve account-wide or per-pull-zone CDN statistics over a date range. Returns time-series data for bandwidth, requests, cache hit rate, status codes (3xx/4xx/5xx), and geographic distribution. Use hourly=true for granular data.",
    {
      date_from: dateFromParam(),
      date_to: dateToParam(),
      pull_zone: z.number().optional().describe("Filter by Pull Zone ID"),
      server_zone_id: z.number().optional().describe("Filter by server zone/region ID"),
      hourly: z.boolean().optional().describe("Return hourly data points instead of daily"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get CDN Statistics" },
    async ({ date_from, date_to, pull_zone, server_zone_id, hourly }) => {
      try {
        const qs = buildQueryString({ dateFrom: date_from, dateTo: date_to, pullZone: pull_zone, serverZoneId: server_zone_id, hourly });
        const cacheKey = `stats${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/statistics${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_global_search ──────────────────────────────────────────────────

  server.tool(
    "bunny_global_search",
    "Search across all bunny.net resources by keyword. Returns matching pull zones, DNS zones, storage zones, video libraries, and edge scripts. Use this to find a resource when you only know part of its name.",
    {
      query: z.string().min(1).describe("Search query"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Global Search" },
    async ({ query }) => {
      try {
        const qs = buildQueryString({ search: query });
        const cacheKey = `search${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/search${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_purge_url ──────────────────────────────────────────────────────

  server.tool(
    "bunny_purge_url",
    "Purge a specific URL from the global CDN cache so the next request fetches fresh content from the origin. Append a wildcard (*) to purge all files under a path (e.g. https://example.b-cdn.net/css/*). Does not delete origin files.",
    {
      url: z.string().url().describe("The URL to purge from cache. Supports wildcard (*) at the end, e.g. https://example.b-cdn.net/css/*"),
      async: z.boolean().optional().describe("Perform purge asynchronously. Default: false"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Purge URL Cache" },
    async ({ url, async: isAsync }) => {
      try {
        const qs = buildQueryString({ url, async: isAsync });
        const res = await http.post(`/purge${qs}`);
        return formatResponse({ success: true, status: res.status });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_list_regions ───────────────────────────────────────────────────

  server.tool(
    "bunny_list_regions",
    "List all bunny.net CDN edge server regions with their IDs, names, pricing tiers, and geographic coordinates. Useful for choosing routing filters or understanding geo-distribution.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List CDN Regions" },
    async () => {
      try {
        const cacheKey = "regions";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/region");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_list_countries ─────────────────────────────────────────────────

  server.tool(
    "bunny_list_countries",
    "List all countries with their ISO 2-letter codes. Reference data for configuring geo-blocking, routing filters, and allowed/blocked country lists on pull zones.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Countries" },
    async () => {
      try {
        const cacheKey = "countries";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/country");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
