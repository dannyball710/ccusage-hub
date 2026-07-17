# Contributing

Thanks for your interest in improving ccusage-hub!

## Development setup

Requirements: Node.js >= 18, [pnpm](https://pnpm.io) (the repo pins the version via the `packageManager` field — `corepack enable` handles it).

```sh
pnpm install
pnpm -r build          # typecheck worker + bundle CLI
pnpm -r test           # unit tests: CLI (vitest) + worker (vitest-pool-workers on real workerd + D1)
```

## Code layout and rules

- Every source file stays **under 200 lines** — split by function, not by size, when you approach the limit.
- Strict typing: no `any`, no `Record<...>` property-bag casts, no `as` assertions. External data (JSON.parse, request bodies, ccusage output) is validated with type-predicate functions (`function isX(v: unknown): v is X`).
- `packages/cli/src/`: `index.ts` (help + dispatch), `args.ts`, `commands/`, `platforms/` (one file per agent + `fs-safe.ts`/`json-merge.ts`), `state.ts` (sync throttle state), `daily.ts` (ccusage JSON validation/flattening), `collect.ts`, `upload.ts`, `config.ts`, `errors.ts`.
- `packages/worker/src/`: `index.ts` (app wiring), `types.ts`, `crypto.ts`, `auth.ts`, `routes/` (auth, keys, usage, stats).
- `packages/worker/public/`: `index.html` (markup only), `styles.css`, `js/` (classic scripts loaded in order; `app.js` boots last).

## Adding support for another editor/platform

Hook installation lives in `packages/cli/src/platforms/`, **one file per provider**. Each provider file owns its config path, its hook shape, and — when it has no hook — a comment explaining why.

1. Add `packages/cli/src/platforms/<id>.ts` exporting a `Platform` const with an `id` (the `--editor` value) and `label`, then register it in `platforms/index.ts`. Ids and labels track ccusage's own agent list.
2. If the agent has a **session-scoped** end event, implement `installHook(settingsPath?)`. Beware per-turn events dressed up as session events (Codex's `Stop`, Hermes's `on_session_end`) — firing `npx` on every turn is not acceptable. If there is no usable mechanism, omit `installHook` and comment why.
3. **Never hand-roll writes to a user-owned config.** Everything goes through `installSafely` in `platforms/fs-safe.ts`, which gives you: only-ENOENT-starts-fresh, abort-on-malformed, a `<name>.ccusage-hub-bak` backup, an atomic temp-file+rename write, and a post-write re-read that verifies the hook landed and no top-level key was lost — rolling back if not. That verification is the part that catches serializer bugs, so don't skip it by writing the file yourself. Files we own outright (goose's plugin dir) still use `atomicWrite`, just without the backup/rollback.
4. For JSON configs use `mergeJsonHook` (`platforms/json-merge.ts`), which wraps `installSafely`: pass the settings path, a callback that locates/creates the event array, an entry builder, and a dedupe predicate. See `claude.ts` for the nested shape and `copilot.ts` for a flat schema with its own version guard and dedupe predicate. Non-JSON configs (`kimi.ts` TOML, `hermes.ts` YAML) call `installSafely` directly, parsing → mutating → serializing so the rest of the user's config survives.
5. Hook commands come from `hookCommand()` in `platforms/types.ts` — never a hardcoded string. A platform whose only event is per-turn passes `hookCommand(PER_TURN_MIN_INTERVAL_SECONDS)` so `sync` throttles itself instead of scanning on every assistant reply. Any command must keep the `ccusage-hub` substring: the dedupe predicates match on it. Plugin files that spawn us directly use `hookArgv()` — the same command as an argv array, derived from the same constant so the two spellings cannot drift.
6. Every installer must accept a `settingsPath` override so tests can point at a temp dir.
7. `--editor` validation, the help text, and the interactive prompt all derive from the registry — no other CLI change needed.
8. Add `platforms/<id>.test.ts` (fresh install, idempotent re-run, existing config preserved, malformed input aborts) and update the hook-capable id set in `platforms.test.ts`. Use `mkdtempSync` — never touch a real config home.
9. Update the editor `<select>` and hint text in the dashboard command generator (`packages/worker/public/js/init-command.js` and `index.html`).

### Platforms that need a plugin file

Some agents have no config-declared hook at all: the only way in is a plugin/extension file containing code that spawns us (OpenCode, Kilo, pi, Amp, OpenClaw). Those go through `platforms/plugin-file.ts` rather than `fs-safe.ts`'s merge machinery. The file is ours, always named `ccusage-hub-sync.<ext>` so it cannot collide with the user's own plugins, so `installOwnedFile` needs no backup or rollback — "already installed" just means the bytes on disk already match.

- **Emit the spawn with `spawnSnippet()`. Never hand-write it.** The rules it encodes are load-bearing and each one has already bitten:
  - **Never await the sync.** pi awaits its handler with no timeout before `process.exit()`, and OpenClaw awaits three of its four events with no timeout. An awaited sync stalls the agent's exit for a whole ccusage scan.
  - **Never spawn `npx.cmd` directly.** Node throws `EINVAL` on spawning any `.bat`/`.cmd` without `shell: true` (the CVE-2024-27980 hardening, 18.20.2+), so on Windows the snippet goes through `cmd.exe /c`. Bun does not enforce this, which is exactly why it is easy to miss: the Bun-hosted agents work while the Node-hosted ones (pi, OpenClaw) fail — silently, because the snippet's own `try/catch` swallows it.
  - `detached` + `unref` + `stdio: "ignore"` so the child outlives the agent; `windowsHide` to stop a console flash; argv array, never a shell string.
- Bun-hosted agents (OpenCode, Kilo, Amp) load `.ts` natively; `import type` erases fully, so a types-only SDK needs no runtime dependency and a single file drop is enough. OpenClaw is Node-only and its hooks loader has no transpiler, so it gets `.js` — plus a `package.json` with `{"type": "module"}` in our own hook dir, because otherwise `export default` in a `.js` only parses thanks to Node ≥22.7's module-syntax sniffing.
- OpenClaw is the only one needing registration, and enabling it is a config write. `openclaw hooks enable` spreads `{enabled: true}` with no check of the prior value, so **check `hooks.internal.enabled` first and never flip an explicit `false`** — that is plausibly a security decision, since these hooks run in-process as trusted code. Forward OpenClaw's stderr verbatim: its config write strips JSON5 comments and says so only there.
- Registration runs the real `openclaw` CLI, which mutates the user's real `openclaw.json`. **When `installHook` is given an explicit `settingsPath`, skip the CLI call** and return the manual `openclaw hooks enable` command instead — an explicit path means "don't touch my real environment", so `--settings-path` must sandbox the CLI call too, not just the file writes. Only the default location (or OpenClaw's own `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` relocation) auto-registers. That is also what lets the tests exercise the registration path safely — point `OPENCLAW_STATE_DIR` at a temp dir and call `installHook()` with no argument, never a real home.

### Worker + dashboard

```sh
cd packages/worker
npx wrangler d1 migrations apply DB --local
npx wrangler dev       # http://localhost:8787, first visit sets a local admin password
```

The dashboard is a single static file (`packages/worker/public/index.html`, vanilla JS + a vendored Chart.js). The API spec shared by CLI, Worker, and dashboard lives in [docs/api-contract.md](docs/api-contract.md) — changes to any endpoint must update that document and all three consumers.

### CLI

```sh
cd packages/cli
pnpm build
node dist/index.cjs sync --dry-run     # uses your real local ccusage data, uploads nothing
CCUSAGE_HUB_CONFIG=/tmp/test.json node dist/index.cjs init ...   # test against a scratch config
```

The `sync --quiet` path is the command every platform's session-end hook runs and must **never** exit non-zero or block — keep that invariant when touching `packages/cli/src/index.ts`.

## Database changes

Never edit an existing file under `packages/worker/migrations/` — add a new numbered migration instead (`0002_*.sql`, ...). Deployments apply pending migrations automatically via the `deploy` script.

## Pull requests

- Keep changes focused; match the existing code style.
- Run `pnpm -r build` before pushing — CI runs the same.
- Explain the "why" in the PR description, especially for anything touching the API contract or auth.

## Releases (maintainers)

1. Bump `version` in `packages/cli/package.json`.
2. Create a GitHub release with tag `vX.Y.Z` (must match the package version).
3. The `release.yml` workflow builds and publishes to npm with provenance via [trusted publishing](https://docs.npmjs.com/trusted-publishers) — no npm tokens are stored in the repository.
