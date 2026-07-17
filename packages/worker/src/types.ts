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

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
