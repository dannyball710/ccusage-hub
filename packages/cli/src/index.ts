import { parseArgs } from "./args.js";
import { cmdInit } from "./commands/init.js";
import { cmdStatus } from "./commands/status.js";
import { cmdSync } from "./commands/sync.js";
import { EDITOR_IDS, PLATFORMS } from "./platforms.js";

const EDITOR_LIST = EDITOR_IDS.join("|");
const NO_HOOK_LIST = [...PLATFORMS.filter((p) => !p.installHook).map((p) => p.id), "none"].join(
  "|",
);

const HELP = `ccusage-hub - sync local AI-coding token usage to your Cloudflare Worker

Usage:
  ccusage-hub sync [--quiet] [--since-days N] [--dry-run]
  ccusage-hub init [--endpoint <url>] [--key <ccu_...>] [--machine <name>]
                     [--editor <${EDITOR_LIST}>] [--yes]
                     [--settings-path <path>] [--no-hook]
  ccusage-hub status
  ccusage-hub help

Commands:
  sync     Collect usage via ccusage and upload it.
             --quiet       Hook mode: no stdout, errors to stderr, always exit 0.
             --since-days  Days of history to collect (default from config or 7).
             --dry-run     Print collected rows as JSON; skip upload.
  init     Write config and (for --editor claude) install the Claude Code SessionEnd hook.
             --endpoint  Worker URL.
             --key       API key (ccu_...); stored as the upload token.
             --machine   Device name (omit to use hostname at sync time).
             --editor    Default claude (installs hook); ${NO_HOOK_LIST} skip it.
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
      return cmdSync(parseArgs(rest, ["since-days"]));
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
