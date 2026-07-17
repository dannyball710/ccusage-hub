import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, loadConfig, resolveMachine } from "./config.js";

const BOM = String.fromCharCode(0xfeff);

let tmpDir: string;
const originalEnv = process.env.CCUSAGE_HUB_CONFIG;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-config-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.CCUSAGE_HUB_CONFIG;
  else process.env.CCUSAGE_HUB_CONFIG = originalEnv;
});

function useConfig(content: string): void {
  const path = join(tmpDir, "config.json");
  writeFileSync(path, content);
  process.env.CCUSAGE_HUB_CONFIG = path;
}

describe("configPath", () => {
  it("prefers CCUSAGE_HUB_CONFIG over the home default", () => {
    process.env.CCUSAGE_HUB_CONFIG = join(tmpDir, "override.json");
    expect(configPath()).toBe(join(tmpDir, "override.json"));
  });
});

describe("loadConfig", () => {
  it("loads a valid config", () => {
    useConfig(JSON.stringify({ endpoint: "https://w.example", token: "ccu_x", sinceDays: 3 }));
    expect(loadConfig()).toEqual({ endpoint: "https://w.example", token: "ccu_x", sinceDays: 3 });
  });

  // Windows editors (Notepad, PowerShell Set-Content) prepend a UTF-8 BOM;
  // the config must still load.
  it("loads a BOM-prefixed config", () => {
    useConfig(BOM + JSON.stringify({ endpoint: "https://w.example", token: "ccu_x" }));
    expect(loadConfig()).toMatchObject({ endpoint: "https://w.example", token: "ccu_x" });
  });

  it("returns null when the file is missing", () => {
    process.env.CCUSAGE_HUB_CONFIG = join(tmpDir, "does-not-exist.json");
    expect(loadConfig()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    useConfig("{not json");
    expect(loadConfig()).toBeNull();
  });

  it("returns null for a non-object", () => {
    useConfig('"just a string"');
    expect(loadConfig()).toBeNull();
  });

  it("returns null when endpoint is missing or empty", () => {
    useConfig(JSON.stringify({ token: "ccu_x" }));
    expect(loadConfig()).toBeNull();
    useConfig(JSON.stringify({ endpoint: "", token: "ccu_x" }));
    expect(loadConfig()).toBeNull();
  });

  it("returns null when token is missing or empty", () => {
    useConfig(JSON.stringify({ endpoint: "https://w.example" }));
    expect(loadConfig()).toBeNull();
    useConfig(JSON.stringify({ endpoint: "https://w.example", token: "" }));
    expect(loadConfig()).toBeNull();
  });

  it("returns null when machineName has the wrong type", () => {
    useConfig(JSON.stringify({ endpoint: "https://w.example", token: "ccu_x", machineName: 5 }));
    expect(loadConfig()).toBeNull();
  });

  it("returns null when sinceDays has the wrong type", () => {
    useConfig(JSON.stringify({ endpoint: "https://w.example", token: "ccu_x", sinceDays: "7" }));
    expect(loadConfig()).toBeNull();
  });

  // A hand-edited config must not silently downgrade the token to cleartext
  // http or smuggle in a diverging request target.
  it("rejects a hand-edited endpoint that violates the endpoint rules", () => {
    useConfig(JSON.stringify({ endpoint: "http://evil.example", token: "ccu_x" }));
    expect(loadConfig()).toBeNull();
    useConfig(JSON.stringify({ endpoint: "https://good.example@evil.example", token: "ccu_x" }));
    expect(loadConfig()).toBeNull();
    useConfig(JSON.stringify({ endpoint: "https://evil.example#", token: "ccu_x" }));
    expect(loadConfig()).toBeNull();
  });

  it("accepts http for localhost (local dev)", () => {
    useConfig(JSON.stringify({ endpoint: "http://localhost:8787", token: "ccu_x" }));
    expect(loadConfig()).toMatchObject({ endpoint: "http://localhost:8787" });
  });
});

describe("resolveMachine", () => {
  it("uses the configured machine name", () => {
    expect(resolveMachine({ endpoint: "e", token: "t", machineName: "box" })).toBe("box");
  });

  it("falls back to hostname when machineName is absent or blank", () => {
    expect(resolveMachine({ endpoint: "e", token: "t" })).toBe(os.hostname());
    expect(resolveMachine({ endpoint: "e", token: "t", machineName: "  " })).toBe(os.hostname());
  });
});
