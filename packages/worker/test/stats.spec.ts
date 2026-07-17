import { describe, expect, it } from "vitest";
import { call, createKey, json, postJson, setupAdmin } from "./helpers";

type Row = {
  agent: string;
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

function row(partial: Partial<Row>): Row {
  return {
    agent: "claude",
    date: "2026-07-01",
    model: "m1",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    ...partial,
  };
}

function metrics(inputTokens: number, costUsd: number) {
  return { inputTokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd };
}

// Two machines, two agents, two models across two days:
//   alpha/claude/m1/2026-07-01: 10 in, $1    beta/claude/m1/2026-07-01: 40 in, $4
//   alpha/codex/m2/2026-07-02:  20 in, $2
async function seed(): Promise<string> {
  const session = await setupAdmin();
  const { key } = await createKey(session);
  const alpha = [
    row({ agent: "claude", model: "m1", date: "2026-07-01", inputTokens: 10, costUsd: 1 }),
    row({ agent: "codex", model: "m2", date: "2026-07-02", inputTokens: 20, costUsd: 2 }),
  ];
  const beta = [row({ agent: "claude", model: "m1", date: "2026-07-01", inputTokens: 40, costUsd: 4 })];
  expect((await postJson("/api/usage", { machine: "alpha", rows: alpha }, key)).status).toBe(200);
  expect((await postJson("/api/usage", { machine: "beta", rows: beta }, key)).status).toBe(200);
  return session;
}

const RANGE = "from=2026-07-01&to=2026-07-02";

describe("GET /api/stats", () => {
  it("requires a session", async () => {
    expect((await call("/api/stats")).status).toBe(401);
  });

  it("groups by machine by default", async () => {
    const session = await seed();
    const res = await call(`/api/stats?${RANGE}`, {}, session);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      rows: [
        { date: "2026-07-01", key: "alpha", ...metrics(10, 1) },
        { date: "2026-07-01", key: "beta", ...metrics(40, 4) },
        { date: "2026-07-02", key: "alpha", ...metrics(20, 2) },
      ],
      totals: { ...metrics(70, 7), machines: 2 },
    });
  });

  it("groups by agent, summing across machines", async () => {
    const session = await seed();
    const res = await call(`/api/stats?${RANGE}&groupBy=agent`, {}, session);
    expect(await json(res)).toEqual({
      ok: true,
      rows: [
        { date: "2026-07-01", key: "claude", ...metrics(50, 5) },
        { date: "2026-07-02", key: "codex", ...metrics(20, 2) },
      ],
      totals: { ...metrics(70, 7), machines: 2 },
    });
  });

  it("groups by model", async () => {
    const session = await seed();
    const res = await call(`/api/stats?${RANGE}&groupBy=model`, {}, session);
    expect(await json(res)).toEqual({
      ok: true,
      rows: [
        { date: "2026-07-01", key: "m1", ...metrics(50, 5) },
        { date: "2026-07-02", key: "m2", ...metrics(20, 2) },
      ],
      totals: { ...metrics(70, 7), machines: 2 },
    });
  });

  it("falls back to machine grouping for an unknown groupBy", async () => {
    const session = await seed();
    const bogus = await json(await call(`/api/stats?${RANGE}&groupBy=bogus`, {}, session));
    const machine = await json(await call(`/api/stats?${RANGE}&groupBy=machine`, {}, session));
    expect(bogus).toEqual(machine);
  });

  it("filters rows by the from/to range", async () => {
    const session = await seed();
    const res = await call("/api/stats?from=2026-07-01&to=2026-07-01", {}, session);
    expect(await json(res)).toEqual({
      ok: true,
      rows: [
        { date: "2026-07-01", key: "alpha", ...metrics(10, 1) },
        { date: "2026-07-01", key: "beta", ...metrics(40, 4) },
      ],
      totals: { ...metrics(50, 5), machines: 2 },
    });
  });

  it("defaults to the last 30 days when no range is given", async () => {
    const session = await setupAdmin();
    const { key } = await createKey(session);
    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      row({ date: today, model: "recent", inputTokens: 7, costUsd: 0.5 }),
      row({ date: "2000-01-01", model: "ancient", inputTokens: 9, costUsd: 9 }),
    ];
    expect((await postJson("/api/usage", { machine: "gamma", rows }, key)).status).toBe(200);
    const res = await call("/api/stats", {}, session);
    expect(await json(res)).toEqual({
      ok: true,
      rows: [{ date: today, key: "gamma", ...metrics(7, 0.5) }],
      totals: { ...metrics(7, 0.5), machines: 1 },
    });
  });
});
