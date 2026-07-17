import { writeFileSync } from "node:fs";
import os from "node:os";
import { createInterface } from "node:readline";
import type { Flags } from "../args.js";
import { configPath, type Config } from "../config.js";
import { errorMessage } from "../errors.js";
import { EDITOR_IDS, getPlatform } from "../platforms.js";

export async function cmdInit(flags: Flags): Promise<number> {
  const yes = flags.bool.has("yes");
  const noHook = flags.bool.has("no-hook");
  let editor = flags.value.get("editor")?.toLowerCase();
  if (editor !== undefined && !EDITOR_IDS.includes(editor)) {
    process.stderr.write(
      `ccusage-hub: invalid --editor "${editor}" (expected ${EDITOR_IDS.join("|")})\n`,
    );
    return 1;
  }

  // readline/promises question() is unreliable past the first line on piped
  // (non-TTY) stdin; pull lines via the async iterator, created only when a
  // prompt is actually needed (fully skipped under --yes).
  // rl lives in an object property: a plain local assigned only inside ask()
  // would be narrowed to null at the finally by control-flow analysis.
  const state: { rl: ReturnType<typeof createInterface> | null } = { rl: null };
  let lines: AsyncIterableIterator<string> | null = null;
  // Returns null at stdin EOF; callers must abort then, because re-prompting
  // the exhausted iterator would spin forever.
  const ask = async (prompt: string): Promise<string | null> => {
    if (!lines) {
      state.rl = createInterface({ input: process.stdin });
      lines = state.rl[Symbol.asyncIterator]();
    }
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    return done ? null : String(value);
  };
  const promptEof = (): number => {
    process.stderr.write("ccusage-hub: stdin closed before input was complete\n");
    return 1;
  };

  try {
    const hostname = os.hostname();

    let endpoint = flags.value.get("endpoint")?.trim() ?? "";
    if (!endpoint && !yes) {
      while (true) {
        const ans = await ask("Worker endpoint URL (https://...): ");
        if (ans === null) return promptEof();
        endpoint = ans.trim();
        if (/^https?:\/\/.+/i.test(endpoint)) break;
        process.stdout.write("  Please enter a valid http(s) URL.\n");
      }
    }
    if (!/^https?:\/\/.+/i.test(endpoint)) {
      process.stderr.write("ccusage-hub: missing or invalid --endpoint\n");
      return 1;
    }
    endpoint = endpoint.replace(/\/$/, "");

    let token = flags.value.get("key")?.trim() ?? "";
    if (!token && !yes) {
      while (true) {
        const ans = await ask("API key (ccu_...): ");
        if (ans === null) return promptEof();
        token = ans.trim();
        if (token) break;
        process.stdout.write("  Key cannot be empty.\n");
      }
    }
    if (!token) {
      process.stderr.write("ccusage-hub: missing --key\n");
      return 1;
    }

    // Machine name is optional; omitting it falls back to hostname at sync time.
    let machineName = flags.value.get("machine")?.trim() ?? "";
    if (!flags.value.has("machine") && !yes) {
      const ans = await ask(`Machine name (leave empty to use hostname: ${hostname}): `);
      if (ans === null) return promptEof();
      machineName = ans.trim();
    }

    // Editor defaults to claude; prompt for it interactively when not provided.
    if (editor === undefined && !yes) {
      while (true) {
        const raw = await ask(`Editor (${EDITOR_IDS.join("|")}) [claude]: `);
        if (raw === null) return promptEof();
        const ans = raw.trim().toLowerCase();
        if (!ans) break; // keep default (claude)
        if (EDITOR_IDS.includes(ans)) {
          editor = ans;
          break;
        }
        process.stdout.write(`  Expected ${EDITOR_IDS.join("|")}.\n`);
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

    // Install the hook only when the platform has one; --no-hook also suppresses it.
    const platform = getPlatform(effectiveEditor);

    if (platform?.installHook && !noHook) {
      const settingsPath = flags.value.get("settings-path") || undefined;
      let msg: string;
      try {
        msg = platform.installHook(settingsPath);
      } catch (err) {
        process.stderr.write(`ccusage-hub: ${errorMessage(err)}\n`);
        return 1;
      }
      process.stdout.write(`${msg}\n`);
    } else {
      process.stdout.write(
        "No hook installed; this machine syncs when you run 'ccusage-hub sync' manually " +
          "(or via another machine's Claude Code hook if home is shared).\n",
      );
    }
    return 0;
  } finally {
    state.rl?.close();
  }
}
