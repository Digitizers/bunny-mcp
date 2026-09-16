# Installation and troubleshooting

## The key

Bunny has one account-level API key, and **no scoped keys**: anything holding it can do anything the account can. Treat it as a full credential.

- Get it from the Bunny dashboard → Account Settings → API.
- Keep it out of any config file that lives in a repo or in `~/.claude.json`. A file readable only by you, or the machine's env, is the place for it.
- Rotating it invalidates every client using it; coordinate before you do.

The plugin's `.mcp.json` reads `BUNNY_API_KEY` from the environment and ships no key of its own. Until the variable is set, the connection shows as unavailable in `/mcp`, which is the expected state on a machine that does not operate Bunny.

## The read-only gate

`BUNNY_READONLY` defaults to on. Write-capable tools are then never registered: absent from `tools/list`, not merely annotated. To open it for a machine that needs writes, set `BUNNY_READONLY=0` in the environment (only `0`, `false`, `no`, `off` count as off) and restart the session.

`BUNNY_ALLOW_SOURCE` is the mirror image: off unless explicitly `1`, and only then does edge-script source come back.

## Optional variables

Each of these **registers more tools**; without them the server is core-only, and the tools they carry are simply absent from `tools/list` — the same shape as a closed gate, for a different reason.

| Variable | Effect |
|---|---|
| `BUNNY_STREAM_KEY` | stream library operations that need the library key (11 tools) |
| `BUNNY_STORAGE_KEY`, `BUNNY_STORAGE_REGION` | storage file operations against a specific region (3 tools) |

## Cloud sessions

claude.ai cloud sessions do not run plugin installs; they load the skills of the repos listed as sources of the environment, and MCP connections come from the environment's own configuration. The guidance in `SKILL.md` still applies; the tools only appear where the server is actually connected.

## Common errors

| What you see | What it means |
|---|---|
| A write tool is missing from `tools/list` | the read-only gate is closed. Expected default; do not work around it |
| `No declared shape for path …` | the allow-list has no projection for that endpoint, so the server refused to return raw data. A gap to fill in `lib/project.js`, not a Bunny failure |
| `401` / `403` | the key is missing, wrong, or was rotated |
| Empty edge-script source | `BUNNY_ALLOW_SOURCE` is off |
| Statistics look flat right after a change | the statistics window has not caught up; say what window was read |

## Running it outside the plugin

The server also runs straight from the repo (`node index.js`) or through `npx -y github:Digitizers/bunny-mcp`, both with `BUNNY_API_KEY` in the environment. The plugin runs the committed bundle at `dist/bundle.mjs`, so a plugin install needs no `npm install`.
