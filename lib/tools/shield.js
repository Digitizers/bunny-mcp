/**
 * Shield (Security) tools — WAF, rate limits, bot detection, access lists (8 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, idParam, dateFromParam, dateToParam } from "../helpers.js";

export function registerShieldTools(server, http, cache) {
  // ─── bunny_list_shield_zones ──────────────────────────────────────────────

  server.tool(
    "bunny_list_shield_zones",
    "List all Bunny Shield security zones. Each shield zone provides WAF, rate limiting, bot detection, and DDoS protection for one or more associated pull zones.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Shield Zones" },
    async () => {
      try {
        const cacheKey = "shieldzones";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/shield/shield-zones");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_shield_zone ────────────────────────────────────────────────

  server.tool(
    "bunny_get_shield_zone",
    "Retrieve shield zone configuration by shield zone ID or by the associated pull zone ID. Returns WAF settings, rate limit rules, bot detection config, and DDoS protection status.",
    {
      shield_zone_id: z.number().optional().describe("Shield Zone ID (use this OR pull_zone_id)"),
      pull_zone_id: z.number().optional().describe("Pull Zone ID to find its shield zone (use this OR shield_zone_id)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Shield Zone" },
    async ({ shield_zone_id, pull_zone_id }) => {
      try {
        let url;
        if (shield_zone_id) {
          url = `/shield/shield-zone/${shield_zone_id}`;
        } else if (pull_zone_id) {
          url = `/shield/shield-zone/get-by-pullzone/${pull_zone_id}`;
        } else {
          return formatResponse({ error: "Provide either shield_zone_id or pull_zone_id" });
        }

        const cacheKey = `shieldzone:${url}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(url);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_waf_rules ──────────────────────────────────────────────────

  server.tool(
    "bunny_get_waf_rules",
    "Retrieve all WAF rules and profiles configured for a shield zone, including managed rulesets (OWASP, etc.) and custom rules.",
    {
      shield_zone_id: idParam("Shield Zone"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get WAF Rules" },
    async ({ shield_zone_id }) => {
      try {
        const cacheKey = `waf:rules:${shield_zone_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const [rulesRes, profilesRes] = await Promise.all([
          http.get(`/shield/waf/rules/${shield_zone_id}`),
          http.get(`/shield/waf/profiles/${shield_zone_id}`),
        ]);

        const result = formatResponse({ rules: rulesRes.data, profiles: profilesRes.data });
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_waf_custom_rule ─────────────────────────────────────────

  server.tool(
    "bunny_manage_waf_custom_rule",
    "Create, update, or delete a custom WAF rule on a shield zone. Rule object fields: ruleName, ruleDescription, ruleConfiguration (with phases, variables, operators, transformations, actionType). Custom WAF rules let you block or allow traffic based on request attributes.",
    {
      shield_zone_id: idParam("Shield Zone"),
      action: z.enum(["create", "update", "delete"]).describe("Action: create, update, or delete"),
      rule_id: z.number().optional().describe("Custom WAF rule ID (required for update/delete)"),
      rule: z.record(z.any()).optional().describe("Custom WAF rule object (required for create/update)"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage Custom WAF Rule" },
    async ({ shield_zone_id, action, rule_id, rule }) => {
      try {
        switch (action) {
          case "create": {
            const body = { ...rule, shieldZoneId: shield_zone_id };
            const res = await http.post("/shield/waf/custom-rule", body);
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.put(`/shield/waf/custom-rule/${rule_id}`, rule);
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/shield/waf/custom-rule/${rule_id}`);
            return formatResponse({ success: true, message: `Custom WAF rule ${rule_id} deleted` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_list_rate_limit_rules ──────────────────────────────────────────

  server.tool(
    "bunny_list_rate_limit_rules",
    "List all rate limiting rules configured for a shield zone. Rate limit rules restrict the number of requests per second from matching clients.",
    {
      shield_zone_id: idParam("Shield Zone"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Rate Limit Rules" },
    async ({ shield_zone_id }) => {
      try {
        const cacheKey = `ratelimits:${shield_zone_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/shield/rate-limits/${shield_zone_id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_rate_limit_rule ─────────────────────────────────────────

  server.tool(
    "bunny_manage_rate_limit_rule",
    "Create, update, or delete a rate limit rule. Rule object fields: shieldZoneId, name, requestsPerSecond, blockTime, matchExpression, matchVariable, transformations, operator, matchValue. Rate limits block clients exceeding the configured request threshold.",
    {
      action: z.enum(["create", "update", "delete"]).describe("Action: create, update, or delete"),
      shield_zone_id: z.number().optional().describe("Shield Zone ID (required for create)"),
      rule_id: z.number().optional().describe("Rate limit rule ID (required for update/delete)"),
      rule: z.record(z.any()).optional().describe("Rate limit rule object (required for create/update)"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage Rate Limit Rule" },
    async ({ action, shield_zone_id, rule_id, rule }) => {
      try {
        switch (action) {
          case "create": {
            const body = { ...rule, shieldZoneId: shield_zone_id };
            const res = await http.post("/shield/rate-limit", body);
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.patch(`/shield/rate-limit/${rule_id}`, rule);
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/shield/rate-limit/${rule_id}`);
            return formatResponse({ success: true, message: `Rate limit rule ${rule_id} deleted` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_shield_metrics ─────────────────────────────────────────────

  server.tool(
    "bunny_get_shield_metrics",
    "Retrieve security metrics overview for a shield zone over a date range: WAF blocks, rate limit triggers, bot detections, and DDoS mitigation events.",
    {
      shield_zone_id: idParam("Shield Zone"),
      date_from: dateFromParam(),
      date_to: dateToParam(),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Shield Metrics" },
    async ({ shield_zone_id, date_from, date_to }) => {
      try {
        const qs = buildQueryString({ dateFrom: date_from, dateTo: date_to });
        const cacheKey = `shieldmetrics:${shield_zone_id}${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/shield/metrics/overview/${shield_zone_id}${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_bot_detection ──────────────────────────────────────────────

  // ─── bunny_read_bot_detection ─────────────────────────────────────────────
  //
  // The GET half, registered separately for the same reason
  // bunny_list_edge_script_variables was: the read-only gate keys on a TOOL's
  // annotation, and a tool that both reads and writes can only carry one. This
  // is the SECOND such tool — an earlier commit claimed the edge-script one was
  // the only mixed tool with a read path, and that claim was wrong. A sweep of
  // every write-annotated tool containing an `http.get` finds exactly these two.

  server.tool(
    "bunny_read_bot_detection",
    "Read a Shield zone's bot-detection configuration: whether it is enabled, its mode, sensitivity and categories. Read-only.",
    {
      shield_zone_id: idParam("Shield Zone"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Read Bot Detection" },
    async ({ shield_zone_id }) => {
      try {
        const cacheKey = `botdetection:${shield_zone_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/shield/shield-zone/${shield_zone_id}/bot-detection`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.tool(
    "bunny_get_bot_detection",
    "Retrieve or update bot detection settings for a shield zone. If settings are provided, updates them (e.g. enable/disable bot categories, adjust thresholds); otherwise returns current configuration.",
    {
      shield_zone_id: idParam("Shield Zone"),
      settings: z.record(z.any()).optional().describe("Bot detection settings to update (optional). If omitted, returns current settings."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Bot Detection Settings" },
    async ({ shield_zone_id, settings }) => {
      try {
        if (settings) {
          const res = await http.patch(`/shield/shield-zone/${shield_zone_id}/bot-detection`, settings);
          return formatResponse(res.data);
        }

        const cacheKey = `botdetection:${shield_zone_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/shield/shield-zone/${shield_zone_id}/bot-detection`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
