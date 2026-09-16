---
name: bunny-mcp
description: |
  Operate Bunny.net delivery through the bunny-mcp server — CDN pull zones and cache purges, DNS zones and records, storage zones and files, video streaming libraries, edge scripting, Shield/WAF and Magic Containers.
  Use when the task mentions Bunny, bunny.net, b-cdn.net, a pull zone, an edge rule, a CDN purge, Bunny DNS or Bunny Stream, when a site's assets or delivery layer need checking, or when hosting work ends with "clear the CDN".
  Read-only by default — write tools are not registered until a machine opts in, and credentials are stripped from every response.
  Not for Cloudflare zones (cloudflare tools), not for origin/server administration (cloudways-mcp, hostinger-mcp), not for WordPress content (wordpress-api-pro).
---

# Bunny MCP

Operational guide for the `bunny-mcp` server: what it exposes, what it refuses, and how to work with it safely.

## Two things to know before the first call

**1. Read-only is the default.** `BUNNY_READONLY` is on unless a machine sets it to `0`. In that mode every write-capable tool is **never registered** — absent from `tools/list`, not merely flagged. If a purge or an edit tool "does not exist", the gate is closed; that is the design, not a bug. Say so and ask before anyone opens it.

**2. Credentials never reach you.** Bunny returns secrets inline with ordinary metadata: zone security keys, TLS private keys, storage passwords, stream API keys, the account key itself. This fork projects every response through a per-path allow-list, so those fields are gone before a tool sees them. Two consequences:
- Never promise a client a key, token or certificate from this server. It cannot produce one.
- A path with no declared shape returns an error naming the path, not raw data. That is the allow-list failing closed; report it as a gap to fill in the server, not a Bunny outage.

Edge-script **source** is withheld the same way unless `BUNNY_ALLOW_SOURCE=1`.

## What is available

70 tools across 12 areas — but how many register depends on two things, the read-only gate and the optional keys:

| | without `BUNNY_STREAM_KEY` / `BUNNY_STORAGE_KEY` | with both |
|---|---|---|
| `BUNNY_READONLY=1` (default) | 33 | 41 |
| `BUNNY_READONLY=0` | 56 | 70 |

The table below counts every tool the server can define. A machine holding only `BUNNY_API_KEY` sees the left column.

| Area | Tools | Typical use |
|---|---|---|
| Account | 7 | account details, billing summary, regions, countries, global search |
| Pull zones (CDN) | 8 | list/inspect zones, origin errors, statistics, **purge** |
| DNS | 7 | zones, records, DNS statistics |
| Storage zones | 4 | zones and their statistics |
| Storage files | 3 | list, upload, delete objects |
| Stream (libraries, videos, collections) | 15 | video libraries, videos, collections |
| Edge scripting | 8 | scripts, variables, deploys |
| Shield / WAF | 9 | shield zones, WAF rules, rate limits, bot detection |
| Magic Containers | 8 | apps, overview, statistics, registries, regions |
| Origin errors | 1 | recent origin failures for a zone |

Ask the server, not this table, for exact names: `tools/list` is the contract, and the table drifts.

## How to work

1. **Locate before acting.** `bunny_global_search` or the list tool for the area, then the get/inspect tool for the one resource. Bunny accounts hold many similar zones; naming alone is not identification.
2. **Read the numbers before claiming an effect.** Statistics tools cover a time range; a purge does not show up as a hit-rate change within seconds. Say what was measured and over what window.
3. **A purge is a write.** It is withheld under the default gate. When the gate is open, name the exact zone and scope, and get a yes before firing — a full purge on a busy zone means an origin traffic spike, and the client feels it.
4. **Storage and stream deletes are irreversible.** Confirm the target file or video by id, not by name.
5. **Per-account isolation.** One key, one account. Do not mix ids across accounts, and never copy a resource id from one account's output into another's call.

## Where this sits

- Delivery layer only. Origin servers are `cloudways-mcp` or `hostinger-mcp`; site content is `wordpress-api-pro`; DNS at Cloudflare is the Cloudflare tools, not this one.
- A site behind Bunny usually has its origin somewhere else: a slow page can be the origin, and the CDN only shows the symptom.
- Fleet-wide, governed actions (approvals, snapshots, rollback) belong to `aura-mcp`.

## Setup and troubleshooting

`references/installation.md` covers the API key, the read-only gate, the cloud-session path, and what the common errors mean.
