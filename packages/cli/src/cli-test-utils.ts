import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";

// End-to-end tests run against the bundled CLI (built by the test script).
export const DIST = fileURLToPath(new URL("../dist/index.cjs", import.meta.url));

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], configPath: string, input = ""): CliResult {
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

// spawnSync blocks this process's event loop, so a test that must serve the
// CLI's HTTP request from in-process needs the async spawn instead -- otherwise
// the child waits on a server that cannot answer until the child exits.
export function runCliAsync(args: string[], configPath: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DIST, ...args], {
      windowsHide: true,
      env: { ...process.env, CCUSAGE_HUB_CONFIG: configPath },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

export function useTmpDir(): () => string {
  let tmpDir = "";
  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-cli-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  return () => tmpDir;
}
