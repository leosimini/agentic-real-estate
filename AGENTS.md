# Engineering agent instructions

This repository is designed for parallel implementation by specialized coding agents.

## Shared rules

- Preserve the canonical `property` plus many `publication` model.
- Keep source-specific logic behind adapters.
- Keep durable recurring work in the worker, never in web requests.
- Never let an LLM decide whether a job succeeded, retried, or was delivered.
- Every AI output crossing a system boundary must use a schema and validation.
- Add migrations for schema changes.
- Add tests for canonicalization, monitor matching, and notification suppression.
- Maintain mobile behavior at 360 px width.

## Agent lanes

### UX agent
Own `apps/web`. Implement Discover, Monitors, Opportunity Detail, Compare, Publish, Operator Claim, and Notifications.

### API agent
Own public API contracts, validation, authorization, pagination, and audit fields.

### Ingestion agent
Own source adapters, snapshots, normalization, freshness checks, and canonical duplicate matching.

### Monitoring agent
Own monitor scheduling, change detection, digest suppression, alert creation, and channel dispatch.

### AI agent
Own natural-language criteria extraction, semantic preference scoring, ambiguous duplicate review, and explanation generation. Keep provider access behind an interface.

### Platform agent
Own Docker images, CI, database migrations, observability, secrets, deployment manifests, and backups.

### QA agent
Own API contract tests, worker idempotency tests, E2E mobile tests, performance baselines, and release gates.

## Merge order

Platform base -> database -> API contracts -> ingestion -> monitoring -> AI adapters -> UX integration -> E2E -> release.
