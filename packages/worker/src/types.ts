export type Bindings = {
  DB: D1Database;
};

export type Variables = {
  // SHA-256 hex of the presented session token; set by sessionAuth for logout.
  sessionTokenHash: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

// Metric columns shared by upsert and stats aggregation.
export const METRIC_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "cost_usd",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// True when v is YYYY-MM-DD and a real calendar date (leap years included).
// Arithmetic check, no Date parsing ambiguity.
export function isValidDateStr(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(5, 7));
  const day = Number(v.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const max = monthDays[month - 1];
  return max !== undefined && day >= 1 && day <= max;
}
