/**
 * Magic Containers tools (8 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, dateFromParam, dateToParam } from "../helpers.js";

export function registerMagicContainerTools(server, http, cache) {
  // ─── bunny_list_mc_apps ───────────────────────────────────────────────────

  server.tool(
    "bunny_list_mc_apps",
    "List all Magic Container applications in the account. Magic Containers are bunny.net's serverless container platform for deploying Docker images to the edge.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List MC Applications" },
    async () => {
      try {
        const cacheKey = "mc:apps";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/mc/apps");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_mc_app ────────────────────────────────────────────────────

  server.tool(
    "bunny_get_mc_app",
    "Retrieve Magic Container application details including container configuration, endpoints, deployment status, environment variables, volumes, and region settings.",
    {
      id: z.string().min(1).describe("Application ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get MC Application" },
    async ({ id }) => {
      try {
        const cacheKey = `mc:app:${id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/mc/apps/${id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_mc_app_overview ────────────────────────────────────────────

  server.tool(
    "bunny_get_mc_app_overview",
    "Retrieve application overview with real-time metrics: latency, CPU/RAM usage, active instance count across regions, and estimated cost breakdown.",
    {
      id: z.string().min(1).describe("Application ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get MC App Overview" },
    async ({ id }) => {
      try {
        const cacheKey = `mc:app:${id}:overview`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/mc/apps/${id}/overview`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_manage_mc_app ──────────────────────────────────────────────────

  server.tool(
    "bunny_manage_mc_app",
    "Create, update, or delete a Magic Container application. Config object fields: name, dockerImage, port, environmentVariables, regions, autoscaling settings. For create use PascalCase, for update use camelCase. Deleting removes the application and all associated resources.",
    {
      action: z.enum(["create", "update", "delete"]).describe("Action: create, update, or delete"),
      id: z.string().optional().describe("Application ID (required for update/delete)"),
      config: z.record(z.any()).optional().describe("Application configuration object (required for create/update)"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, title: "Manage MC Application" },
    async ({ action, id, config }) => {
      try {
        switch (action) {
          case "create": {
            const res = await http.post("/mc/apps", config);
            return formatResponse(res.data);
          }
          case "update": {
            const res = await http.put(`/mc/apps/${id}`, config);
            return formatResponse(res.data);
          }
          case "delete": {
            await http.delete(`/mc/apps/${id}`);
            return formatResponse({ success: true, message: `Application ${id} deleted` });
          }
        }
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_mc_app_lifecycle ───────────────────────────────────────────────

  server.tool(
    "bunny_mc_app_lifecycle",
    "Control the lifecycle of a Magic Container application. 'deploy' starts the application across configured regions, 'undeploy' stops all running instances, 'restart' triggers a rolling restart of all pods.",
    {
      id: z.string().min(1).describe("Application ID"),
      action: z.enum(["deploy", "undeploy", "restart"]).describe("Lifecycle action: deploy, undeploy, or restart"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "MC App Lifecycle" },
    async ({ id, action }) => {
      try {
        const res = await http.post(`/mc/apps/${id}/${action}`);
        return formatResponse({ success: true, action, message: `Application ${id} ${action} initiated`, data: res.data });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_list_mc_registries ─────────────────────────────────────────────

  server.tool(
    "bunny_list_mc_registries",
    "List container registries configured for pulling Docker images (Docker Hub, GHCR, custom registries). Registry credentials are used when deploying private container images.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List MC Registries" },
    async () => {
      try {
        const cacheKey = "mc:registries";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/mc/registries");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_list_mc_regions ────────────────────────────────────────────────

  server.tool(
    "bunny_list_mc_regions",
    "List available Magic Container deployment regions with their anycast support and capacity status. Use this to choose where to deploy applications.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List MC Regions" },
    async () => {
      try {
        const cacheKey = "mc:regions";
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get("/mc/regions");
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_mc_app_statistics ──────────────────────────────────────────

  server.tool(
    "bunny_get_mc_app_statistics",
    "Retrieve historical application statistics over a date range: CPU usage, RAM usage, network traffic (inbound/outbound), request latency, and volume storage usage.",
    {
      id: z.string().min(1).describe("Application ID"),
      date_from: dateFromParam(),
      date_to: dateToParam(),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get MC App Statistics" },
    async ({ id, date_from, date_to }) => {
      try {
        const qs = buildQueryString({ dateFrom: date_from, dateTo: date_to });
        const cacheKey = `mc:app:${id}:stats${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/mc/apps/${id}/statistics${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
