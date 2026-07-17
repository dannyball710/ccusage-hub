# ccusage-hub

Cross-machine AI coding token usage tracker — self-hosted on your own Cloudflare account.

This is the CLI package. It wraps [ccusage](https://github.com/ccusage/ccusage) to collect daily token usage from all supported coding agents (Claude Code, Codex, Gemini CLI, Copilot CLI, ...) and uploads it to your own Cloudflare Worker, typically via a Claude Code `SessionEnd` hook.

## Setup

Deploy the Worker first, create an API key in its dashboard, and paste the generated command:

```sh
npx -y ccusage-hub@latest init --endpoint https://<your-worker-url> --key ccu_xxx --editor claude --yes
```

## Commands

```
ccusage-hub sync [--quiet] [--since-days N] [--dry-run]
ccusage-hub init [--endpoint <url>] [--key <ccu_...>] [--machine <name>]
                 [--editor <claude|codex|gemini|copilot|none>] [--yes]
ccusage-hub status
```

Full documentation, Worker deployment guide (Deploy to Cloudflare button included), and dashboard: **https://github.com/dannyball710/ccusage-hub**

## License

[MIT](https://github.com/dannyball710/ccusage-hub/blob/main/LICENSE)
