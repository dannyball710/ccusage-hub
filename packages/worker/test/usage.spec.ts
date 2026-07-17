import { env } from "cloudflare:test";
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

function row(partial: Partial<Row> = {}): Row {
  return {
    agent: "claude",
    date: "2026-07-01",
    model: "model-a",
    inputTokens: 1,
    outputTokens: 2,
    cacheCreationTokens: 3,
    cacheReadTokens: 4,
    costUsd: 0.5,
    ...partial,
  };
}

async function adminAndKey(): Promise<{ session: string; key: string }> {
  const session = await setupAdmin();
  const { key } = await createKey(session);
  return { session, key };
}

async function usageDailyCount(): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_daily").first<{ n: number }>();
  return r?.n ?? -1;
}

describe("POST /api/usage auth", () => {
  it("rejects requests without a key", async () => {
    expect((await postJson("/api/usage", { machine: "m", rows: [] })).status).toBe(401);
  });

  it("rejects a session token: uploads require an API key, not an admin session", async () => {
    const { session } = await adminAndKey();
    expect((await postJson("/api/usage", { machine: "m", rows: [] }, session)).status).toBe(401);
  });

  it("rejects an API key on session-authed routes", async () => {
    const { key } = await adminAndKey();
    expect((await call("/api/stats", {}, key)).status).toBe(401);
    expect((await call("/api/keys", {}, key)).status).toBe(401);
  });
});

describe("POST /api/usage validation", () => {
  async function expect400(body: unknown, error: string): Promise<void> {
    const { key } = await adminAndKey();
    const res = await postJson("/api/usage", body, key);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error });
  }

  it("rejects a non-object body", async () => {
    await expect400("hello", "body must be an object");
  });

  it("rejects a missing machine", async () => {
    await expect400({ rows: [] }, "machine must be a non-empty string");
  });

  it("rejects an empty machine", async () => {
    await expect400({ machine: "", rows: [] }, "machine must be a non-empty string");
  });

  it("rejects non-array rows", async () => {
    await expect400({ machine: "m", rows: "nope" }, "rows must be an array");
  });

  it("rejects more than 2000 rows", async () => {
    await expect400({ machine: "m", rows: Array(2001).fill(null) }, "rows exceeds max of 2000");
  });

  it("rejects a non-object row", async () => {
    await expect400({ machine: "m", rows: [null] }, "row 0: must be an object");
  });

  it("rejects a malformed date", async () => {
    await expect400({ machine: "m", rows: [row({ date: "2026/07/01" })] }, "row 0: date must be YYYY-MM-DD");
  });

  it("rejects non-numeric token fields", async () => {
    await expect400(
      { machine: "m", rows: [{ ...row(), inputTokens: "10" }] },
      "row 0: token fields must be non-negative numbers"
    );
  });

  it("rejects a negative costUsd", async () => {
    await expect400({ machine: "m", rows: [row({ costUsd: -1 })] }, "row 0: costUsd must be a non-negative number");
  });

  it("reports the index of the first invalid row", async () => {
    await expect400(
      { machine: "m", rows: [row(), row({ agent: "" })] },
      "row 1: agent must be a non-empty string"
    );
  });

  it("accepts empty rows as a no-op", async () => {
    const { key } = await adminAndKey();
    const res = await postJson("/api/usage", { machine: "m", rows: [] }, key);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, upserted: 0 });
  });
});

describe("POST /api/usage upsert", () => {
  it("inserts rows and reports the upserted count", async () => {
    const { key } = await adminAndKey();
    const res = await postJson(
      "/api/usage",
      { machine: "m", rows: [row({ model: "model-a" }), row({ model: "model-b" })] },
      key
    );
    expect(await json(res)).toEqual({ ok: true, upserted: 2 });
    expect(await usageDailyCount()).toBe(2);
  });

  // ccusage always reports full-day totals, so re-uploading a day must
  // overwrite the stored values, never accumulate them.
  it("overwrites rows with the same primary key instead of accumulating", async () => {
    const { key } = await adminAndKey();
    await postJson("/api/usage", { machine: "m", rows: [row({ inputTokens: 100 })] }, key);
    await postJson("/api/usage", { machine: "m", rows: [row({ inputTokens: 150 })] }, key);
    await postJson("/api/usage", { machine: "m", rows: [row({ inputTokens: 150 })] }, key);
    const stored = await env.DB.prepare("SELECT input_tokens FROM usage_daily").first<{ input_tokens: number }>();
    expect(stored?.input_tokens).toBe(150);
    expect(await usageDailyCount()).toBe(1);
  });

  it("handles uploads larger than one D1 batch (USAGE_BATCH_SIZE)", async () => {
    const { key } = await adminAndKey();
    const rows = Array.from({ length: 250 }, (_, i) => row({ model: `model-${i}` }));
    const res = await postJson("/api/usage", { machine: "m", rows }, key);
    expect(await json(res)).toEqual({ ok: true, upserted: 250 });
    expect(await usageDailyCount()).toBe(250);
  });
});
