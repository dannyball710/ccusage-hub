# ccusage-cloud

[![CI](https://github.com/dannyball710/ccusage-cloud/actions/workflows/ci.yml/badge.svg)](https://github.com/dannyball710/ccusage-cloud/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ccusage-cloud)](https://www.npmjs.com/package/ccusage-cloud)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Cross-machine AI coding token usage tracker — self-hosted on your own Cloudflare account.

Wraps [ccusage](https://github.com/ccusage/ccusage) to collect daily token usage from all supported coding agents (Claude Code, Codex, Gemini CLI, Copilot CLI, ...), uploads it to a Cloudflare Worker on every Claude Code session end, and visualizes everything in a web dashboard backed by D1.

```
[each machine]                       [Cloudflare]
Claude Code SessionEnd hook
  → npx ccusage-cloud sync --quiet
     → ccusage daily --json --by-agent
     → POST /api/usage ──────→ Worker ──→ D1 (upsert by machine/agent/date/model)
                                   │
browser ←── dashboard (charts) ←───┘
```

## Features

- **Multi-machine, multi-agent** — one dashboard for every computer and every coding agent ccusage supports.
- **Fully self-hosted** — your usage data lives in your own Cloudflare account (Workers + D1 free tier is plenty).
- **Zero-maintenance sync** — a Claude Code `SessionEnd` hook uploads automatically; sync is idempotent so frequent triggers are harmless.
- **Secure by default** — admin password (PBKDF2), per-machine API keys (hashed at rest, shown once, revocable), no secrets in config files beyond the upload key.
- **One-liner machine setup** — the dashboard generates a ready-to-paste `init` command for each machine.

## Quick start

### 1. Deploy the Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dannyball710/ccusage-cloud/tree/main/packages/worker)

The button clones this repository into your GitHub account, provisions a D1 database, applies migrations, and deploys the Worker. Prefer the CLI? See [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) for manual `wrangler` steps.

Upgrades are a single redeploy: schema changes ship as tracked D1 migrations that the deploy script applies automatically — see [Upgrading an existing deployment](docs/deploy-cloudflare.md#upgrading-an-existing-deployment).

### 2. Set the admin password

Open the deployed Worker URL in a browser. The first visit asks you to set an admin password (stored as a PBKDF2 hash in D1 — no Worker secrets needed).

### 3. Set up each machine

In the dashboard: **Keys → create an API key**. The command generator produces a one-liner (pick editor + optional device name):

```sh
npx -y ccusage-cloud@latest init --endpoint https://<your-worker-url> --key ccu_xxx --machine my-desktop --editor claude --yes
```

- `--editor claude` installs the Claude Code `SessionEnd` hook into `~/.claude/settings.json` (merged, existing hooks preserved).
- Other editors (`codex|gemini|copilot|none`) write config only — run `sync` manually or via your own trigger. Uploads always cover **all** agents' data regardless of which editor triggered them, because ccusage scans everything.
- `--machine` is optional; the hostname is used as a fallback, resolved at sync time.
- Interactive mode also works: `npx -y ccusage-cloud@latest init`.

That's it. Every Claude Code session end now syncs the last 7 days of usage from that machine.

## CLI reference

```
ccusage-cloud sync [--quiet] [--since-days N] [--dry-run]
ccusage-cloud init [--endpoint <url>] [--key <ccu_...>] [--machine <name>]
                   [--editor <claude|codex|gemini|copilot|none>] [--yes]
ccusage-cloud status
ccusage-cloud help
```

| Command | Description |
| --- | --- |
| `sync` | Collect usage via ccusage and upload. `--dry-run` prints rows without uploading; `--quiet` is hook mode (never fails the session). |
| `init` | Write `~/.ccusage-cloud.json` and optionally install the Claude Code hook. |
| `status` | Print config and check Worker health. |

Config file (`~/.ccusage-cloud.json`):

```json
{
  "endpoint": "https://ccusage-cloud.example.workers.dev",
  "token": "ccu_...",
  "machineName": "my-desktop",
  "sinceDays": 7
}
```

`machineName` and `sinceDays` are optional. `CCUSAGE_CLOUD_CONFIG` overrides the config path.

## Dashboard

Log in with the admin password. Charts: daily cost stacked by machine/agent/model, token trends (cache tokens toggleable), model share, range presets 7/30/90 days. The Keys page manages API keys (create / revoke / last-used) and generates per-machine setup commands.

## Repository layout

- `packages/cli` — the npm package [`ccusage-cloud`](https://www.npmjs.com/package/ccusage-cloud) (`init` / `sync` / `status`).
- `packages/worker` — Cloudflare Worker: upload API + stats API + static dashboard. API spec: [docs/api-contract.md](docs/api-contract.md).
- `docs/deploy-cloudflare.md` — deployment guide (button + manual).

## Development

```sh
pnpm install
pnpm -r build
pnpm dev:worker        # wrangler dev on :8787 with local D1
```

For local D1, apply migrations first:

```sh
cd packages/worker
npx wrangler d1 migrations apply DB --local
```

Sync is idempotent by design: ccusage reports full-day totals and the Worker overwrites on the `(machine, agent, date, model)` primary key.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [SECURITY.md](SECURITY.md) for the security policy and threat model notes.

## License

[MIT](LICENSE)
