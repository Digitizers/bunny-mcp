# bunny-mcp

MCP server for [Bunny.net](https://bunny.net) — pull zones, DNS, storage, video streaming, edge scripting, Shield/WAF and Magic Containers, from an AI assistant.

A hardened fork of [anvme/bunnycdn-mcp](https://github.com/anvme/bunnycdn-mcp) (MIT). Two things differ, and both exist because pointing the upstream at a real Bunny account publishes credentials.

## What the fork changes

### 1. Responses are projected through an allow-list

Bunny returns credentials inline with ordinary metadata:

| Endpoint | Credential in the response |
|---|---|
| `GET /pullzone` | `ZoneSecurityKey` — the token-authentication signing secret, for every zone |
| `GET /pullzone` → `Hostnames[]` | `Certificate` and `CertificateKey` — the TLS private key |
| `GET /storagezone` | `Password`, `ReadOnlyPassword` — full read-write and read storage keys |
| `GET /videolibrary` | `ApiKey`, `ReadOnlyApiKey`, `WebhookSignatureKey` |
| `GET /user` | `ApiKey` — the account key the server itself authenticates with |

Handing those to a model puts them in its context, its logs and its transcript. So no tool ever sees them: every response passes through [`lib/project.js`](lib/project.js) at the HTTP layer, keyed by request path, and only the fields named there survive.

It is an **allow-list, not a deny-list**. Stripping known secret names fails the moment Bunny adds a field — the new one ships in the clear and nothing tells you. Naming what may pass fails the other way: a new field is invisible until someone decides it is safe.

It **fails closed**. A path with no declared shape returns no data and an error naming the path, rather than the raw payload.

It applies **inside a value, not only to it.** A URL keeps scheme, host, port and path; userinfo, query and fragment go. The first version of that scrubber removed `user:password@` and kept the rest — a deny-list wearing a scrubber's coat, which closed the one place a credential was known to sit and let `?token=…` walk through. And a free-form bag is a bag whether it arrives as an object or a string: `CustomHTML` is dropped for the same reason `metaTags` is.

It **does not vet structure by naming its parent.** A bare field name may only carry a scalar, or an array of them; an object survives only where a nested shape is declared for it. Every leak found while reviewing this fork lived one level below a name someone had already vetted — `Hostnames` looked safe and held the TLS private key; `EdgeRules` was given a shape and `ExtraActions` inside it still carried the very parameter that shape existed to drop.

### 2. Write tools are withheld unless you ask for them

`BUNNY_READONLY` defaults to on. In that mode the write-capable tools are **never registered** — absent from `tools/list`, not merely annotated as risky. An agent cannot call a tool it cannot see, and the MCP `destructiveHint` is advice to a client, not a control.

The gate fails closed: a tool is registered in read-only mode only if it declares `readOnlyHint: true`. A new tool whose author forgot its annotations counts as a writer and is withheld.

```bash
BUNNY_READONLY=0   # register the write tools too — 0/false/no/off, nothing else
```

### Errors are projected too

A non-2xx response never reaches the response interceptor — axios routes it to the rejection handler — so error bodies get their own boundary. Bunny quotes submitted values back in validation messages, and what these tools submit includes edge-script secrets, so the rule keys on the **request**: a request that carried no body cannot have its own payload echoed at it and keeps its message; a request that carried one has the message withheld, with the status and `ErrorKey` still saying what went wrong.

### Credential scoping

Use a permission-scoped key from **Account → API → Manage Keys**, never the account master key. The redaction above keeps secrets out of the transcript; it does nothing about what the key itself is allowed to do.

---

## Features

| Tool | Description | Data Source |
|------|-------------|-------------|
| `bunny_get_account` | Get account details and balance | bunny.net API |
| `bunny_get_billing_summary` | Get billing summary with charges | bunny.net API |
| `bunny_get_statistics` | Get CDN statistics (bandwidth, requests, cache hit rate) | bunny.net API |
| `bunny_global_search` | Search across all resources | bunny.net API |
| `bunny_purge_url` | Purge a URL from CDN cache | bunny.net API |
| `bunny_list_regions` | List CDN edge regions | bunny.net API |
| `bunny_list_countries` | List countries for geo-blocking | bunny.net API |
| `bunny_list_pull_zones` | List pull zones with search and pagination | bunny.net API |
| `bunny_get_pull_zone` | Get pull zone details | bunny.net API |
| `bunny_create_pull_zone` | Create a pull zone | bunny.net API |
| `bunny_update_pull_zone` | Update pull zone settings | bunny.net API |
| `bunny_delete_pull_zone` | Delete a pull zone | bunny.net API |
| `bunny_purge_pull_zone_cache` | Purge entire pull zone cache | bunny.net API |
| `bunny_manage_pull_zone_hostnames` | Add or remove custom hostnames | bunny.net API |
| `bunny_manage_edge_rules` | Add, update, delete, or toggle edge rules | bunny.net API |
| `bunny_list_dns_zones` | List DNS zones | bunny.net API |
| `bunny_get_dns_zone` | Get DNS zone with all records | bunny.net API |
| `bunny_create_dns_zone` | Create a DNS zone | bunny.net API |
| `bunny_update_dns_zone` | Update DNS zone settings | bunny.net API |
| `bunny_delete_dns_zone` | Delete a DNS zone | bunny.net API |
| `bunny_manage_dns_record` | Add, update, or delete DNS records | bunny.net API |
| `bunny_get_dns_statistics` | Get DNS query statistics | bunny.net API |
| `bunny_list_storage_zones` | List storage zones | bunny.net API |
| `bunny_get_storage_zone` | Get storage zone details | bunny.net API |
| `bunny_create_storage_zone` | Create a storage zone | bunny.net API |
| `bunny_get_storage_zone_statistics` | Get storage zone usage statistics | bunny.net API |
| `bunny_list_storage_files` | List files and directories | Storage API |
| `bunny_download_storage_file` | Download file content | Storage API |
| `bunny_delete_storage_file` | Delete a file or directory | Storage API |
| `bunny_list_video_libraries` | List video libraries | bunny.net API |
| `bunny_get_video_library` | Get library details | bunny.net API |
| `bunny_create_video_library` | Create a video library | bunny.net API |
| `bunny_update_video_library` | Update library settings | bunny.net API |
| `bunny_list_videos` | List videos with search and pagination | Stream API |
| `bunny_get_video` | Get video details | Stream API |
| `bunny_create_video` | Create video object, optionally fetch from URL | Stream API |
| `bunny_update_video` | Update video metadata | Stream API |
| `bunny_delete_video` | Delete a video | Stream API |
| `bunny_get_video_statistics` | Get view statistics | Stream API |
| `bunny_get_video_heatmap` | Get attention heatmap data | Stream API |
| `bunny_reencode_video` | Re-encode a video | Stream API |
| `bunny_list_collections` | List video collections | Stream API |
| `bunny_get_collection` | Get collection details | Stream API |
| `bunny_manage_collection` | Create, update, or delete collections | Stream API |
| `bunny_list_edge_scripts` | List edge scripts | bunny.net API |
| `bunny_get_edge_script` | Get script details | bunny.net API |
| `bunny_get_edge_script_code` | Get script source code | bunny.net API |
| `bunny_set_edge_script_code` | Upload script code (saved as draft) | bunny.net API |
| `bunny_manage_edge_script` | Create, update, or delete scripts | bunny.net API |
| `bunny_publish_edge_script` | Publish a release to edge servers | bunny.net API |
| `bunny_manage_edge_script_variables` | Manage environment variables and secrets | bunny.net API |
| `bunny_list_shield_zones` | List shield security zones | bunny.net API |
| `bunny_get_shield_zone` | Get zone by shield zone ID or pull zone ID | bunny.net API |
| `bunny_get_waf_rules` | Get WAF rules and profiles | bunny.net API |
| `bunny_manage_waf_custom_rule` | Create, update, or delete custom WAF rules | bunny.net API |
| `bunny_list_rate_limit_rules` | List rate limiting rules | bunny.net API |
| `bunny_manage_rate_limit_rule` | Create, update, or delete rate limit rules | bunny.net API |
| `bunny_get_shield_metrics` | Get security metrics overview | bunny.net API |
| `bunny_get_bot_detection` | Get or update bot detection settings | bunny.net API |
| `bunny_list_mc_apps` | List Magic Container applications | bunny.net API |
| `bunny_get_mc_app` | Get application details | bunny.net API |
| `bunny_get_mc_app_overview` | Get app overview with real-time metrics | bunny.net API |
| `bunny_manage_mc_app` | Create, update, or delete applications | bunny.net API |
| `bunny_mc_app_lifecycle` | Deploy, undeploy, or restart applications | bunny.net API |
| `bunny_list_mc_registries` | List container registries | bunny.net API |
| `bunny_list_mc_regions` | List deployment regions | bunny.net API |
| `bunny_get_mc_app_statistics` | Get application statistics | bunny.net API |
| `bunny_get_origin_errors` | Get origin error logs for a pull zone | bunny.net API |

**Data sources:** Tools marked **Storage API** require `BUNNY_STORAGE_KEY`. Tools marked **Stream API** require `BUNNY_STREAM_KEY`. All other tools use `BUNNY_API_KEY`.

## Prerequisites

- Node.js >= 18
- A [bunny.net](https://bunny.net) account with an API key
- Optional: Stream library API key (for video tools)
- Optional: Storage zone password (for file tools)

## Setup

No installation needed — just configure your MCP client:

<details>
<summary>VS Code / Copilot</summary>

Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Cursor</summary>

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Windsurf</summary>

Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Claude Desktop</summary>

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Claude Code</summary>

```bash
claude mcp add --transport stdio bunny -- npx -y github:Digitizers/bunny-mcp
```

Or add to `.mcp.json` (shared with team):
```json
{
  "mcpServers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Zed</summary>

Add to `settings.json`:
```json
{
  "context_servers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>JetBrains IDEs</summary>

Open **Settings → Tools → AI Assistant → MCP**, click **+**, and paste:
```json
{
  "mcpServers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Gemini CLI</summary>

```bash
gemini mcp add bunny -- npx -y github:Digitizers/bunny-mcp
```

Or add to `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "bunny": {
      "command": "npx",
      "args": ["-y", "github:Digitizers/bunny-mcp"],
      "env": {
        "BUNNY_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary>Other MCP clients</summary>

Any MCP client that supports **stdio** transport can use this server. The command is:
```
npx -y github:Digitizers/bunny-mcp
```
See the [full list of MCP clients](https://modelcontextprotocol.io/clients).
</details>

### Optional environment variables

| Variable | Description |
|----------|-------------|
| `BUNNY_STREAM_KEY` | Video library API key — enables Stream video and collection tools |
| `BUNNY_STORAGE_KEY` | Storage zone password — enables Storage file tools |
| `BUNNY_STORAGE_REGION` | Storage region code (default: empty for Falkenstein) |
| `BUNNY_STORAGE_ZONE` | Default storage zone name |

Add these to the `env` block in your MCP client configuration above.

### Local development

```bash
git clone https://github.com/Digitizers/bunny-mcp.git
cd bunny-mcp
npm install
npm test
node index.js
```

## How It Works

This MCP server connects to the [bunny.net API](https://docs.bunny.net/reference/bunnynet-api-overview) using your API key. It registers up to 68 tools depending on which API keys are provided:

- **Core tools** (55 tools) — always available with `BUNNY_API_KEY`
- **Stream tools** (11 tools) — registered when `BUNNY_STREAM_KEY` is set
- **Storage file tools** (3 tools) — registered when `BUNNY_STORAGE_KEY` is set

All read operations are cached in-memory with a short TTL for performance. Every tool includes MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can make informed decisions about tool approval.

## License

MIT
