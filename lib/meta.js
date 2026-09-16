// Server identity, as literals.
//
// These used to be read from package.json at startup, relative to index.js.
// The Claude Code plugin runs the esbuild bundle at dist/bundle.mjs, where that
// relative path resolves to dist/package.json and the server dies with ENOENT
// before it ever speaks MCP. Literals bundle; test/meta.test.js keeps them
// honest against package.json.

export const NAME = "bunny-mcp";
export const VERSION = "1.1.0";
export const DESCRIPTION =
  "MCP server for Bunny.net — secret-redacting and read-only by default. Hardened fork of anvme/bunnycdn-mcp.";
