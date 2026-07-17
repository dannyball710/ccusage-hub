# Contributing

Thanks for your interest in improving ccusage-hub!

## Development setup

Requirements: Node.js >= 18, [pnpm](https://pnpm.io) (the repo pins the version via the `packageManager` field — `corepack enable` handles it).

```sh
pnpm install
pnpm -r build          # typecheck worker + bundle CLI
```

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
