import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdStatus } from "./status.js";

let tmpDir: string;
let out: string;
let fetchUrls: string[];
let fetchResult: () => Promise<Response>;
const originalEnv = process.env.CCUSAGE_HUB_CONFIG;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-status-"));
  out = "";
  fetchUrls = [];
  fetchResult = () => Promise.resolve(new Response("ok"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((): boolean => true);
  vi.stubGlobal("fetch", (input: string | URL): Promise<Response> => {
    fetchUrls.push(String(input));
    return fetchResult();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.CCUSAGE_HUB_CONFIG;
  else process.env.CCUSAGE_HUB_CONFIG = originalEnv;
});

function useConfig(cfg: object): void {
  const path = join(tmpDir, "config.json");
  writeFileSync(path, JSON.stringify(cfg));
  process.env.CCUSAGE_HUB_CONFIG = path;
}

describe("cmdStatus", () => {
  it("exits 1 without a config", async () => {
    process.env.CCUSAGE_HUB_CONFIG = join(tmpDir, "missing.json");
    expect(await cmdStatus()).toBe(1);
  });

  it("prints config with a masked token and reports a reachable endpoint", async () => {
    useConfig({ endpoint: "http://w.example/", token: "ccu_secret1234", machineName: "box" });
    expect(await cmdStatus()).toBe(0);
    expect(out).toContain("Endpoint:  http://w.example");
    // Only the last 4 characters of the token may be shown.
    expect(out).toContain(`Token:     ${"*".repeat(10)}1234`);
    expect(out).not.toContain("ccu_secret1234");
    expect(out).toContain("Machine:   box");
    expect(out).toContain("Health:    reachable (HTTP 200)");
    // Trailing slash on the endpoint must not double up in the health URL.
    expect(fetchUrls).toEqual(["http://w.example/api/health"]);
  });

  it("masks short tokens entirely", async () => {
    useConfig({ endpoint: "http://w.example", token: "abc" });
    await cmdStatus();
    expect(out).toContain("Token:     ***");
    expect(out).not.toContain("abc");
  });

  it("exits 1 when the endpoint answers with an HTTP error", async () => {
    useConfig({ endpoint: "http://w.example", token: "ccu_t" });
    fetchResult = () => Promise.resolve(new Response("nope", { status: 500 }));
    expect(await cmdStatus()).toBe(1);
    expect(out).toContain("Health:    unreachable (HTTP 500)");
  });

  it("exits 1 when the endpoint is unreachable", async () => {
    useConfig({ endpoint: "http://w.example", token: "ccu_t" });
    fetchResult = () => Promise.reject(new Error("connect ECONNREFUSED"));
    expect(await cmdStatus()).toBe(1);
    expect(out).toContain("Health:    unreachable (connect ECONNREFUSED)");
  });
});
