// The npx arguments, without the "npx" head. Shell string and argv array are
// both derived from this one list so the two spellings can never drift apart.
const BASE_ARGS = ["-y", "ccusage-hub@latest", "sync", "--quiet"];
const BASE_COMMAND = `npx ${BASE_ARGS.join(" ")}`;

// Agents whose only end-of-work event fires per turn would spawn a full ccusage
// scan on every assistant reply. Throttling makes that affordable: the hook
// still runs each turn, but does real work at most once per window.
export const PER_TURN_MIN_INTERVAL_SECONDS = 300;

// Every hook command must keep the "ccusage-hub" substring -- the installers'
// dedupe predicates match on it to find our entry on re-run.
export function hookCommand(minIntervalSeconds?: number): string {
  if (minIntervalSeconds === undefined) return BASE_COMMAND;
  return `${BASE_COMMAND} --min-interval ${minIntervalSeconds}`;
}

// The same command as an argv array, for plugin files that spawn us directly
// rather than handing a string to a shell. No quoting rules apply here: each
// element is passed to the OS as one argument verbatim.
export function hookArgv(minIntervalSeconds?: number): string[] {
  if (minIntervalSeconds === undefined) return [...BASE_ARGS];
  return [...BASE_ARGS, "--min-interval", String(minIntervalSeconds)];
}

// The command for platforms with a genuine once-per-session event: no throttle,
// because it already fires exactly as often as we want.
export const HOOK_COMMAND = hookCommand();

export interface Platform {
  id: string; // value accepted by --editor
  label: string; // human-readable name
  // Installs the auto-sync hook and returns a status message ("hook installed" /
  // "hook already installed"). Absent = platform has no hook mechanism yet;
  // init writes config only. settingsPath overrides the default location.
  installHook?: (settingsPath?: string) => string;
}
