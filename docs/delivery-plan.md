# End-to-end delivery plan

## Phase 0, foundation

Exit criteria: local Docker stack boots, CI passes, migrations run, health checks work, auth boundary is defined, and development environments are reproducible.

Primary agents: Platform, Domain/API, QA.

## Phase 1, consumer discovery MVP

Build source adapter contract, first permitted data source, canonical opportunity records, list/search, opportunity detail, source provenance, save/dismiss, and basic comparison.

Exit criteria: a consumer can find a property, see all source publications, understand freshness, and save or dismiss it from mobile.

Primary agents: Ingestion, Canonicalization, API, UX, QA.

## Phase 2, persistent monitoring

Build natural-language criteria extraction, typed criteria editor, monitor scheduler, incremental change detection, suppression rules, in-app digests, and exceptional alerts.

Exit criteria: monitors run idempotently under retries and produce no duplicate alert deliveries.

Primary agents: Monitoring, AI, Notifications, QA.

## Phase 3, supply creation

Build owner listing flow, operator profile, listing management, operator claim flow, verification, and source-aware updates.

Exit criteria: an owner can publish and an operator can claim and maintain an imported listing without losing provenance.

Primary agents: UX, API, Supply, QA.

## Phase 4, launch hardening

Add object storage/CDN, rate limiting, abuse protection, backups and restore drills, production observability, accessibility checks, security review, load tests, and incident runbooks.

Exit criteria: production release gates in `docs/agent-orchestration.md` pass.

Primary agents: Platform, Security, QA, Orchestrator.

## Phase 5, scale only when measured

Possible additions after evidence requires them: read replicas, dedicated search, Redis cache, event streaming, workflow engine migration, independent ingestion worker pools, and regional deployment. None are required by the MVP architecture.
