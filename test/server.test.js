import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "index.js");

/** Boots the server over stdio with the given extra environment. */
async function boot(extraEnv) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...process.env, BUNNY_API_KEY: process.env.BUNNY_API_KEY || "test-key-for-server-startup", ...extraEnv },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, names: tools.map((t) => t.name), tools };
}

// Tools that read. Present in both modes.
const READ_TOOLS = [
  "bunny_get_account",
  "bunny_get_billing_summary",
  "bunny_get_statistics",
  "bunny_list_pull_zones",
  "bunny_get_pull_zone",
  "bunny_list_dns_zones",
  "bunny_list_storage_zones",
  "bunny_list_video_libraries",
  "bunny_list_edge_scripts",
  "bunny_list_shield_zones",
  "bunny_list_mc_apps",
  "bunny_get_origin_errors",
];

// Tools that change or destroy something. Absent unless the gate is opened.
const WRITE_TOOLS = [
  "bunny_create_pull_zone",
  "bunny_update_pull_zone",
  "bunny_delete_pull_zone",
  "bunny_delete_dns_zone",
  "bunny_create_storage_zone",
  "bunny_purge_url",
  "bunny_purge_pull_zone_cache",
];

describe("bunny-mcp server — read-only by default", () => {
  let client, names;

  before(async () => { ({ client, names } = await boot({})); });
  after(async () => { if (client) await client.close(); });

  it("registers the read tools", () => {
    for (const t of READ_TOOLS) {
      assert.ok(names.includes(t), `missing read tool: ${t}`);
    }
  });

  it("withholds every write tool — absent from tools/list, not merely annotated", () => {
    // The point of the gate: an agent cannot call a tool it cannot see. If this
    // test ever fails, a destructive tool became reachable by default.
    for (const t of WRITE_TOOLS) {
      assert.ok(!names.includes(t), `write tool reachable in read-only mode: ${t}`);
    }
  });

  it("every registered tool declares readOnlyHint", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const hint = tool.annotations?.readOnlyHint;
      assert.equal(hint, true, `${tool.name} is registered in read-only mode without readOnlyHint`);
    }
  });

  it("every tool is named, described and schema'd", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.name.startsWith("bunny_"), `${tool.name} should start with 'bunny_'`);
      assert.ok(tool.description, `${tool.name} must have a description`);
      assert.ok(tool.inputSchema, `${tool.name} must have an inputSchema`);
    }
  });
});

describe("bunny-mcp server — BUNNY_READONLY=0", () => {
  let client, names;

  before(async () => { ({ client, names } = await boot({ BUNNY_READONLY: "0" })); });
  after(async () => { if (client) await client.close(); });

  it("registers the write tools once the gate is opened explicitly", () => {
    for (const t of WRITE_TOOLS) {
      assert.ok(names.includes(t), `missing write tool with the gate open: ${t}`);
    }
  });

  it("still registers the read tools", () => {
    for (const t of READ_TOOLS) {
      assert.ok(names.includes(t), `missing read tool: ${t}`);
    }
  });
});
