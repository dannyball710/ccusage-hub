import { hookArgv, hookCommand } from "./types.js";

// Neither codex nor gemini can be handed a plain `npx ... sync`: both WAIT for
// the hook, despite what their docs suggest.
//   - codex runs Stop hooks synchronously and blocks the user's turn ("async":
//     true is parsed but skipped upstream); an omitted timeout defaults to 600s.
//   - gemini's docs claim SessionEnd is "Best Effort ... will not wait", but the
//     source refutes it: the SessionEnd fire is registered as a cleanup fn and
//     awaited in a loop before process.exit(), so an un-detached sync stalls the
//     user's quit. gemini also runs `taskkill /f /t` on timeout, killing the
//     whole tree -- so on Windows detaching is what keeps the sync alive at all.
// Every form below was measured against a reproduction of each host's real shape
// (its shell, shell:false, piped stdio, waiting for pipe close).

// For codex (`$SHELL -lc`) and gemini (hardcoded `bash -c`).
//
// The redirect is load-bearing, not tidiness: without it the backgrounded child
// inherits the host's stdout pipe, EOF never arrives, and the host blocks for the
// full sync even though the shell already exited (measured: 8.3s vs 295ms).
// `setsid` is deliberately absent -- neither host kills by process group, and it
// is missing from Git Bash and non-default on macOS.
export function posixDetached(minIntervalSeconds?: number): string {
  return `nohup ${hookCommand(minIntervalSeconds)} >/dev/null 2>&1 &`;
}

// The PowerShell statement both Windows hosts rely on. Start-Process hands the
// child its own hidden console instead of the host's pipes, so the host sees EOF
// at once and a tree-kill cannot reach it.
//
// -FilePath must be `npx.cmd`, not `npx`: npx is a shell script, and Start-Process
// rejects it with "%1 is not a valid Win32 application" -- while still reporting
// success, which would make the hook a silent no-op.
//
// Args are single-quoted; they come from hookArgv and never contain a quote.
function startProcess(minIntervalSeconds?: number): string {
  const args = hookArgv(minIntervalSeconds)
    .map((arg) => `'${arg}'`)
    .join(",");
  return `Start-Process -FilePath 'npx.cmd' -ArgumentList ${args} -WindowStyle Hidden`;
}

// gemini on Windows, which always runs hooks through PowerShell (every Windows
// branch of its getShellConfiguration returns pwsh/powershell, never cmd). The
// statement is passed straight through as one argv element, so it needs no
// wrapper and no quoting of its own.
//
// No trailing `exit 0` needed: gemini appends `if ($LASTEXITCODE -ne 0) { exit
// $LASTEXITCODE }`, and an unset $LASTEXITCODE still exits 0 (measured).
export function powershellDetached(minIntervalSeconds?: number): string {
  return startProcess(minIntervalSeconds);
}

// codex on Windows, which hands us cmd (`%COMSPEC% /C`), so PowerShell has to be
// invoked explicitly.
//
// Two traps here, both measured:
//   1. `start /b` looks right and is WRONG. cmd returns in ~20ms, but the
//      grandchild keeps codex's stdout pipe open, so codex still blocks for the
//      whole sync (3.8s+ in test) -- fast shell exit, stalled turn.
//   2. The PowerShell statement must carry NO double quotes. `cmd /C` strips the
//      outer pair of a nested-quoted argument, and the wrapped form arrives as a
//      bare `Start-Process` with every parameter gone -- it exits 1 and silently
//      does nothing. Unquoted, PowerShell joins the remaining tokens itself and
//      the single-quoted args survive intact.
export function cmdDetached(minIntervalSeconds?: number): string {
  return `powershell -NoProfile -Command ${startProcess(minIntervalSeconds)}`;
}
