import { spawnSync } from "node:child_process";

const BIN = "openclaw";

// Reading hooks.internal.enabled through openclaw's own CLI rather than parsing
// openclaw.json ourselves: that file is JSON5, so hand-parsing it would mean
// shipping a JSON5 parser and risking a mangled rewrite of the user's config.
export type InternalHooksState = "disabled" | "not-disabled" | "cli-missing";

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  missing: boolean; // openclaw is not on PATH (spawn ENOENT)
}

function run(args: string[]): CliRun {
  const res = spawnSync(BIN, args, { encoding: "utf8", windowsHide: true });
  // spawnSync reports a failure to launch via .error rather than by throwing.
  if (res.error !== undefined) return { status: null, stdout: "", stderr: "", missing: true };
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    missing: false,
  };
}

// Deliberately biased toward "yes, disabled". `openclaw hooks enable` spreads
// {enabled: true} with no check of the prior value, so mistaking an explicit
// opt-out for an unset key would silently clobber what may well be a security
// decision -- these hooks run in-process as fully trusted code.
//
// The exact output shape of `config get --json` is unverified (openclaw could
// not be installed here), so this does not trust JSON.parse alone: any output
// that mentions false and never true is read as an opt-out.
export function isExplicitlyDisabled(stdout: string): boolean {
  const out = stdout.trim();
  if (out === "") return false; // no value printed == nothing set == not an opt-out
  try {
    const parsed: unknown = JSON.parse(out);
    if (parsed === false) return true;
    if (parsed === true || parsed === null) return false;
  } catch {
    // --json may be unsupported, or the value may print as a human-readable
    // line; fall through to the textual check rather than assume it is unset.
  }
  return /\bfalse\b/i.test(out) && !/\btrue\b/i.test(out);
}

export function readInternalHooksState(): InternalHooksState {
  const res = run(["config", "get", "hooks.internal.enabled", "--json"]);
  if (res.missing) return "cli-missing";
  // A non-zero exit is what an *unset* key most plausibly looks like, and unset
  // is not an opt-out. If the config is genuinely broken instead, the enable
  // step surfaces its own error, so nothing is silently assumed here.
  if (res.status !== 0) return "not-disabled";
  return isExplicitlyDisabled(res.stdout) ? "disabled" : "not-disabled";
}

export interface EnableOutcome {
  ok: boolean;
  missing: boolean;
  stderr: string;
}

// Idempotent: safe to run on every init. Every failure mode exits 1 and differs
// only by stderr text (`Hook "..." not found`, `is managed by plugin "..."`,
// `is not eligible (missing requirements)`), so we branch on ok/missing and hand
// the stderr text to the user rather than trying to classify it ourselves.
export function enableHook(name: string): EnableOutcome {
  const res = run(["hooks", "enable", name]);
  if (res.missing) return { ok: false, missing: true, stderr: "" };
  return { ok: res.status === 0, missing: false, stderr: res.stderr.trim() };
}
