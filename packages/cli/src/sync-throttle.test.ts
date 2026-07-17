import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, runCliAsync, useTmpDir } from "./cli-test-utils.js";

const tmp = useTmpDir();

// Writing the config also fixes where the state file lives (beside it).
// localhost:9 refuses connections, so any sync that gets past the throttle fails.
function setup(lastSyncAt: number | null, state?: string): string {
  const configPath = join(tmp(), "config.json");
  writeFileSync(configPath, JSON.stringify({ endpoint: "http://localhost:9", token: "ccu_t" }));
  const statePath = join(tmp(), "config.state.json");
  if (state !== undefined) writeFileSync(statePath, state);
  else if (lastSyncAt !== null) writeFileSync(statePath, JSON.stringify({ lastSyncAt }));
  return configPath;
}

// The throttle is what makes per-turn hooks affordable: the agent runs the
// command on every assistant reply, but we only pay for a ccusage scan once
// per window.
describe("sync --min-interval", () => {
  it("skips inside the window and exits 0 without scanning", () => {
    const res = runCli(["sync", "--min-interval", "3600"], setup(Date.now()));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Skipped");
    expect(res.stderr).toBe("");
  });

  it("syncs once the window has passed", () => {
    const old = Date.now() - 7200 * 1000;
    const res = runCli(["sync", "--min-interval", "3600", "--since-days", "0"], setup(old));
    expect(res.stdout).not.toContain("Skipped");
  });

  it("syncs when no state file exists yet", () => {
    const res = runCli(["sync", "--min-interval", "3600", "--since-days", "0"], setup(null));
    expect(res.stdout).not.toContain("Skipped");
  });

  // Fail open: a corrupt state file must never suppress a sync.
  it("syncs when the state file is corrupt", () => {
    const cfg = setup(null, "{not json");
    const res = runCli(["sync", "--min-interval", "3600", "--since-days", "0"], cfg);
    expect(res.stdout).not.toContain("Skipped");
  });

  // A clock change that puts the stored time in the future must not wedge sync
  // forever.
  it("syncs when the stored timestamp is in the future", () => {
    const future = Date.now() + 3600 * 1000;
    const res = runCli(["sync", "--min-interval", "3600", "--since-days", "0"], setup(future));
    expect(res.stdout).not.toContain("Skipped");
  });

  // The heart of the feature: only a sync that actually succeeded may start the
  // throttle window, so this needs a real upload to a real listener.
  it("records the time after a successful sync so the next run skips", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, upserted: 1 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const configPath = join(tmp(), "config.json");
      writeFileSync(
        configPath,
        JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}`, token: "ccu_t" }),
      );

      const args = ["sync", "--min-interval", "3600", "--since-days", "0"];
      const first = await runCliAsync(args, configPath);
      expect(first.status).toBe(0);
      expect(first.stdout).not.toContain("Skipped");

      const second = await runCliAsync(["sync", "--min-interval", "3600"], configPath);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("Skipped");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // A failed sync must NOT start the window: the next hook has to retry.
  it("does not record the time when the sync fails", () => {
    const cfg = setup(null);
    const first = runCli(["sync", "--min-interval", "3600", "--since-days", "0"], cfg);
    expect(first.status).toBe(1);
    const second = runCli(["sync", "--min-interval", "3600", "--since-days", "0"], cfg);
    expect(second.stdout).not.toContain("Skipped");
  });

  // --quiet is hook mode: silent on stdout, always exit 0.
  it("stays silent and exits 0 when skipping under --quiet", () => {
    const res = runCli(["sync", "--quiet", "--min-interval", "3600"], setup(Date.now()));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  // An unwritable state file must never break the exit-0 hook invariant.
  it("exits 0 under --quiet when the state file cannot be written", () => {
    const cfg = setup(null);
    mkdirSync(join(tmp(), "config.state.json")); // a dir here blocks the write
    const res = runCli(["sync", "--quiet", "--min-interval", "3600", "--since-days", "0"], cfg);
    expect(res.status).toBe(0);
  });

  it("exits 1 on an invalid --min-interval", () => {
    const res = runCli(["sync", "--min-interval", "abc"], setup(null));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("invalid --min-interval");
  });

  it("exits 0 on an invalid --min-interval under --quiet", () => {
    const res = runCli(["sync", "--quiet", "--min-interval", "-5"], setup(null));
    expect(res.status).toBe(0);
  });
});
