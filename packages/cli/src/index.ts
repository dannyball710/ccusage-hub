import { parseArgs } from "./args.js";
import { cmdInit } from "./commands/init.js";
import { cmdStatus } from "./commands/status.js";
import { cmdSync } from "./commands/sync.js";
import { PLATFORMS } from "./platforms/index.js";
import { wrapIds } from "./wrap.js";

// Both lists derive from the registry so adding a platform updates the help.
// Indented to sit under the --editor description text it belongs to.
const IDS_INDENT = " ".repeat(27);
const HOOK_LIST = wrapIds(
  PLATFORMS.filter((p) => p.installHook).map((p) => p.id),
  IDS_INDENT,
);
const NO_HOOK_LIST = wrapIds(
  [...PLATFORMS.filter((p) => !p.installHook).map((p) => p.id), "none"],
  IDS_INDENT,
);

const HELP = `ccusage-hub - sync local AI-coding token usage to your Cloudflare Worker

Usage:
  ccusage-hub sync [--quiet] [--since-days N] [--dry-run] [--min-interval S]
  ccusage-hub init [--endpoint <url>] [--key <ccu_...>] [--machine <name>]
                     [--editor <id>] [--yes]
                     [--settings-path <path>] [--no-hook]
  ccusage-hub status
  ccusage-hub help

Commands:
  sync     Collect usage via ccusage and upload it.
             --quiet       Hook mode: no stdout, errors to stderr, always exit 0.
             --since-days  Days of history to collect (default from config or 7).
             --dry-run     Print collected rows as JSON; skip upload.
             --min-interval  Skip (exit 0) if the last sync was under S seconds
                             ago. Lets per-turn hooks fire often but scan rarely.
  init     Write config and install the agent's session-end sync hook.
             --endpoint  Worker URL.
             --key       API key (ccu_...); stored as the upload token.
             --machine   Device name (omit to use hostname at sync time).
             --editor    Agent to hook (default claude). Installs a hook for:
                           ${HOOK_LIST}
                         Config only, no session-end hook available:
                           ${NO_HOOK_LIST}
             --yes       Non-interactive; requires --endpoint and --key.
             --no-hook   Skip hook install (equivalent to --editor none).
  status   Show config (token masked) and check endpoint reachability.

Env:
  CCUSAGE_HUB_CONFIG   Override config file path (default ~/.ccusage-hub.json).
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "sync":
      return cmdSync(parseArgs(rest, ["since-days", "min-interval"]));
    case "init":
      return cmdInit(
        parseArgs(rest, ["settings-path", "endpoint", "key", "machine", "editor"]),
      );
    case "status":
      return cmdStatus();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

main().then((code) => process.exit(code));
