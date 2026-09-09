# Project status

Last updated: 2026-09-09

## Completed

- Repository synchronized and baseline architecture reviewed.
- Local Node.js, pnpm, and Docker prerequisites verified.
- Initial dependency lockfile generated.
- Baseline typecheck and production build pass.
- Environment and generated-file hygiene added.

## Current work

- Stabilizing migrations, configuration, CI, health checks, and test execution.
- Defining validated domain contracts for ingestion and canonical search.
- Replacing non-idempotent publication creation with a transactional canonical pipeline.

## Next priorities

1. Versioned PostgreSQL migrations and deterministic canonicalization.
2. Simulated, manual/import, and extensible HTTP source adapters.
3. Canonical opportunity search and detail APIs with provenance.
4. Identity, authorization, ownership, and audit boundaries.
5. Persistent monitors with meaningful-change suppression and idempotent delivery.
6. Mobile Discover-to-Detail vertical slice.

## Known technical debt

- Existing API and worker use raw database rows and broad `any` casts.
- Current worker marks every match as new and can create repeated alerts.
- Existing web shell is static and its controls are not wired to product behavior.
- Automated test coverage is being established from zero.

## Open product decisions

- Primary launch locale and whether the first release is English, Spanish, or bilingual.
- Brand personality and concrete product UI references.
- Initial authorized external data source and its contractual limits.
- First production notification channels beyond in-app delivery.

## Production blockers

- Authentication and tenant-safe authorization.
- Idempotent ingestion, monitor execution, alert creation, and delivery.
- Media storage and upload security.
- Rate limiting, audit trails, production telemetry, backups, and restore validation.
- End-to-end accessibility, performance, and security release gates.
