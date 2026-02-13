import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "index.js");

describe("bunnycdn-mcp server", () => {
  let client;
  let transport;

  before(async () => {
    if (!process.env.BUNNY_API_KEY) {
      process.env.BUNNY_API_KEY = "test-key-for-server-startup";
    }

    transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: { ...process.env },
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    if (client) await client.close();
  });

  it("lists tools", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 54, `Expected at least 54 tools (core-only), got ${tools.length}`);

    // Verify every tool has required fields
    for (const tool of tools) {
      assert.ok(tool.name, "Tool must have a name");
      assert.ok(tool.description, `Tool ${tool.name} must have a description`);
      assert.ok(tool.inputSchema, `Tool ${tool.name} must have an inputSchema`);
    }
  });

  it("has expected tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    // Core tools that should always be present
    const expectedTools = [
      "bunny_get_account",
      "bunny_get_billing_summary",
      "bunny_get_statistics",
      "bunny_global_search",
      "bunny_purge_url",
      "bunny_list_regions",
      "bunny_list_countries",
      "bunny_list_pull_zones",
      "bunny_get_pull_zone",
      "bunny_create_pull_zone",
      "bunny_list_dns_zones",
      "bunny_get_dns_zone",
      "bunny_list_storage_zones",
      "bunny_get_storage_zone",
      "bunny_list_video_libraries",
      "bunny_list_edge_scripts",
      "bunny_list_shield_zones",
      "bunny_list_mc_apps",
      "bunny_get_origin_errors",
    ];

    for (const expected of expectedTools) {
      assert.ok(names.includes(expected), `Missing expected tool: ${expected}`);
    }
  });

  it("all tool names start with bunny_", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.name.startsWith("bunny_"), `Tool ${tool.name} should start with 'bunny_'`);
    }
  });
});
