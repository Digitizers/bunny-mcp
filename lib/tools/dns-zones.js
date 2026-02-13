/**
 * DNS Zone tools (7 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, pageParam, perPageParam, idParam, dateFromParam, dateToParam } from "../helpers.js";

export function registerDnsTools(server, http, cache) {
  // ─── bunny_list_dns_zones ─────────────────────────────────────────────────

  server.tool(
    "bunny_list_dns_zones",
    "List all Bunny DNS zones in the account with optional search and pagination. Each DNS zone corresponds to a domain managed by bunny.net nameservers.",
    {
      page: pageParam(),
      per_page: perPageParam(),
      search: z.string().optional().describe("Search term to filter DNS zones by domain name"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List DNS Zones" },
    async ({ page, per_page, search }) => {
      try {
        const qs = buildQueryString({ page, perPage: per_page, search });
        const cacheKey = `dnszones${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/dnszone${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_dns_zone ───────────────────────────────────────────────────

  server.tool(
    "bunny_get_dns_zone",
    "Retrieve a DNS zone by ID, including all its DNS records, nameserver configuration, SOA settings, and DNSSEC status.",
    {
      id: idParam("DNS Zone"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get DNS Zone" },
    async ({ id }) => {
      try {
        const cacheKey = `dnszone:${id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/dnszone/${id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_create_dns_zone ────────────────────────────────────────────────

  server.tool(
    "bunny_create_dns_zone",
    "Create a new DNS zone for a domain. After creation, update the domain's nameservers at your registrar to point to the bunny.net nameservers returned in the response.",
    {
      domain: z.string().min(1).describe("Domain name for the DNS zone, e.g. example.com"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Create DNS Zone" },
    async ({ domain }) => {
      try {
        const res = await http.post("/dnszone", { Domain: domain });
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_update_dns_zone ────────────────────────────────────────────────

  server.tool(
    "bunny_update_dns_zone",
    "Update DNS zone settings. Common fields (PascalCase): CustomNameserversEnabled, Nameserver1, Nameserver2, SoaEmail, LoggingEnabled, LoggingIPAnonymizationEnabled.",
    {
      id: idParam("DNS Zone"),
      settings: z.record(z.any()).describe("Settings object with BunnyCDN API field names (PascalCase)."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Update DNS Zone" },
    async ({ id, settings }) => {
      try {
        const res = await http.post(`/dnszone/${id}`, settings);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_delete_dns_zone ────────────────────────────────────────────────

  server.tool(
    "bunny_delete_dns_zone",
    "Permanently delete a DNS zone and all its records. This action is irreversible and will stop DNS resolution for the domain if bunny.net nameservers are still active.",
    {
      id: idParam("DNS Zone"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true, title: "Delete DNS Zone" },
    async ({ id }) => {
      try {
        await http.delete(`/dnszone/${id}`);
        return formatResponse({ success: true, message: `DNS zone ${id} deleted` });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_dns_record ──────────────────────────────────────────────

  server.tool(
    "bunny_manage_dns_record",
    "Add, update, or delete a DNS record within a zone. Record types: 0=A, 1=AAAA, 2=CNAME, 3=TXT, 4=MX, 5=Redirect, 6=Flatten, 7=PullZone, 8=SRV, 9=CAA, 10=PTR, 11=Script, 12=NS. For add/update, provide a record object with fields: Type (number), Value, Name (subdomain or empty string for root), Ttl (seconds), Priority (for MX/SRV), Weight, Port.",
    {
      zone_id: idParam("DNS Zone"),
      action: z.enum(["add", "update", "delete"]).describe("Action: add, update, or delete"),
      record_id: z.number().optional().describe("DNS record ID (required for update/delete)"),
      record: z.record(z.any()).optional().describe("DNS record object (required for add/update). Use BunnyCDN PascalCase field names."),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage DNS Record" },
    async ({ zone_id, action, record_id, record }) => {
      try {
        switch (action) {
          case "add": {
            const res = await http.put(`/dnszone/${zone_id}/records`, record);
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.post(`/dnszone/${zone_id}/records/${record_id}`, record);
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/dnszone/${zone_id}/records/${record_id}`);
            return formatResponse({ success: true, message: `DNS record ${record_id} deleted` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_dns_statistics ─────────────────────────────────────────────

  server.tool(
    "bunny_get_dns_statistics",
    "Retrieve DNS query statistics for a zone over a date range, including total queries, queries by record type, and response code distribution.",
    {
      id: idParam("DNS Zone"),
      date_from: dateFromParam(),
      date_to: dateToParam(),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get DNS Statistics" },
    async ({ id, date_from, date_to }) => {
      try {
        const qs = buildQueryString({ dateFrom: date_from, dateTo: date_to });
        const cacheKey = `dnszone:${id}:stats${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/dnszone/${id}/statistics${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
