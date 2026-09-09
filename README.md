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
- `infra/postgres`: canonical data model with pgvector enabled.

## Run locally

1. Copy `.env.example` to `.env` if you want to run services outside Docker.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.
4. API health is `http://localhost:4000/health`.

## MVP implementation sequence

1. Authentication and user profiles.
2. Production source adapter contract and first authorized feed.
3. Canonicalization and duplicate resolver.
4. Search API plus map/list UI.
5. Natural-language monitor creation.
6. Recurring monitor execution and in-app alerts.
7. Email/push adapters.
8. Owner publishing flow.
9. Operator claim and listing-management flow.
10. Product analytics, observability, security hardening, and load tests.

## Architecture rule

Use deterministic code for fetching, retrying, scheduling, matching hard constraints, persistence, and message delivery. Use AI only where probabilistic reasoning adds value.
