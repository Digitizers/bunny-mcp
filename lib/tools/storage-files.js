/**
 * Storage file operation tools via Storage API (3 tools).
 * Only registered when BUNNY_STORAGE_KEY is provided.
 */

import { z } from "zod";
import { formatResponse, handleToolError } from "../helpers.js";

export function registerStorageFileTools(server, http, cache) {
  // ─── bunny_list_storage_files ─────────────────────────────────────────────

  server.tool(
    "bunny_list_storage_files",
    "List files and directories at a given path in a storage zone. Returns file names, sizes, last modified dates, checksums, and whether each entry is a file or directory.",
    {
      storage_zone: z.string().min(1).describe("Storage zone name"),
      path: z.string().optional().describe("Directory path within the storage zone. Default: root (/)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "List Storage Files" },
    async ({ storage_zone, path }) => {
      try {
        const dirPath = path ? `/${storage_zone}/${path}/` : `/${storage_zone}/`;
        const cacheKey = `storage:list:${dirPath}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const res = await http.get(dirPath);
        const result = formatResponse(res.data);
        cache.set(cacheKey, result);
        return result;
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_download_storage_file ──────────────────────────────────────────

  server.tool(
    "bunny_download_storage_file",
    "Download and return the content of a file from a storage zone. Text files (HTML, CSS, JS, JSON, XML) are returned as UTF-8 text, truncated at 100 KB for large files. Binary files return metadata only (size, content type).",
    {
      storage_zone: z.string().min(1).describe("Storage zone name"),
      path: z.string().min(1).describe("File path within the storage zone, e.g. 'css/styles.css'"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, title: "Download Storage File" },
    async ({ storage_zone, path }) => {
      try {
        const filePath = `/${storage_zone}/${path}`;
        const res = await http.get(filePath, { responseType: "arraybuffer" });

        const contentType = res.headers["content-type"] || "";
        const isText = contentType.includes("text") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("javascript") || contentType.includes("css");

        if (isText) {
          let text = Buffer.from(res.data).toString("utf-8");
          const maxLen = 100 * 1024;
          if (text.length > maxLen) {
            text = text.slice(0, maxLen) + `\n\n--- Truncated at ${maxLen} bytes (total: ${res.data.byteLength} bytes) ---`;
          }
          return formatResponse({ path: filePath, contentType, size: res.data.byteLength, content: text });
        }

        return formatResponse({ path: filePath, contentType, size: res.data.byteLength, note: "Binary file — content not displayed" });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // ─── bunny_delete_storage_file ────────────────────────────────────────────

  server.tool(
    "bunny_delete_storage_file",
    "Permanently delete a file or directory from a storage zone. If the path is a directory, all contents are deleted recursively. This action is irreversible.",
    {
      storage_zone: z.string().min(1).describe("Storage zone name"),
      path: z.string().min(1).describe("File or directory path within the storage zone"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true, title: "Delete Storage File" },
    async ({ storage_zone, path }) => {
      try {
        const filePath = `/${storage_zone}/${path}`;
        await http.delete(filePath);
        return formatResponse({ success: true, message: `Deleted ${filePath}` });
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
