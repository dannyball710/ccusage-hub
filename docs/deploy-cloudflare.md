# Deploying the Worker to Cloudflare

The dashboard + API is a single Cloudflare Worker with a D1 database. Both fit comfortably in Cloudflare's free tier for personal use.

## Option A — Deploy to Cloudflare button (recommended)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dannyball710/ccusage-cloud/tree/main/packages/worker)

What the button does:

1. Clones this repository into your own GitHub/GitLab account.
2. Reads `packages/worker/wrangler.jsonc`, provisions a new D1 database, and injects the real `database_id` into your copy's configuration.
3. Runs the package's `deploy` script, which applies D1 migrations (`wrangler d1 migrations apply DB --remote`) before `wrangler deploy`.
4. Enables Workers Builds: pushes to your clone's production branch redeploy automatically, and pull requests get preview URLs.

After deployment, open the Worker URL — the first visit asks you to set the admin password.

## Option B — Manual deployment with wrangler

Requirements: Node.js >= 18 and a Cloudflare account.

```sh
git clone https://github.com/dannyball710/ccusage-cloud.git
cd ccusage-cloud/packages/worker
npm install
npx wrangler login
```

1. Create the D1 database and copy the `database_id` it prints into `wrangler.jsonc` (replace the placeholder zero UUID):

   ```sh
   npx wrangler d1 create ccusage-cloud
   ```

2. Apply migrations and deploy:

   ```sh
   npx wrangler d1 migrations apply DB --remote
   npx wrangler deploy
   ```

3. Open the printed `*.workers.dev` URL and set the admin password.

## Upgrading an existing deployment

Schema and Worker upgrades are designed to be a single redeploy, with **no data loss**:

- Database changes ship as numbered files in `packages/worker/migrations/`. Wrangler tracks which migrations have been applied (in D1's `d1_migrations` table) and only runs pending ones, so applying is always safe and idempotent.
- The package's `deploy` script runs `wrangler d1 migrations apply DB --remote` before `wrangler deploy`, so code and schema always upgrade together.

**If you deployed with the button** — your clone redeploys on every push, running the same deploy script (migrations included). To pull in a new upstream version:

```sh
git remote add upstream https://github.com/dannyball710/ccusage-cloud.git   # once
git fetch upstream
git merge upstream/main
git push        # Workers Builds applies pending migrations and redeploys
```

**If you deployed manually**:

```sh
git pull
cd packages/worker
npx wrangler d1 migrations apply DB --remote   # no-op when nothing is pending
npx wrangler deploy
```

Migrations only ever add or alter schema additively; released migration files are never edited (see [CONTRIBUTING.md](../CONTRIBUTING.md)). If a future release ever requires manual steps, they will be called out in the release notes.

## Local development

```sh
cd packages/worker
npm install
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

The placeholder `database_id` in `wrangler.jsonc` is intentional — it keeps local D1 commands working without a Cloudflare account.

## Hardening (optional but recommended)

- **Custom domain**: add a route or custom domain in the Cloudflare dashboard instead of the default `*.workers.dev` hostname.
- **Rate-limit the login endpoint**: the Worker adds a delay on failed logins but has no built-in rate limiting. A Cloudflare WAF rate-limiting rule on `POST /api/login` closes that gap.
- **Cloudflare Access**: for defense in depth, put the whole dashboard behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (leave `POST /api/usage` reachable for uploaders, or use a service token).
- **Key hygiene**: create one API key per machine so a lost machine can be revoked individually from the Keys page.
