# Realty Agent MVP

Mobile-first agentic real-estate aggregator starter.

## Product thesis

The primary object is a canonical property opportunity, not a source listing. Multiple publications can point to one property. Users create persistent monitors from natural-language intent. Workers repeatedly ingest and verify publications, update canonical opportunities, rank meaningful changes, and notify users.

## MVP services

- `apps/web`: Next.js responsive product shell.
- `apps/api`: Fastify API for opportunities, monitors, and direct publications.
- `apps/worker`: PostgreSQL-backed durable jobs and monitor-agent workflow.
- `packages/core`: shared domain types and deterministic ranking helpers.
- `packages/db`: shared PostgreSQL connection.
- `packages/ingestion`: validated source adapters and canonical candidate scoring.
- `packages/monitoring`: deterministic change detection, suppression, digest, and idempotency rules.
- `packages/ai`: provider-neutral intent interpretation and property Q&A, strict output validation, deterministic fallback, and evals.
- `infra/postgres`: canonical data model with pgvector enabled.

## Run locally

1. Copy `.env.example` to `.env` when running services outside Docker or when overriding exposed ports.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.
4. API health is `http://localhost:4000/health`.

Intent interpretation defaults to local deterministic rules. To enable the OpenAI provider, set `AI_PROVIDER=openai` and provide `OPENAI_API_KEY` only to the API service. The browser never receives provider credentials, and every interpretation remains an editable draft until the user confirms it.

Browser authentication uses a revocable `HttpOnly`, same-site session cookie; bearer tokens remain available for non-browser API clients. Account verification and password recovery use expiring one-time links. Set `EMAIL_PROVIDER=webhook` plus the webhook URL and credentials to deliver those links and verified-user monitor digests. See `docs/operations.md` for deployment, delivery, metrics, backup, restore, and incident procedures.

Authenticated publishers can manage their own availability from Profile. Professional profiles begin in a pending state; bulk imports and aggregate-publication claims require an audited verification step. Approved claims create a new operator publication and preserve the original source attribution.

If a default host port is occupied, override it without changing container networking, for example:

```sh
POSTGRES_PORT=55432 API_PORT=4400 WEB_PORT=3300 docker compose up --build
```

Migrations are ordered SQL files under `infra/postgres/`. Docker runs them through a dedicated one-shot migration service before starting the API or worker. Outside Docker, set `DATABASE_URL` and run `pnpm db:migrate`.

## Validate changes

```sh
pnpm check
DATABASE_URL='postgres://...' pnpm test:integration
DATABASE_URL='postgres://...' pnpm test:e2e
LOAD_BASE_URL='http://localhost:4000' pnpm test:load
docker compose config --quiet
```

## MVP implementation sequence

1. Mobile search, opportunity detail, saved state, monitor, and alert UI. Implemented.
2. Basic comparison and property Q&A. Implemented.
3. First authorized production inventory feed and media pipeline.
4. Email webhook adapter and delivery state machine. Implemented. Push remains later.
5. Operator claim and listing-management flow. Implemented.
6. Metrics, account security, and automated accessibility gates. Implemented. Product analytics and load calibration remain.

## Architecture rule

Use deterministic code for fetching, retrying, scheduling, matching hard constraints, persistence, and message delivery. Use AI only where probabilistic reasoning adds value.
