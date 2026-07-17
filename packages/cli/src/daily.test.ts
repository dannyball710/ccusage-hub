import { describe, expect, it } from "vitest";
import { isDailyJson, parseDailyJson, type DailyJson } from "./daily.js";

describe("isDailyJson", () => {
  it("accepts a full well-formed payload", () => {
    expect(
      isDailyJson({
        daily: [
          {
            period: "2026-07-17",
            agents: [
              {
                agent: "claude-code",
                modelBreakdowns: [
                  { modelName: "claude-fable-5", inputTokens: 10, outputTokens: 5, cost: 0.1 },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts an empty object and days without agents (no usage that day)", () => {
    expect(isDailyJson({})).toBe(true);
    expect(isDailyJson({ daily: [] })).toBe(true);
    expect(isDailyJson({ daily: [{ period: "2026-07-17" }] })).toBe(true);
  });

  it("tolerates extra unknown fields", () => {
    expect(isDailyJson({ daily: [], totals: { cost: 1 } })).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isDailyJson(null)).toBe(false);
    expect(isDailyJson("json")).toBe(false);
    expect(isDailyJson([])).toBe(true); // arrays have no "daily" key, so shape-wise valid
  });

  it("rejects a non-array daily", () => {
    expect(isDailyJson({ daily: {} })).toBe(false);
  });

  it("rejects wrong-typed fields anywhere in the tree", () => {
    expect(isDailyJson({ daily: [{ period: 20260717 }] })).toBe(false);
    expect(isDailyJson({ daily: [{ period: "d", agents: {} }] })).toBe(false);
    expect(isDailyJson({ daily: [{ period: "d", agents: [{ agent: 1 }] }] })).toBe(false);
    expect(
      isDailyJson({
        daily: [{ period: "d", agents: [{ agent: "a", modelBreakdowns: [{ cost: "1" }] }] }],
      }),
    ).toBe(false);
  });
});

describe("parseDailyJson", () => {
  it("flattens days, agents, and model breakdowns into rows", () => {
    const json: DailyJson = {
      daily: [
        {
          period: "2026-07-16",
          agents: [
            {
              agent: "claude-code",
              modelBreakdowns: [
                { modelName: "m1", inputTokens: 1, outputTokens: 2, cost: 0.1 },
                { modelName: "m2", inputTokens: 3, outputTokens: 4, cost: 0.2 },
              ],
            },
            { agent: "codex-cli", modelBreakdowns: [{ modelName: "m3", cost: 0.3 }] },
          ],
        },
        {
          period: "2026-07-17",
          agents: [{ agent: "claude-code", modelBreakdowns: [{ modelName: "m1" }] }],
        },
      ],
    };
    const rows = parseDailyJson(json);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      agent: "claude-code",
      date: "2026-07-16",
      model: "m1",
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.1,
    });
    expect(rows[2]).toMatchObject({ agent: "codex-cli", model: "m3", costUsd: 0.3 });
    expect(rows[3]).toMatchObject({ date: "2026-07-17", costUsd: 0 });
  });

  // ccusage names the money field "cost"; the upload contract calls it costUsd.
  it("maps cost to costUsd", () => {
    const rows = parseDailyJson({
      daily: [{ period: "d", agents: [{ agent: "a", modelBreakdowns: [{ modelName: "m", cost: 1.5 }] }] }],
    });
    expect(rows[0]?.costUsd).toBe(1.5);
  });

  it("returns no rows for empty or absent daily", () => {
    expect(parseDailyJson({})).toEqual([]);
    expect(parseDailyJson({ daily: [] })).toEqual([]);
  });

  it("skips days without a period, agents without a name, breakdowns without a model", () => {
    const rows = parseDailyJson({
      daily: [
        { agents: [{ agent: "a", modelBreakdowns: [{ modelName: "m" }] }] },
        {
          period: "d",
          agents: [
            { modelBreakdowns: [{ modelName: "m" }] },
            { agent: "a", modelBreakdowns: [{}, { modelName: "kept" }] },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe("kept");
  });

  it("zeroes absent or non-finite numeric fields", () => {
    const rows = parseDailyJson({
      daily: [
        {
          period: "d",
          agents: [
            { agent: "a", modelBreakdowns: [{ modelName: "m", inputTokens: Infinity }] },
          ],
        },
      ],
    });
    expect(rows[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});
