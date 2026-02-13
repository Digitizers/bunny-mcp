/**
 * Helper functions for bunnycdn-mcp server.
 */

import { z } from "zod";

// ─── Cache ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL = 3 * 60 * 1000;
const MAX_ENTRIES = 300;

export function createCache(opts = {}) {
  const ttl = opts.ttl ?? DEFAULT_TTL;
  const max = opts.max ?? MAX_ENTRIES;
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.ts > ttl) { store.delete(key); return undefined; }
      return entry.data;
    },
    set(key, data) {
      if (store.size >= max) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }
      store.set(key, { data, ts: Date.now() });
    },
    get size() { return store.size; },
    clear() { store.clear(); },
  };
}

// ─── Query String ──────────────────────────────────────────────────────────

export function buildQueryString(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// ─── Response Formatters ───────────────────────────────────────────────────

export function formatResponse(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function formatError(msg) {
  return {
    content: [{ type: "text", text: msg }],
    isError: true,
  };
}

export function handleToolError(err) {
  if (err.response) {
    const body = err.response.data;
    const detail = body?.Message ?? body?.ErrorKey ?? "";
    return formatError(`BunnyCDN API error: ${err.response.status}${detail ? ` — ${detail}` : ""}`);
  }
  return formatError(`Network error: ${err.message}`);
}

// ─── Reusable Zod Parameters ───────────────────────────────────────────────

export function pageParam() {
  return z.number().min(1).optional().describe("Page number. Default: 1");
}

export function perPageParam() {
  return z.number().min(1).max(1000).optional().describe("Items per page. Default: 1000");
}

export function dateFromParam() {
  return z.string().optional().describe("Start date (YYYY-MM-DD or ISO 8601)");
}

export function dateToParam() {
  return z.string().optional().describe("End date (YYYY-MM-DD or ISO 8601)");
}

export function idParam(label) {
  return z.number().int().positive().describe(`${label} ID`);
}
