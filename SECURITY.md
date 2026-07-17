# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via [GitHub private vulnerability reporting](https://github.com/dannyball710/ccusage-hub/security/advisories/new). Do not open public issues for security problems.

You can expect an initial response within a week. Please include reproduction steps and the affected component (CLI, Worker API, or dashboard).

## Supported versions

Only the latest released version of the `ccusage-hub` npm package and the `main` branch of the Worker are supported with security fixes.

## Security model

This is a self-hosted personal tool; each deployment has a single admin. Design highlights:

- **Admin password**: PBKDF2-SHA256 (100,000 iterations, 16-byte random salt), stored in D1. No Worker secrets are used.
- **Sessions**: `ses_` + 64 hex chars of CSPRNG output; only the SHA-256 hash is stored, with a 30-day expiry.
- **API keys**: `ccu_` + 64 hex chars of CSPRNG output; only the SHA-256 hash is stored. Keys are shown once at creation, are individually revocable, and are only valid on the upload endpoint (`POST /api/usage`) — a leaked upload key cannot read any data.
- **Payload limits**: uploads are capped at 2000 rows per request and validated field-by-field.

Known trade-offs (accepted for a single-admin personal tool, documented so deployers can decide):

- No built-in rate limiting on `POST /api/login` (failed logins are delayed ~200ms). Mitigate with a Cloudflare WAF rate-limiting rule — see [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md).
- The dashboard stores the session token in `localStorage`.
