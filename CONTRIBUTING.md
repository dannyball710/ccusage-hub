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
- `packages/cli/src/`: `index.ts` (help + dispatch), `args.ts`, `commands/`, `platforms.ts` (editor hook registry), `daily.ts` (ccusage JSON validation/flattening), `collect.ts`, `upload.ts`, `config.ts`, `errors.ts`.
- `packages/worker/src/`: `index.ts` (app wiring), `types.ts`, `crypto.ts`, `auth.ts`, `routes/` (auth, keys, usage, stats).
- `packages/worker/public/`: `index.html` (markup only), `styles.css`, `js/` (classic scripts loaded in order; `app.js` boots last).

## Adding support for another editor/platform

Hook installation is abstracted behind the platform registry in `packages/cli/src/platforms.ts`:

1. Add an entry to `PLATFORMS` with an `id` (the `--editor` value) and `label`. If the tool has a hook mechanism, implement `installHook(settingsPath?)` — it must be idempotent, must merge with (never clobber) existing user settings, and must abort on malformed files.
2. `--editor` validation, the help text, and the interactive prompt all derive from the registry — no other CLI change needed.
3. Add unit tests next to `platforms.test.ts` (fresh install, idempotent re-run, existing settings preserved, malformed file aborts).
4. Update the editor `<select>` and hint text in the dashboard command generator (`packages/worker/public/js/init-command.js` and `index.html`).

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

The `sync --quiet` path is used as a Claude Code `SessionEnd` hook and must **never** exit non-zero or block — keep that invariant when touching `packages/cli/src/index.ts`.

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
