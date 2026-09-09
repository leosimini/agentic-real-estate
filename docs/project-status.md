# Project status

Last updated: 2026-09-09

## Completed

- Repository synchronized and baseline architecture reviewed.
- Reproducible pnpm/Docker foundation, versioned transactional migrations, readiness checks, and CI validation.
- Runtime domain contracts, deterministic hard-constraint matching, and guarded source-adapter boundaries.
- Authenticated, tenant-scoped API for canonical search/detail, saved/dismissed state, monitors, alerts, and direct publishing.
- Transactional direct publishing with immutable source snapshots, canonical candidate evidence, review queues, and idempotent replay.
- Leased recurring monitor execution with persisted snapshots, meaningful-change suppression, and idempotent in-app delivery.
- Automated coverage: 43 unit/contract checks plus four PostgreSQL integration scenarios.
- Product direction recorded in `PRODUCT.md`: Spanish (Argentina), ARS/USD, five launch markets, and WCAG 2.2 AA.
- Mobile Discover, canonical detail/provenance, save/dismiss, monitor/alert, private publishing, and profile journeys verified at 360px against the production Docker build.
- Provider-neutral natural-language intent interpretation with strict structured outputs, editable confirmation, deterministic fallback, request metadata, and Argentine-language evals.
- Professional onboarding, verified-operator gates, idempotent bounded imports, provenance-preserving claims, publisher-owned availability updates, inquiry routing, and mobile inventory/inbox UI.
- Grounded property Q&A and two-to-three-item comparison with source count, freshness, budget, and price-per-square-metre evidence.
- Keyboard-contained dialogs, background inertness, focus restoration, a skip link, live result announcements, stronger secondary-text contrast, and a 360px no-overflow check.

## Current work

- Hardening production observability, notification delivery, and release operations.

## Next priorities

1. Email notification adapter and delivery retry/dead-letter operations.
2. Account verification/recovery and revocable sessions.
3. Automated accessibility, load, backup/restore, and deployment gates.
4. Authorized launch-source integration and media pipeline.

## Known technical debt

- Current opportunity discovery uses PostgreSQL filtering; ranking and geo search need production calibration.
- No authorized external inventory feed or production media storage has been selected.
- Password auth still needs recovery and verified-email flows before public launch.

## Open product decisions

- Initial authorized external data source and its contractual limits.
- First production notification channel beyond in-app delivery.
- Reference products to sharpen the agreed calm, discerning, trustworthy visual direction.

## Production blockers

- Media storage and upload security.
- Production telemetry, secrets management, backups, and restore validation.
- Account recovery and email verification.
- Automated end-to-end accessibility, performance, and security release gates.
