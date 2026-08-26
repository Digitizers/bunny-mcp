import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "index.js");

/**
 * Every variable that decides WHICH tools register. A test names the ones it
 * wants; the rest must be absent, not inherited.
 */
const MODE_VARS = ["BUNNY_READONLY", "BUNNY_ALLOW_SOURCE", "BUNNY_STREAM_KEY", "BUNNY_STORAGE_KEY"];

/**
 * Boots the server over stdio with the given extra environment.
 *
 * The ambient environment is cleared of the mode variables first. Inheriting
 * them meant a developer with `BUNNY_READONLY=0` exported failed the read-only
 * suite on correct code, and an exported `BUNNY_STREAM_KEY` silently inflated
 * the core-tool count the README assertions are built from — a test claiming to
 * exercise a configuration it had not actually set.
 */
async function boot(extraEnv) {
  const base = { ...process.env };
  for (const v of MODE_VARS) delete base[v];

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...base, BUNNY_API_KEY: process.env.BUNNY_API_KEY || "test-key-for-server-startup", ...extraEnv },
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
  // A read action that used to be trapped inside a mixed-operation tool: the
  // gate keys on a TOOL's annotation, so a GET was withheld for its
  // neighbours' sake until it got its own registration.
  "bunny_list_edge_script_variables",
  "bunny_read_bot_detection",
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

// The README's catalog and its counts describe THIS server, and a document that
// describes code drifts from it silently. Two review rounds were spent on that
// drift — a missing tool row, then a count that still described the mode the
// server had stopped defaulting to. So the numbers are not maintained by hand
// here: they are derived from the running server and asserted against the file.
describe("README describes the server it ships with", () => {
  // Three boots, once for the whole suite: the full catalog, the core-only
  // catalog, and what a default install actually exposes.
  const ALL = { BUNNY_STREAM_KEY: "y", BUNNY_STORAGE_KEY: "z", BUNNY_READONLY: "0" };
  let readme, every, coreOnly, byDefault;

  before(async () => {
    const { readFile } = await import("node:fs/promises");
    readme = await readFile(join(__dirname, "..", "README.md"), "utf8");
    every = await boot(ALL);
    coreOnly = await boot({ BUNNY_READONLY: "0" });
    byDefault = await boot({ BUNNY_STREAM_KEY: "y", BUNNY_STORAGE_KEY: "z" });
  });

  after(async () => {
    for (const b of [every, coreOnly, byDefault]) if (b) await b.client.close();
  });

  /** Every `| \`bunny_x\` |` row in the catalog table, in order. */
  function catalogued(md) {
    return [...md.matchAll(/^\| `(bunny_[a-z_]+)` \|/gm)].map((m) => m[1]);
  }

  it("catalogues every registered tool, and nothing that is not one", () => {
    const names = every.names;
    const rows = catalogued(readme);
    const missing = names.filter((n) => !rows.includes(n));
    const phantom = rows.filter((n) => !names.includes(n));
    assert.deepEqual(missing, [], "registered but absent from the README catalog");
    assert.deepEqual(phantom, [], "in the README catalog but not registered");
  });

  it("states the totals the server actually registers", () => {
    const all = every.names.length;
    const core = coreOnly.names.length;
    const dflt = byDefault.names.length;

    // Each claim is quoted from the README so a failure names the sentence to
    // fix, rather than reporting that some number somewhere is wrong.
    assert.ok(readme.includes(`The catalog above holds ${all} tools`), `README should say the catalog holds ${all} tools`);
    assert.ok(readme.includes(`**Core tools** (${core} tools)`), `README should say ${core} core tools`);
    assert.ok(
      readme.includes(`**By default \`BUNNY_READONLY\` is on and ${dflt} of the ${all} register**`),
      `README should say ${dflt} of ${all} register by default`,
    );
    assert.ok(
      readme.includes(`the ${all - dflt} write-capable ones are withheld`),
      `README should say ${all - dflt} write-capable tools are withheld`,
    );
  });

  it("marks each catalogued tool read or write, matching its annotation", () => {
    const { tools } = every;
    const declared = new Map(tools.map((t) => [t.name, t.annotations?.readOnlyHint === true ? "read" : "write"]));
    for (const [, name, mode] of readme.matchAll(/^\| `(bunny_[a-z_]+)` \|[^|]*\|[^|]*\| (read|write) \|$/gm)) {
      assert.equal(mode, declared.get(name), `${name}: README says ${mode}`);
    }
    const marked = [...readme.matchAll(/^\| `(bunny_[a-z_]+)` \|[^|]*\|[^|]*\| (?:read|write) \|$/gm)].length;
    assert.equal(marked, declared.size, "every catalogued tool needs a Mode cell");
  });
});
