// catch binds errors as unknown; narrow structurally instead of asserting.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Node fs/child_process errors carry a string "code" (e.g. ENOENT, ETIMEDOUT).
export function errnoCode(err: unknown): string | undefined {
  if (err instanceof Error && "code" in err && typeof err.code === "string") return err.code;
  return undefined;
}
