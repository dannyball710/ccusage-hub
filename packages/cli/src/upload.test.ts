import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageRow } from "./daily.js";
import { upload } from "./upload.js";

function makeRows(count: number): UsageRow[] {
  const rows: UsageRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      agent: "claude-code",
      date: "2026-07-17",
      model: `model-${i}`,
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 3,
      cacheReadTokens: 4,
      costUsd: 0.5,
    });
  }
  return rows;
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

let calls: RecordedCall[];
let responses: Response[];

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error("no stubbed response left"));
    return Promise.resolve(next);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(call: RecordedCall | undefined): unknown {
  const body = call?.init?.body;
  if (typeof body !== "string") throw new Error("expected a string request body");
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

describe("upload", () => {
  it("posts one batch with auth header and machine payload", async () => {
    responses.push(new Response('{"ok":true,"upserted":3}'));
    const result = await upload("https://w.example/", "ccu_tok", "m1", makeRows(3));
    expect(result).toEqual({ ok: true, upserted: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://w.example/api/usage");
    const headers = calls[0]?.init?.headers;
    expect(headers).toMatchObject({ authorization: "Bearer ccu_tok" });
    expect(bodyOf(calls[0])).toMatchObject({ machine: "m1", rows: makeRows(3) });
  });

  // The worker rejects payloads over 2000 rows, so uploads must be batched
  // and the upserted counts summed across batches.
  it("splits more than 2000 rows into sequential batches and sums upserted", async () => {
    responses.push(new Response('{"ok":true,"upserted":2000}'));
    responses.push(new Response('{"ok":true,"upserted":1}'));
    const result = await upload("https://w.example", "t", "m", makeRows(2001));
    expect(result).toEqual({ ok: true, upserted: 2001 });
    expect(calls).toHaveLength(2);
    const first = bodyOf(calls[0]);
    const second = bodyOf(calls[1]);
    if (
      typeof first !== "object" || first === null || !("rows" in first) ||
      !Array.isArray(first.rows) ||
      typeof second !== "object" || second === null || !("rows" in second) ||
      !Array.isArray(second.rows)
    ) {
      throw new Error("expected rows arrays in both request bodies");
    }
    expect(first.rows).toHaveLength(2000);
    expect(second.rows).toHaveLength(1);
  });

  it("throws with status and body excerpt on HTTP error", async () => {
    responses.push(new Response("boom", { status: 500 }));
    await expect(upload("https://w.example", "t", "m", makeRows(1))).rejects.toThrow(
      "upload failed: 500 boom",
    );
  });

  // A hostile server must not be able to drive the terminal with escape
  // sequences smuggled through the error message.
  it("strips control characters from the error body", async () => {
    const esc = String.fromCharCode(27);
    responses.push(new Response(`${esc}[2J${esc}]0;pwned${String.fromCharCode(7)}boom`, {
      status: 500,
    }));
    await expect(upload("https://w.example", "t", "m", makeRows(1))).rejects.toThrow(
      "upload failed: 500 [2J]0;pwnedboom",
    );
  });

  it("throws on a non-JSON response", async () => {
    responses.push(new Response("<html>gateway error</html>"));
    await expect(upload("https://w.example", "t", "m", makeRows(1))).rejects.toThrow(
      "unexpected response from server",
    );
  });

  it("throws on a response with an invalid shape", async () => {
    responses.push(new Response('{"ok":"yes"}'));
    await expect(upload("https://w.example", "t", "m", makeRows(1))).rejects.toThrow(
      "unexpected response from server",
    );
  });

  it("uploads nothing when there are zero rows", async () => {
    const result = await upload("https://w.example", "t", "m", []);
    expect(result).toEqual({ ok: true, upserted: 0 });
    expect(calls).toHaveLength(0);
  });
});
