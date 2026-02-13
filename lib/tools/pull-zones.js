/**
 * Pull Zone (CDN) tools (8 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, pageParam, perPageParam, idParam } from "../helpers.js";

export function registerPullZoneTools(server, http, cache) {
  // ─── bunny_list_pull_zones ────────────────────────────────────────────────

  server.tool(
    "bunny_list_pull_zones",
    "List all CDN pull zones in the account with optional search and pagination. Each pull zone represents a CDN distribution endpoint (name.b-cdn.net) connected to an origin URL or storage zone.",
    {
      page: pageParam(),
      per_page: perPageParam(),
      search: z.string().optional().describe("Search term to filter pull zones by name"),
      include_certificate: z.boolean().optional().describe("Include SSL certificate details in response"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Pull Zones" },
    async ({ page, per_page, search, include_certificate }) => {
      try {
        const qs = buildQueryString({ page, perPage: per_page, search, includeCertificate: include_certificate });
        const cacheKey = `pullzones${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/pullzone${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_pull_zone ──────────────────────────────────────────────────

  server.tool(
    "bunny_get_pull_zone",
    "Retrieve full configuration of a CDN pull zone by ID, including origin URL, hostnames, caching settings, security options, edge rules, and optimizer config.",
    {
      id: idParam("Pull Zone"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Pull Zone" },
    async ({ id }) => {
      try {
        const cacheKey = `pullzone:${id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/pullzone/${id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_create_pull_zone ───────────────────────────────────────────────

  server.tool(
    "bunny_create_pull_zone",
    "Create a new CDN pull zone. The pull zone gets a default hostname (name.b-cdn.net) and caches content from the specified origin_url. Alternatively, set storage_zone_id to use a bunny.net storage zone as origin.",
    {
      name: z.string().min(1).describe("Pull zone name (used in the b-cdn.net subdomain)"),
      origin_url: z.string().describe("Origin server URL to pull content from"),
      type: z.number().optional().describe("Pull zone type: 0=Premium, 1=Volume. Default: 0"),
      storage_zone_id: z.number().optional().describe("Storage Zone ID to use as origin instead of origin_url"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Create Pull Zone" },
    async ({ name, origin_url, type, storage_zone_id }) => {
      try {
        const body = { Name: name, OriginUrl: origin_url };
        if (type !== undefined) body.Type = type;
        if (storage_zone_id !== undefined) body.StorageZoneId = storage_zone_id;
        const res = await http.post("/pullzone", body);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_update_pull_zone ───────────────────────────────────────────────

  server.tool(
    "bunny_update_pull_zone",
    "Update pull zone settings. Pass a settings object with BunnyCDN API field names (PascalCase). Common fields: OriginUrl, AllowedReferrers, BlockedReferrers, BlockedIps, EnableGeoZoneUS, EnableGeoZoneEU, EnableGeoZoneASIA, CacheControlMaxAgeOverride, EnableQueryStringSort, EnableWebpVary, EnableAvifVary, EnableCacheSlice, EnableOriginShield, OriginShieldZoneCode.",
    {
      id: idParam("Pull Zone"),
      settings: z.record(z.any()).describe("Settings object with BunnyCDN API field names (PascalCase). See description for common fields."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Update Pull Zone" },
    async ({ id, settings }) => {
      try {
        const res = await http.post(`/pullzone/${id}`, settings);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_delete_pull_zone ───────────────────────────────────────────────

  server.tool(
    "bunny_delete_pull_zone",
    "Permanently delete a CDN pull zone and all its configuration (hostnames, edge rules, cache). This action is irreversible and immediately stops content delivery on all associated hostnames.",
    {
      id: idParam("Pull Zone"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true, title: "Delete Pull Zone" },
    async ({ id }) => {
      try {
        await http.delete(`/pullzone/${id}`);
        return formatResponse({ success: true, message: `Pull zone ${id} deleted` });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_purge_pull_zone_cache ──────────────────────────────────────────

  server.tool(
    "bunny_purge_pull_zone_cache",
    "Purge the entire CDN cache for a pull zone, forcing all edge servers to fetch fresh content from the origin on the next request. Does not delete origin files. For single-URL purge, use bunny_purge_url instead.",
    {
      id: idParam("Pull Zone"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Purge Pull Zone Cache" },
    async ({ id }) => {
      try {
        await http.post(`/pullzone/${id}/purgeCache`);
        return formatResponse({ success: true, message: `Cache purged for pull zone ${id}` });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_pull_zone_hostnames ─────────────────────────────────────

  server.tool(
    "bunny_manage_pull_zone_hostnames",
    "Add or remove a custom hostname (e.g. cdn.example.com) on a CDN pull zone. After adding, point a CNAME record to the pull zone's b-cdn.net hostname. A free SSL certificate is provisioned automatically.",
    {
      id: idParam("Pull Zone"),
      action: z.enum(["add", "remove"]).describe("Action to perform: 'add' or 'remove'"),
      hostname: z.string().min(1).describe("Custom hostname, e.g. cdn.example.com"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Manage Hostnames" },
    async ({ id, action, hostname }) => {
      try {
        if (action === "add") {
          await http.post(`/pullzone/${id}/addHostname`, { Hostname: hostname });
          return formatResponse({ success: true, message: `Hostname ${hostname} added to pull zone ${id}` });
        } else {
          await http.delete(`/pullzone/${id}/removeHostname`, { data: { Hostname: hostname } });
          return formatResponse({ success: true, message: `Hostname ${hostname} removed from pull zone ${id}` });
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_edge_rules ──────────────────────────────────────────────

  server.tool(
    "bunny_manage_edge_rules",
    "Manage edge rules on a CDN pull zone. Edge rules let you control redirects, headers, caching, and origin routing at the edge. Actions: 'upsert' creates or updates a rule, 'delete' removes it, 'enable'/'disable' toggles it. For upsert, provide edge_rule with: ActionType (number), TriggerMatchingType (0=MatchAny, 1=MatchAll), Triggers (array), ActionParameter1, ActionParameter2, Description, Enabled. ActionTypes: 0=ForceSSL, 1=Redirect, 2=OriginUrl, 3=OverrideCacheTime, 4=BlockRequest, 5=SetResponseHeader, 6=SetRequestHeader, 7=ForceDownload, 8=DisableTokenAuth, 9=EnableTokenAuth, 10=OverrideCacheTimePublic, 11=IgnoreQueryString, 14=DisableOptimizer, 15=ForceCompression, 16=SetStatusCode, 17=OriginStorage, 18=SetNetworkRateLimit, 19=SetConnectionLimit, 20=SetRequestsPerSecondLimit.",
    {
      pull_zone_id: idParam("Pull Zone"),
      action: z.enum(["upsert", "delete", "enable", "disable"]).describe("Action: upsert, delete, enable, or disable"),
      edge_rule_id: z.string().optional().describe("Edge rule GUID (required for delete/enable/disable)"),
      edge_rule: z.record(z.any()).optional().describe("Edge rule object (required for upsert). Use BunnyCDN PascalCase field names."),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage Edge Rules" },
    async ({ pull_zone_id, action, edge_rule_id, edge_rule }) => {
      try {
        switch (action) {
          case "upsert": {
            const res = await http.post(`/pullzone/${pull_zone_id}/edgerules/addOrUpdate`, edge_rule);
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/pullzone/${pull_zone_id}/edgerules/${edge_rule_id}`);
            return formatResponse({ success: true, message: `Edge rule ${edge_rule_id} deleted` });
          }
          case "enable": {
            await http.post(`/pullzone/${pull_zone_id}/edgerules/${edge_rule_id}/setEdgeRuleEnabled`, { Id: pull_zone_id, Value: true });
            return formatResponse({ success: true, message: `Edge rule ${edge_rule_id} enabled` });
          }
          case "disable": {
            await http.post(`/pullzone/${pull_zone_id}/edgerules/${edge_rule_id}/setEdgeRuleEnabled`, { Id: pull_zone_id, Value: false });
            return formatResponse({ success: true, message: `Edge rule ${edge_rule_id} disabled` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
