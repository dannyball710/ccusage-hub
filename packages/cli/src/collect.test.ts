import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect } from "./collect.js";

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

const spawnSyncMock = vi.hoisted(() =>
  vi.fn<(cmd: string, args: string[], opts?: object) => SpawnResult>(),
);

vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

const VALID_JSON = {
  daily: [
    {
      period: "2026-07-16",
      agents: [{ agent: "claude-code", modelBreakdowns: [{ modelName: "m", inputTokens: 1 }] }],
    },
  ],
};

function ok(json: unknown): SpawnResult {
  return { status: 0, stdout: JSON.stringify(json), stderr: "" };
}

function failed(): SpawnResult {
  return { status: 1, stdout: "", stderr: "boom" };
}

function timedOut(): SpawnResult {
  return {
    status: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }),
  };
}

function ccusageArgs(callIndex: number): string[] {
  const args = spawnSyncMock.mock.calls[callIndex]?.[1];
  if (!args) throw new Error(`no spawnSync call #${callIndex}`);
  return args;
}

beforeEach(() => {
  spawnSyncMock.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 17, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("collect", () => {
  it("runs ccusage offline with a computed --since date and parses rows", () => {
    spawnSyncMock.mockReturnValueOnce(ok(VALID_JSON));
    const rows = collect(7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent: "claude-code", model: "m", inputTokens: 1 });
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    // 2026-07-17 minus 7 days.
    expect(ccusageArgs(0).slice(1)).toEqual([
      "daily", "--json", "--by-agent", "--since", "20260710", "--offline",
    ]);
  });

  it("uses today for --since 0 days", () => {
    spawnSyncMock.mockReturnValueOnce(ok(VALID_JSON));
    collect(0);
    expect(ccusageArgs(0)).toContain("20260717");
  });

  // A cold pricing cache can fail the offline run; one online retry is allowed.
  it("retries once without --offline when the offline run fails", () => {
    spawnSyncMock.mockReturnValueOnce(failed()).mockReturnValueOnce(ok(VALID_JSON));
    const rows = collect(7);
    expect(rows).toHaveLength(1);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(ccusageArgs(0)).toContain("--offline");
    expect(ccusageArgs(1)).not.toContain("--offline");
  });

  // No retry after a timeout: the hook's worst case must stay bounded.
  it("does not retry after a timeout and reports it", () => {
    spawnSyncMock.mockReturnValueOnce(timedOut());
    expect(() => collect(7)).toThrow("ccusage timed out");
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it("throws when both runs fail", () => {
    spawnSyncMock.mockReturnValueOnce(failed()).mockReturnValueOnce(failed());
    expect(() => collect(7)).toThrow("ccusage failed to produce parseable output");
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-JSON ccusage output", () => {
    const garbage: SpawnResult = { status: 0, stdout: "garbage", stderr: "" };
    spawnSyncMock.mockReturnValueOnce(garbage).mockReturnValueOnce(garbage);
    expect(() => collect(7)).toThrow("ccusage failed to produce parseable output");
  });

  // JSON that parses but fails shape validation must be rejected loudly, not
  // silently coerced into wrong rows.
  it("rejects malformed daily JSON", () => {
    const malformed = ok({ daily: [{ period: 20260716 }] });
    spawnSyncMock.mockReturnValueOnce(malformed).mockReturnValueOnce(malformed);
    expect(() => collect(7)).toThrow("ccusage failed to produce parseable output");
  });
});
