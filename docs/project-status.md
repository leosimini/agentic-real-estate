# Project status

Last updated: 2026-09-09

## Completed

- Repository synchronized and baseline architecture reviewed.
- Reproducible pnpm/Docker foundation, versioned transactional migrations, readiness checks, and CI validation.
- Runtime domain contracts, deterministic hard-constraint matching, and guarded source-adapter boundaries.
- Authenticated, tenant-scoped API for canonical search/detail, saved/dismissed state, monitors, alerts, and direct publishing.
- Transactional direct publishing with immutable source snapshots, canonical candidate evidence, review queues, and idempotent replay.
- Leased recurring monitor execution with persisted snapshots, meaningful-change suppression, and idempotent in-app delivery.
- Automated coverage: 30 unit/contract checks plus three PostgreSQL integration scenarios.
- Product direction recorded in `PRODUCT.md`: Spanish (Argentina), ARS/USD, five launch markets, and WCAG 2.2 AA.

## Current work

- Building the mobile-first Discover → Detail → Save/Dismiss → Monitor → Alert journey.
- Converting remaining raw monitor, alert, and history responses to explicit API contracts.
- Adding AI-assisted intent parsing behind deterministic validation and user confirmation.

## Next priorities

1. Mobile Discover-to-Detail vertical slice and authenticated navigation.
2. Typed monitor editing, pause/resume, and alert read state.
3. AI intent parsing and explanation layer.
4. Authorized launch-source integration and media pipeline.
5. Operator and listing-management workflows.

## Known technical debt

- Monitor, alert, and property-history endpoints still expose database-shaped rows.
- Current opportunity discovery uses PostgreSQL filtering; ranking and geo search need production calibration.
- The existing web shell is static and its controls are not yet wired to product behavior.
- No authorized external inventory feed or production media storage has been selected.

## Open product decisions

- Initial authorized external data source and its contractual limits.
- First production notification channel beyond in-app delivery.
- Reference products to sharpen the agreed calm, discerning, trustworthy visual direction.

## Production blockers

- Media storage and upload security.
- Production telemetry, secrets management, backups, and restore validation.
- Account recovery and email verification.
- End-to-end accessibility, performance, and security release gates.
