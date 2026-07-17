import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useTmpDir } from "./hook-test-utils.js";
import { installOwnedFile, spawnSnippet, xdgConfigHome } from "./plugin-file.js";

const tmp = useTmpDir();

describe("spawnSnippet", () => {
  // Regression: Node has thrown EINVAL on spawning any .bat/.cmd without
  // shell:true since the CVE-2024-27980 hardening. Calling npx.cmd directly
  // would therefore fail on every Windows install of the Node-hosted agents
  // (pi, openclaw) -- and the snippet's own catch would swallow it into a
  // silent no-op, so no user would ever see an error.
  it("routes Windows through cmd.exe instead of spawning npx.cmd directly", () => {
    const src = spawnSnippet(["sync"], "");
    expect(src).toContain('spawn(isWin ? "cmd.exe" : "npx", isWin ? ["/c", "npx.cmd", ...args] : args');
  });

  // shell:true would also dodge EINVAL, but it joins argv into a command string
  // and hands it to a shell. Passing an argv array keeps that surface closed.
  it("passes an argv array rather than opening a shell", () => {
    const src = spawnSnippet(["sync", "--quiet"], "");
    expect(src).toContain('const args = ["sync","--quiet"]');
    expect(src).not.toContain("shell: true");
  });

  // Every host awaits its handler with no timeout (pi even before process.exit),
  // so an awaited sync would stall the agent for a whole usage scan.
  it("detaches and never awaits, so the host can exit immediately", () => {
    const src = spawnSnippet(["sync"], "");
    expect(src).toContain("detached: true");
    expect(src).toContain("stdio: \"ignore\"");
    expect(src).toContain("windowsHide: true");
    expect(src).toContain(".unref()");
    expect(src).not.toContain("await");
  });

  it("indents every line so it can be nested inside a handler body", () => {
    const lines = spawnSnippet(["sync"], "    ").split("\n");
    expect(lines.every((line) => line.startsWith("    "))).toBe(true);
  });
});

describe("installOwnedFile", () => {
  it("reports changed on first write and not-changed when content matches", () => {
    const path = join(tmp(), "plugin.ts");
    expect(installOwnedFile(path, "hello")).toEqual({
      message: `hook installed (${path})`,
      changed: true,
    });
    expect(installOwnedFile(path, "hello")).toEqual({
      message: `hook already installed (${path})`,
      changed: false,
    });
  });

  // We own these files, so a stale version from an older ccusage-hub is ours to
  // replace -- otherwise an upgrade would leave the old plugin running forever.
  it("rewrites a file whose content has drifted", () => {
    const path = join(tmp(), "plugin.ts");
    writeFileSync(path, "an older generated plugin");
    expect(installOwnedFile(path, "new").changed).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("new");
  });
});

describe("xdgConfigHome", () => {
  const original = process.env.XDG_CONFIG_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = original;
  });

  it("honours XDG_CONFIG_HOME when the user has relocated their config", () => {
    process.env.XDG_CONFIG_HOME = join(tmp(), "xdg");
    expect(xdgConfigHome()).toBe(join(tmp(), "xdg"));
  });

  // These agents pin xdg-basedir@5.1.0, which has no win32 branching at all: it
  // resolves ~/.config even on Windows. Installing to %APPDATA% would put the
  // plugin somewhere the agent never scans.
  it("falls back to ~/.config on every platform, never %APPDATA%", () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(xdgConfigHome()).toBe(join(os.homedir(), ".config"));
  });
});
