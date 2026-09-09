# Operations runbook

## Production configuration

Run the web, API, worker, migration job, and PostgreSQL as separate workloads. Publish only the web workload publicly; route `/api/*` to the private API. Keep PostgreSQL, the worker, and the one-shot migration job on private networking.

Required secrets:

- `DATABASE_URL`
- `JWT_SECRET` with at least 32 random characters
- a distinct `ACCOUNT_TOKEN_SECRET` with at least 32 random characters, shared only by API and worker
- `OPENAI_API_KEY` only when `AI_PROVIDER=openai`
- `EMAIL_WEBHOOK_URL` and, when required, `EMAIL_WEBHOOK_BEARER_TOKEN` only when `EMAIL_PROVIDER=webhook`

Set `CORS_ORIGINS` and `PUBLIC_WEB_URL` to the exact HTTPS web origin. The API rejects cross-origin writes and requires an allowlisted `Origin` for cookie-authenticated writes. Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to `/`.

Set `TRUST_PROXY=true` only when the API is private and all traffic reaches it through the trusted web/reverse proxy described above. This preserves the real client IP for request logs and per-IP rate limiting; leave it `false` whenever clients can reach the API directly.

## Deploy order

1. Back up the database and retain its checksum.
2. Run the migration image as a one-shot job. A checksum mismatch on an already-applied migration must stop the release.
3. Deploy the API and wait for `/ready` to return 200.
4. Deploy the worker and confirm its `started` event.
5. Deploy the web workload and run the release browser tests against the public URL.
6. Confirm `/metrics` scraping and alerting before shifting all traffic.

Rollback application images independently. Database migrations are forward-only; use the verified pre-release backup only when the release owner explicitly chooses a destructive data rollback.

## Email delivery

The worker supports `EMAIL_PROVIDER=disabled` and a vendor-neutral `webhook` adapter. The webhook receives `to`, `subject`, `text`, and `idempotencyKey`; it must honor that key to prevent duplicates. Delivery rows are leased, retry with exponential backoff, and become `dead` after the configured attempt limit. Account-token plaintext is reconstructed only at send time from the token id and secret; it is never stored.

Admins can inspect `GET /v1/admin/notification-deliveries` and requeue a failed/dead delivery with `POST /v1/admin/notification-deliveries/:id/retry`. User email digests require both verified email and enabled notification preferences.

## Backups and restore drill

Create a restricted custom-format backup:

```sh
DATABASE_URL='postgres://...' BACKUP_DIR='./backups' ./scripts/backup-postgres.sh
```

Restore only into a confirmed target:

```sh
DATABASE_URL='postgres://...' BACKUP_FILE='./backups/realty-YYYYMMDDTHHMMSSZ.dump' CONFIRM_RESTORE=restore ./scripts/restore-postgres.sh
```

Run a restore drill before launch and quarterly thereafter. Record restore duration, row-count checks for `app_user`, `property`, `publication`, `monitor`, and `alert`, and the complete migration ledger. Never test a restore against the live production database.

## Load smoke test

Run the bounded common-read smoke test against each release candidate:

```sh
LOAD_BASE_URL='https://api.example.com' LOAD_REQUESTS=100 LOAD_CONCURRENCY=10 LOAD_P95_LIMIT_MS=400 pnpm test:load
```

The script fails on any non-2xx response or when p95 exceeds the threshold. Keep its volume below the deployed global rate limit (120 requests per minute by default). This is a release smoke test, not capacity planning; a staging run with representative data and traffic shape, an explicitly raised test rate limit, and an agreed capacity target is still required before public launch.

## Observability and alert thresholds

The API emits structured logs with a request id, returns `x-request-id`, and exposes Prometheus metrics at `/metrics`. At minimum alert on:

- `/ready` unavailable for two consecutive probes;
- 5xx responses above 2% for five minutes;
- p95 common-read latency above 400 ms for ten minutes;
- any `dead` notification delivery;
- worker queue errors, failed monitor runs, or no worker `started`/heartbeat signal after deployment;
- PostgreSQL storage, connection, or replication thresholds from the managed database provider.

Do not place tokens, credentials, full email bodies, or raw provider responses in logs.

## Incident basics

For notification incidents, disable the provider at the worker, preserve queued rows, repair the adapter, then use the audited admin retry endpoint. For compromised account-token or JWT secrets, rotate the secret, increment `app_user.auth_version` for affected accounts (or all accounts), restart API and worker, and issue fresh verification/recovery links. For source-quality incidents, pause the source adapter without deleting provenance or snapshots.
