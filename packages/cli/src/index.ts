import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { collect } from "./collect.js";
import { configPath, loadConfig, resolveMachine, type Config } from "./config.js";
import { upload } from "./upload.js";

const HOOK_COMMAND = "npx -y ccusage-cloud@latest sync --quiet";

// --editor claude installs the Claude Code hook; any other value writes config only.
const VALID_EDITORS = ["claude", "codex", "gemini", "copilot", "none"];

const HELP = `ccusage-cloud - sync local AI-coding token usage to your Cloudflare Worker

Usage:
  ccusage-cloud sync [--quiet] [--since-days N] [--dry-run]
  ccusage-cloud init [--endpoint <url>] [--key <ccu_...>] [--machine <name>]
                     [--editor <claude|codex|gemini|copilot|none>] [--yes]
                     [--settings-path <path>] [--no-hook]
  ccusage-cloud status
  ccusage-cloud help

Commands:
  sync     Collect usage via ccusage and upload it.
             --quiet       Hook mode: no stdout, errors to stderr, always exit 0.
             --since-days  Days of history to collect (default from config or 7).
             --dry-run     Print collected rows as JSON; skip upload.
  init     Write config and (for --editor claude) install the Claude Code SessionEnd hook.
             --endpoint  Worker URL.
             --key       API key (ccu_...); stored as the upload token.
             --machine   Device name (omit to use hostname at sync time).
             --editor    Default claude (installs hook); codex|gemini|copilot|none skip it.
             --yes       Non-interactive; requires --endpoint and --key.
             --no-hook   Skip hook install (equivalent to --editor none).
  status   Show config (token masked) and check endpoint reachability.

Env:
  CCUSAGE_CLOUD_CONFIG   Override config file path (default ~/.ccusage-cloud.json).
`;

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Map<string, string>;
}

function parseArgs(argv: string[], valueFlags: string[]): Flags {
  const positional: string[] = [];
  const bool = new Set<string>();
  const value = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (valueFlags.includes(name)) {
        // Don't consume a following flag as this flag's value; treat it as missing.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value.set(name, next);
          i++;
        } else {
          value.set(name, "");
        }
      } else {
        bool.add(name);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, bool, value };
}

function maskToken(token: string): string {
  if (token.length <= 4) return "*".repeat(token.length);
  return `${"*".repeat(token.length - 4)}${token.slice(-4)}`;
}

async function cmdSync(flags: Flags): Promise<number> {
  const quiet = flags.bool.has("quiet");
  const dryRun = flags.bool.has("dry-run");
  const fail = (msg: string): number => {
    if (quiet) {
      process.stderr.write(`ccusage-cloud: ${msg}\n`);
      return 0; // hook mode: never break session end
    }
    process.stderr.write(`ccusage-cloud: ${msg}\n`);
    return 1;
  };

  const cfg = loadConfig();
  if (!cfg) return fail("no config found. Run: ccusage-cloud init");

  let sinceDays: number;
  if (flags.value.has("since-days")) {
    const raw = (flags.value.get("since-days") ?? "").trim();
    if (raw === "") return fail("invalid --since-days"); // flag given without a value
    sinceDays = Number(raw);
  } else {
    sinceDays = cfg.sinceDays ?? 7;
  }
  if (!Number.isInteger(sinceDays) || sinceDays < 0) return fail("invalid --since-days");

  let rows;
  try {
    rows = collect(sinceDays);
  } catch (err) {
    return fail((err as Error).message);
  }

  if (rows.length === 0) {
    if (!quiet) process.stdout.write("No usage rows found; nothing to upload.\n");
    return 0;
  }

  if (dryRun) {
    if (!quiet) process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }

  try {
    const machine = resolveMachine(cfg);
    const result = await upload(cfg.endpoint, cfg.token, machine, rows);
    if (!quiet) {
      const dates = rows.map((r) => r.date).sort();
      process.stdout.write(
        `Uploaded ${rows.length} rows for "${machine}" (${dates[0]}..${dates[dates.length - 1]}), upserted ${result.upserted ?? "?"}.\n`,
      );
    }
    return 0;
  } catch (err) {
    return fail((err as Error).message);
  }
}

const FIX_HINT = "Fix it manually or pass --settings-path; refusing to overwrite.";

interface HookCommand {
  type?: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}
interface ClaudeSettings {
  hooks?: { SessionEnd?: HookEntry[]; [key: string]: unknown };
  [key: string]: unknown;
}

function installHook(settingsPath: string): string {
  let settings: ClaudeSettings = {};

  // Only a missing file is safe to start fresh; any existing-but-unreadable or
  // malformed file must abort so we never clobber the user's real settings.
  let raw: string | null = null;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`cannot read ${settingsPath}: ${(err as Error).message}. ${FIX_HINT}`);
    }
  }

  if (raw !== null) {
    let parsed: unknown;
    try {
      // Strip UTF-8 BOM: Windows editors (Notepad, PowerShell Set-Content) add one.
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error(`${settingsPath} is not valid JSON. ${FIX_HINT}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${settingsPath} is not a JSON object. ${FIX_HINT}`);
    }
    settings = parsed as ClaudeSettings;
  }

  let hooks = settings.hooks;
  if (hooks === undefined) {
    hooks = {};
    settings.hooks = hooks;
  } else if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    throw new Error(`${settingsPath} "hooks" is not an object. ${FIX_HINT}`);
  }

  let existing = hooks.SessionEnd;
  if (existing === undefined) {
    existing = [];
    hooks.SessionEnd = existing;
  } else if (!Array.isArray(existing)) {
    throw new Error(`${settingsPath} "hooks.SessionEnd" is not an array. ${FIX_HINT}`);
  }

  const already = existing.some((entry) =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h) => typeof h?.command === "string" && h.command.includes("ccusage-cloud")),
  );
  if (already) return "hook already installed";

  existing.push({
    matcher: "*",
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return "hook installed";
}

async function cmdInit(flags: Flags): Promise<number> {
  const yes = flags.bool.has("yes");
  const noHook = flags.bool.has("no-hook");
  let editor = flags.value.get("editor")?.toLowerCase();
  if (editor !== undefined && !VALID_EDITORS.includes(editor)) {
    process.stderr.write(
      `ccusage-cloud: invalid --editor "${editor}" (expected ${VALID_EDITORS.join("|")})\n`,
    );
    return 1;
  }

  // readline/promises question() is unreliable past the first line on piped
  // (non-TTY) stdin; pull lines via the async iterator, created only when a
  // prompt is actually needed (fully skipped under --yes).
  let rl: ReturnType<typeof createInterface> | null = null;
  let lines: AsyncIterableIterator<string> | null = null;
  const ask = async (prompt: string): Promise<string> => {
    if (!rl) {
      rl = createInterface({ input: process.stdin });
      lines = rl[Symbol.asyncIterator]();
    }
    process.stdout.write(prompt);
    const { value, done } = await lines!.next();
    return done ? "" : String(value);
  };

  try {
    const hostname = os.hostname();

    let endpoint = flags.value.get("endpoint")?.trim() ?? "";
    if (!endpoint && !yes) {
      while (true) {
        endpoint = (await ask("Worker endpoint URL (https://...): ")).trim();
        if (/^https?:\/\/.+/i.test(endpoint)) break;
        process.stdout.write("  Please enter a valid http(s) URL.\n");
      }
    }
    if (!/^https?:\/\/.+/i.test(endpoint)) {
      process.stderr.write("ccusage-cloud: missing or invalid --endpoint\n");
      return 1;
    }
    endpoint = endpoint.replace(/\/$/, "");

    let token = flags.value.get("key")?.trim() ?? "";
    if (!token && !yes) {
      while (true) {
        token = (await ask("API key (ccu_...): ")).trim();
        if (token) break;
        process.stdout.write("  Key cannot be empty.\n");
      }
    }
    if (!token) {
      process.stderr.write("ccusage-cloud: missing --key\n");
      return 1;
    }

    // Machine name is optional; omitting it falls back to hostname at sync time.
    let machineName = flags.value.get("machine")?.trim() ?? "";
    if (!flags.value.has("machine") && !yes) {
      machineName = (
        await ask(`Machine name (leave empty to use hostname: ${hostname}): `)
      ).trim();
    }

    // Editor defaults to claude; prompt for it interactively when not provided.
    if (editor === undefined && !yes) {
      while (true) {
        const ans = (await ask("Editor (claude|codex|gemini|copilot|none) [claude]: "))
          .trim()
          .toLowerCase();
        if (!ans) break; // keep default (claude)
        if (VALID_EDITORS.includes(ans)) {
          editor = ans;
          break;
        }
        process.stdout.write(`  Expected ${VALID_EDITORS.join("|")}.\n`);
      }
    }
    const effectiveEditor = editor ?? "claude";

    const cfg: Config = { endpoint, token };
    if (machineName) cfg.machineName = machineName;

    const path = configPath();
    // 0600: on POSIX this keeps the API key unreadable by other local users
    // (no-op on Windows).
    writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write(`Config written to ${path}\n`);

    // Install the hook only for the claude editor; --no-hook also suppresses it.
    const installClaudeHook = effectiveEditor === "claude" && !noHook;

    if (installClaudeHook) {
      const settingsPath =
        flags.value.get("settings-path") || join(os.homedir(), ".claude", "settings.json");
      let msg: string;
      try {
        msg = installHook(settingsPath);
      } catch (err) {
        process.stderr.write(`ccusage-cloud: ${(err as Error).message}\n`);
        return 1;
      }
      process.stdout.write(`${msg} (${settingsPath})\n`);
    } else {
      process.stdout.write(
        "No hook installed; this machine syncs when you run 'ccusage-cloud sync' manually " +
          "(or via another machine's Claude Code hook if home is shared).\n",
      );
    }
    return 0;
  } finally {
    // rl is assigned inside the ask() closure, invisible to control-flow analysis.
    (rl as ReturnType<typeof createInterface> | null)?.close();
  }
}

async function cmdStatus(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    process.stderr.write("ccusage-cloud: no config found. Run: ccusage-cloud init\n");
    return 1;
  }
  process.stdout.write(`Config:    ${configPath()}\n`);
  process.stdout.write(`Endpoint:  ${cfg.endpoint}\n`);
  process.stdout.write(`Token:     ${maskToken(cfg.token)}\n`);
  process.stdout.write(`Machine:   ${resolveMachine(cfg)}\n`);

  const url = `${cfg.endpoint.replace(/\/$/, "")}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    process.stdout.write(`Health:    ${res.ok ? "reachable" : "unreachable"} (HTTP ${res.status})\n`);
    return res.ok ? 0 : 1;
  } catch (err) {
    process.stdout.write(`Health:    unreachable (${(err as Error).message})\n`);
    return 1;
  }
}

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
