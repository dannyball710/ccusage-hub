import type { UsageRow } from "./collect.js";

export interface UploadResult {
  ok: boolean;
  upserted?: number;
}

function isUploadResult(v: unknown): v is UploadResult {
  if (typeof v !== "object" || v === null) return false;
  if (!("ok" in v) || typeof v.ok !== "boolean") return false;
  if ("upserted" in v && v.upserted !== undefined && typeof v.upserted !== "number") {
    return false;
  }
  return true;
}

// Worker rejects payloads over 2000 rows; split larger uploads into batches.
const MAX_ROWS_PER_BATCH = 2000;

async function postBatch(
  endpoint: string,
  token: string,
  machine: string,
  rows: UsageRow[],
): Promise<UploadResult> {
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/usage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ machine, rows }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`upload failed: ${res.status} ${body.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("unexpected response from server");
  }
  if (!isUploadResult(parsed)) {
    throw new Error("unexpected response from server");
  }
  return { ok: parsed.ok, upserted: parsed.upserted };
}

export async function upload(
  endpoint: string,
  token: string,
  machine: string,
  rows: UsageRow[],
): Promise<UploadResult> {
  // Sequential so a mid-batch failure aborts the whole upload (partial success is not success).
  let upserted = 0;
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_BATCH) {
    const batch = rows.slice(i, i + MAX_ROWS_PER_BATCH);
    const result = await postBatch(endpoint, token, machine, batch);
    upserted += result.upserted ?? 0;
  }
  return { ok: true, upserted };
}
