/**
 * Stream Video Library management tools via Core API (4 tools).
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, pageParam, perPageParam, idParam } from "../helpers.js";

export function registerStreamLibraryTools(server, http, cache) {
  // ─── bunny_list_video_libraries ───────────────────────────────────────────

  server.tool(
    "bunny_list_video_libraries",
    "List all Bunny Stream video libraries in the account. Each library is an isolated container for videos with its own player settings, encoding config, API keys, and DRM/watermark options.",
    {
      page: pageParam(),
      per_page: perPageParam(),
      search: z.string().optional().describe("Search term to filter by library name"),
      include_access_key: z.boolean().optional().describe("Include API access keys in response"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Video Libraries" },
    async ({ page, per_page, search, include_access_key }) => {
      try {
        const qs = buildQueryString({ page, perPage: per_page, search, includeAccessKey: include_access_key });
        const cacheKey = `videolibs${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/videolibrary${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_video_library ──────────────────────────────────────────────

  server.tool(
    "bunny_get_video_library",
    "Retrieve video library details by ID, including player configuration, security settings (token auth, allowed/blocked referrers), encoding config (resolutions, bitrates), DRM, watermark, and transcribing settings.",
    {
      id: idParam("Video Library"),
      include_access_key: z.boolean().optional().describe("Include API access keys in response"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Video Library" },
    async ({ id, include_access_key }) => {
      try {
        const qs = buildQueryString({ includeAccessKey: include_access_key });
        const cacheKey = `videolib:${id}${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/videolibrary/${id}${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_create_video_library ───────────────────────────────────────────

  server.tool(
    "bunny_create_video_library",
    "Create a new Bunny Stream video library for hosting, encoding, and delivering videos. Optionally specify replication regions for geo-redundant storage.",
    {
      name: z.string().min(1).describe("Video library name"),
      replication_regions: z.array(z.string()).optional().describe("Replication region codes, e.g. ['UK', 'SE', 'NY', 'LA', 'SG', 'SYD', 'BR', 'JH']"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Create Video Library" },
    async ({ name, replication_regions }) => {
      try {
        const body = { Name: name };
        if (replication_regions) body.ReplicationRegions = replication_regions;
        const res = await http.post("/videolibrary", body);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_update_video_library ───────────────────────────────────────────

  server.tool(
    "bunny_update_video_library",
    "Update video library settings. Common fields (PascalCase): Name, CustomHTML, PlayerKeyColor, EnableTokenAuthentication, EnableTokenIPVerification, AllowedReferrers, BlockedReferrers, EnableMP4Fallback, KeepOriginalFiles, EnableDRM, Bitrate240p through Bitrate4K, WatermarkPositionLeft, WatermarkPositionTop, WatermarkWidth, WatermarkHeight, EnabledResolutions, EnableTranscribing, EnableTranscribingTitleGeneration, EnableTranscribingDescriptionGeneration, TranscribingCaptionLanguages.",
    {
      id: idParam("Video Library"),
      settings: z.record(z.any()).describe("Settings object with BunnyCDN API field names (PascalCase)."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Update Video Library" },
    async ({ id, settings }) => {
      try {
        const res = await http.post(`/videolibrary/${id}`, settings);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
