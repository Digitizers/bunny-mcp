/**
 * Stream Video operation tools via Stream API (8 tools).
 * Only registered when BUNNY_STREAM_KEY is provided.
 */

import { z } from "zod";
import { formatResponse, handleToolError, buildQueryString, dateFromParam, dateToParam } from "../helpers.js";

export function registerStreamVideoTools(server, http, cache) {
  // ─── bunny_list_videos ────────────────────────────────────────────────────

  server.tool(
    "bunny_list_videos",
    "List videos in a Bunny Stream library with search, pagination, and ordering. Returns video GUIDs, titles, encoding status, duration, and storage size.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      page: z.number().min(1).optional().describe("Page number. Default: 1"),
      items_per_page: z.number().min(1).max(100).optional().describe("Items per page (max 100). Default: 100"),
      search: z.string().optional().describe("Search term to filter videos by title"),
      collection: z.string().optional().describe("Filter by collection GUID"),
      order_by: z.string().optional().describe("Sort field: date, title. Default: date"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Videos" },
    async ({ library_id, page, items_per_page, search, collection, order_by }) => {
      try {
        const qs = buildQueryString({ page, itemsPerPage: items_per_page, search, collection, orderBy: order_by });
        const cacheKey = `videos:${library_id}${qs}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/library/${library_id}/videos${qs}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_video ──────────────────────────────────────────────────────

  server.tool(
    "bunny_get_video",
    "Retrieve detailed information about a specific video, including encoding status, available resolutions, captions, chapters, moments, thumbnail URL, and playback URLs.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      video_id: z.string().min(1).describe("Video GUID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Video" },
    async ({ library_id, video_id }) => {
      try {
        const cacheKey = `video:${library_id}:${video_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/library/${library_id}/videos/${video_id}`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_create_video ───────────────────────────────────────────────────

  server.tool(
    "bunny_create_video",
    "Create a video object in a library. Returns a video GUID for subsequent upload. Optionally provide fetch_url to import a video from a remote URL — bunny.net will download and encode it automatically.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      title: z.string().min(1).describe("Video title"),
      collection_id: z.string().optional().describe("Collection GUID to add the video to"),
      fetch_url: z.string().optional().describe("Remote URL to fetch the video from (triggers automatic download and encoding)"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: "Create Video" },
    async ({ library_id, title, collection_id, fetch_url }) => {
      try {
        const body = { title };
        if (collection_id) body.collectionId = collection_id;

        if (fetch_url) {
          body.url = fetch_url;
          const res = await http.post(`/library/${library_id}/videos/fetch`, body);
          return formatResponse(res.data);
        }

        const res = await http.post(`/library/${library_id}/videos`, body);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_update_video ───────────────────────────────────────────────────

  server.tool(
    "bunny_update_video",
    "Update video metadata: title, collection assignment, chapters (with title/start/end), and moments (with label/timestamp).",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      video_id: z.string().min(1).describe("Video GUID"),
      title: z.string().optional().describe("New video title"),
      collection_id: z.string().optional().describe("Collection GUID to move the video to"),
      chapters: z.array(z.record(z.any())).optional().describe("Array of chapter objects: [{title, start, end}]"),
      moments: z.array(z.record(z.any())).optional().describe("Array of moment objects: [{label, timestamp}]"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Update Video" },
    async ({ library_id, video_id, title, collection_id, chapters, moments }) => {
      try {
        const body = {};
        if (title !== undefined) body.title = title;
        if (collection_id !== undefined) body.collectionId = collection_id;
        if (chapters !== undefined) body.chapters = chapters;
        if (moments !== undefined) body.moments = moments;

        const res = await http.post(`/library/${library_id}/videos/${video_id}`, body);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_delete_video ───────────────────────────────────────────────────

  server.tool(
    "bunny_delete_video",
    "Permanently delete a video and all its encoded files, captions, and thumbnails from a library. This action is irreversible.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      video_id: z.string().min(1).describe("Video GUID"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true, title: "Delete Video" },
    async ({ library_id, video_id }) => {
      try {
        await http.delete(`/library/${library_id}/videos/${video_id}`);
        return formatResponse({ success: true, message: `Video ${video_id} deleted` });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_get_video_statistics ───────────────────────────────────────────

  server.tool(
    "bunny_get_video_statistics",
    "Retrieve video view statistics: time-series views and watch time, plus country-level aggregates. Works at the library level (omit video_id) or for a specific video. Use hourly=true for granular data.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      video_id: z.string().optional().describe("Video GUID (optional — omit for library-level stats)"),
      date_from: dateFromParam(),
      date_to: dateToParam(),
      hourly: z.boolean().optional().describe("Return hourly data points"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Video Statistics" },
    async ({ library_id, video_id, date_from, date_to, hourly }) => {
      try {
        const qs = buildQueryString({ dateFrom: date_from, dateTo: date_to, hourly });

        let url;
        if (video_id) {
          url = `/library/${library_id}/videos/${video_id}/statistics${qs}`;
        } else {
          url = `/library/${library_id}/statistics${qs}`;
        }

        const cacheKey = `videostats:${url}`;
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

  // ─── bunny_get_video_heatmap ──────────────────────────────────────────────

  server.tool(
    "bunny_get_video_heatmap",
    "Retrieve the attention heatmap for a video, showing relative viewer interest across the timeline. Useful for identifying which segments viewers watch, rewatch, or skip. May be unavailable if there is not enough viewing data.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      video_id: z.string().min(1).describe("Video GUID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Get Video Heatmap" },
    async ({ library_id, video_id }) => {
      try {
        const cacheKey = `heatmap:${library_id}:${video_id}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(`/library/${library_id}/videos/${video_id}/heatmap`);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_reencode_video ─────────────────────────────────────────────────

  server.tool(
    "bunny_reencode_video",
    "Re-encode a video using the current library encoding settings. Useful after changing resolution/bitrate settings on the library, or if the original encoding had issues.",
    {
      library_id: z.number().int().positive().describe("Video Library ID"),
      video_id: z.string().min(1).describe("Video GUID"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Re-encode Video" },
    async ({ library_id, video_id }) => {
      try {
        const res = await http.post(`/library/${library_id}/videos/${video_id}/reencode`);
        return formatResponse(res.data);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
