/**
 * Edge Scripting tools (7 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, idParam } from "../helpers.js";

export function registerEdgeScriptingTools(server, http, cache) {
  // ─── bunny_list_edge_scripts ──────────────────────────────────────────────

  server.tool(
    "bunny_list_edge_scripts",
    "List all Bunny Edge Scripts in the account. Edge scripts are serverless JavaScript functions that run on bunny.net's edge network, used for custom request/response handling.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Edge Scripts" },
    async () => {
      try {
        const cacheKey = "edgescripts";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/compute/script");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_edge_script ────────────────────────────────────────────────

  server.tool(
    "bunny_get_edge_script",
    "Retrieve edge script details by ID, including configuration, linked pull zones, deployment status, integration type, and release history.",
    {
      id: idParam("Edge Script"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Edge Script" },
    async ({ id }) => {
      try {
        const cacheKey = `edgescript:${id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/compute/script/${id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_edge_script_code ───────────────────────────────────────────

  server.tool(
    "bunny_get_edge_script_code",
    "Retrieve the JavaScript source code of an edge script.",
    {
      id: idParam("Edge Script"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Edge Script Code" },
    async ({ id }) => {
      try {
        const cacheKey = `edgescript:${id}:code`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/compute/script/${id}/code`);
        const result = formatResponse({ code: res.data });
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_set_edge_script_code ───────────────────────────────────────────

  server.tool(
    "bunny_set_edge_script_code",
    "Upload or replace the JavaScript source code for an edge script. The new code is saved as a draft — use bunny_publish_edge_script to deploy it live.",
    {
      id: idParam("Edge Script"),
      code: z.string().min(1).describe("JavaScript source code for the edge script"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Set Edge Script Code" },
    async ({ id, code }) => {
      try {
        await http.post(`/compute/script/${id}/code`, code, {
          headers: { "Content-Type": "application/javascript" },
        });
        return formatResponse({ success: true, message: `Code updated for edge script ${id}` });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_edge_script ─────────────────────────────────────────────

  server.tool(
    "bunny_manage_edge_script",
    "Create, update, or delete an edge script. Script types: 0=Standalone (handles full requests), 1=Middleware (runs before pull zone origin). For create, provide name and type. For update, provide settings with BunnyCDN PascalCase field names.",
    {
      action: z.enum(["create", "update", "delete"]).describe("Action: create, update, or delete"),
      id: z.number().optional().describe("Edge Script ID (required for update/delete)"),
      name: z.string().optional().describe("Script name (required for create)"),
      type: z.number().optional().describe("Script type: 0=Standalone, 1=Middleware (for create)"),
      settings: z.record(z.any()).optional().describe("Settings object with BunnyCDN PascalCase field names (for update)"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage Edge Script" },
    async ({ action, id, name, type, settings }) => {
      try {
        switch (action) {
          case "create": {
            const body = { Name: name };
            if (type !== undefined) body.ScriptType = type;
            const res = await http.post("/compute/script", body);
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.post(`/compute/script/${id}`, settings);
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/compute/script/${id}`);
            return formatResponse({ success: true, message: `Edge script ${id} deleted` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_publish_edge_script ────────────────────────────────────────────

  server.tool(
    "bunny_publish_edge_script",
    "Publish a release for an edge script, deploying the current (or specified) code version to all edge servers globally. Optionally provide a release note.",
    {
      id: idParam("Edge Script"),
      uuid: z.string().optional().describe("Specific release UUID to publish. If omitted, publishes the latest code."),
      note: z.string().optional().describe("Release note/description"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Publish Edge Script" },
    async ({ id, uuid, note }) => {
      try {
        const url = uuid
          ? `/compute/script/${id}/publish/${uuid}`
          : `/compute/script/${id}/publish`;
        const body = note ? { Note: note } : {};
        const res = await http.post(url, body);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_list_edge_script_variables ─────────────────────────────────────
  //
  // The listing lives in its own tool because the read-only gate keys on a
  // TOOL's annotation, and a mixed-operation tool can only carry one. Folding
  // the list into `bunny_manage_edge_script_variables` meant read-only users
  // lost the only way to see which variables and secrets a script even has —
  // a GET, withheld for its neighbours' sake.
  //
  // Names and requirements come back; values never do, for variables as much as
  // for secrets. See EDGE_SCRIPT_VARIABLE in lib/project.js: an operator putting
  // an API key in a plain variable is the normal thing to do.

  server.tool(
    "bunny_list_edge_script_variables",
    "List the environment variables or secrets defined on an edge script. Returns each entry's id, name and whether it is required — never its value. Read-only.",
    {
      id: idParam("Edge Script"),
      resource: z.enum(["variable", "secret"]).describe("Resource type: variable or secret"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Script Variables" },
    async ({ id, resource }) => {
      try {
        const path = resource === "variable"
          ? `/compute/script/${id}/variables`
          : `/compute/script/${id}/secrets`;
        const cacheKey = `edgescript:${id}:${resource}s`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(path);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_edge_script_variables ───────────────────────────────────

  server.tool(
    "bunny_manage_edge_script_variables",
    "Manage environment variables or encrypted secrets for an edge script. Variables are plaintext key-value pairs accessible at runtime. Secrets are encrypted and never returned in plaintext after creation. Actions: list, add, update, delete, upsert (create or update by name).",
    {
      id: idParam("Edge Script"),
      resource: z.enum(["variable", "secret"]).describe("Resource type: variable or secret"),
      action: z.enum(["list", "add", "update", "delete", "upsert"]).describe("Action to perform"),
      resource_id: z.number().optional().describe("Variable/secret ID (required for update/delete)"),
      name: z.string().optional().describe("Variable/secret name (for add/upsert)"),
      value: z.string().optional().describe("Variable/secret value (for add/update/upsert)"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage Script Variables" },
    async ({ id, resource, action, resource_id, name, value }) => {
      try {
        const basePath = resource === "variable"
          ? `/compute/script/${id}/variables`
          : `/compute/script/${id}/secrets`;

        switch (action) {
          case "list": {
            const cacheKey = `edgescript:${id}:${resource}s`;
            const cached = cache.get(cacheKey);
            if (cached) return cached;

            const res = await http.get(basePath);
            const result = formatResponse(res.data);
            cache.set(cacheKey, result);
            return result;
          }
          case "add": {
            const res = await http.post(basePath, { Name: name, Value: value });
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.post(`${basePath}/${resource_id}`, { Name: name, Value: value });
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`${basePath}/${resource_id}`);
            return formatResponse({ success: true, message: `${resource} ${resource_id} deleted` });
          }
          case "upsert": {
            const res = await http.put(basePath, { Name: name, Value: value });
            return formatResponse(res.data);
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
