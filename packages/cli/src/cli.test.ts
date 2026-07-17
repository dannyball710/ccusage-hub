import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// End-to-end exit-code tests against the bundled CLI (built by the test script).
const DIST = fileURLToPath(new URL("../dist/index.cjs", import.meta.url));

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], configPath: string, input = ""): CliResult {
  // The timeout doubles as a runaway guard for prompt-loop regressions.
  const res = spawnSync(process.execPath, [DIST, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    input,
    env: { ...process.env, CCUSAGE_HUB_CONFIG: configPath },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-cli-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("cli exit codes", () => {
  it("help exits 0 and lists the registered editors", () => {
    const res = runCli(["--help"], join(tmpDir, "none.json"));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("claude|codex|gemini|copilot|none");
  });

  it("unknown command exits 1 with help on stderr", () => {
    const res = runCli(["frobnicate"], join(tmpDir, "none.json"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: frobnicate");
  });

  // Hook mode must never break Claude Code session end: even with a broken
  // config, sync --quiet reports to stderr but exits 0.
  it("sync --quiet with a missing config exits 0", () => {
    const res = runCli(["sync", "--quiet"], join(tmpDir, "does-not-exist.json"));
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("no config found");
    expect(res.stdout).toBe("");
  });

  it("sync (non-quiet) with a missing config exits 1", () => {
    const res = runCli(["sync"], join(tmpDir, "does-not-exist.json"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("no config found");
  });

  it("sync with an invalid --since-days exits 1", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ endpoint: "http://localhost:9", token: "ccu_t" }));
    const res = runCli(["sync", "--since-days", "abc"], configPath);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("invalid --since-days");
  });

  it("init --editor bogus exits 1 and lists valid editors", () => {
    const res = runCli(
      ["init", "--endpoint", "http://localhost:9", "--key", "ccu_t", "--editor", "bogus", "--yes"],
      join(tmpDir, "config.json"),
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('invalid --editor "bogus"');
    expect(res.stderr).toContain("claude|codex|gemini|copilot|none");
  });

  // A closed stdin (EOF) must abort prompting with exit 1 — not busy-spin
  // re-printing the prompt forever.
  it("init with immediately-closed stdin exits 1 without runaway output", () => {
    const res = runCli(["init"], join(tmpDir, "config.json"), "");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("stdin closed");
    expect(res.stdout.length).toBeLessThan(1000);
  });

  it("init hitting EOF between prompts exits 1", () => {
    const res = runCli(["init"], join(tmpDir, "config.json"), "http://localhost:9\n");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("stdin closed");
  });

  it("init answers all prompts via piped stdin and exits 0", () => {
    const configPath = join(tmpDir, "config.json");
    const res = runCli(["init"], configPath, "http://localhost:9\nccu_t\nbox\nnone\n");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`Config written to ${configPath}`);
    expect(res.stdout).toContain("No hook installed");
  });

  it("init --yes without --endpoint exits 1", () => {
    const res = runCli(["init", "--key", "ccu_t", "--yes"], join(tmpDir, "config.json"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("missing or invalid --endpoint");
  });

  // Remote http endpoints would ship the bearer token in cleartext on every
  // unattended sync; only local-dev hosts may use http.
  it("init rejects a remote http endpoint, accepts http on localhost", () => {
    const rejected = runCli(
      ["init", "--endpoint", "http://evil.example", "--key", "ccu_t", "--yes"],
      join(tmpDir, "config.json"),
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("https");

    const local = runCli(
      ["init", "--endpoint", "http://localhost:9", "--key", "ccu_t", "--editor", "none", "--yes"],
      join(tmpDir, "config.json"),
    );
    expect(local.status).toBe(0);
  });

  it("init --editor codex --yes writes config, installs no hook, exits 0", () => {
    const configPath = join(tmpDir, "config.json");
    const res = runCli(
      ["init", "--endpoint", "http://localhost:9", "--key", "ccu_t", "--editor", "codex", "--yes"],
      configPath,
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`Config written to ${configPath}`);
    expect(res.stdout).toContain("No hook installed");
  });

  it("init --editor claude --yes installs the hook at --settings-path, exits 0", () => {
    const configPath = join(tmpDir, "config.json");
    const settingsPath = join(tmpDir, "settings.json");
    const args = [
      "init",
      "--endpoint", "http://localhost:9",
      "--key", "ccu_t",
      "--editor", "claude",
      "--yes",
      "--settings-path", settingsPath,
    ];
    const res = runCli(args, configPath);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`hook installed (${settingsPath})`);
    const rerun = runCli(args, configPath);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain(`hook already installed (${settingsPath})`);
  });
});
