#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createCache } from "./lib/helpers.js";
import { registerAccountTools } from "./lib/tools/account.js";
import { registerPullZoneTools } from "./lib/tools/pull-zones.js";
import { registerDnsTools } from "./lib/tools/dns-zones.js";
import { registerStorageZoneTools } from "./lib/tools/storage-zones.js";
import { registerStorageFileTools } from "./lib/tools/storage-files.js";
import { registerStreamLibraryTools } from "./lib/tools/stream-libraries.js";
import { registerStreamVideoTools } from "./lib/tools/stream-videos.js";
import { registerStreamCollectionTools } from "./lib/tools/stream-collections.js";
import { registerEdgeScriptingTools } from "./lib/tools/edge-scripting.js";
import { registerShieldTools } from "./lib/tools/shield.js";
import { registerMagicContainerTools } from "./lib/tools/magic-containers.js";
import { registerOriginErrorTools } from "./lib/tools/origin-errors.js";

// ─── Setup ───────────────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

// ─── Validate API Key ────────────────────────────────────────────────────────

const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
if (!BUNNY_API_KEY) {
  process.stderr.write("Fatal: BUNNY_API_KEY environment variable is required\n");
  process.exit(1);
}

// ─── HTTP Clients ────────────────────────────────────────────────────────────

const ua = `${pkg.name}/${pkg.version}`;

const coreHttp = axios.create({
  baseURL: "https://api.bunny.net",
  timeout: 15_000,
  maxContentLength: 5 * 1024 * 1024,
  headers: { "User-Agent": ua, "AccessKey": BUNNY_API_KEY, "Accept": "application/json" },
});

const originHttp = axios.create({
  baseURL: "https://cdn-origin-logging.bunny.net",
  timeout: 15_000,
  maxContentLength: 5 * 1024 * 1024,
  headers: { "User-Agent": ua, "AccessKey": BUNNY_API_KEY, "Accept": "application/json" },
});

const BUNNY_STREAM_KEY = process.env.BUNNY_STREAM_KEY;
const streamHttp = BUNNY_STREAM_KEY ? axios.create({
  baseURL: "https://video.bunnycdn.com",
  timeout: 15_000,
  maxContentLength: 5 * 1024 * 1024,
  headers: { "User-Agent": ua, "AccessKey": BUNNY_STREAM_KEY, "Accept": "application/json" },
}) : null;

const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_KEY;
const storageRegion = process.env.BUNNY_STORAGE_REGION || "";
const storageBase = storageRegion
  ? `https://${storageRegion}.storage.bunnycdn.com`
  : "https://storage.bunnycdn.com";
const storageHttp = BUNNY_STORAGE_KEY ? axios.create({
  baseURL: storageBase,
  timeout: 30_000,
  maxContentLength: 10 * 1024 * 1024,
  headers: { "User-Agent": ua, "AccessKey": BUNNY_STORAGE_KEY, "Accept": "*/*" },
}) : null;

// ─── Cache ───────────────────────────────────────────────────────────────────

const cache = createCache({ ttl: 3 * 60 * 1000, max: 300 });

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: pkg.name,
  description: pkg.description,
  version: pkg.version,
});

// ─── Register Tools ──────────────────────────────────────────────────────────

registerAccountTools(server, coreHttp, cache);
registerPullZoneTools(server, coreHttp, cache);
registerDnsTools(server, coreHttp, cache);
registerStorageZoneTools(server, coreHttp, cache);
registerStreamLibraryTools(server, coreHttp, cache);
registerEdgeScriptingTools(server, coreHttp, cache);
registerShieldTools(server, coreHttp, cache);
registerMagicContainerTools(server, coreHttp, cache);
registerOriginErrorTools(server, originHttp, cache);

if (streamHttp) {
  registerStreamVideoTools(server, streamHttp, cache);
  registerStreamCollectionTools(server, streamHttp, cache);
}
if (storageHttp) {
  registerStorageFileTools(server, storageHttp, cache);
}

// ─── Start ───────────────────────────────────────────────────────────────────

try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (err) {
  process.stderr.write(`Fatal: failed to start server: ${err.message}\n`);
  process.exit(1);
}
