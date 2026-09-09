# Project status

Last updated: 2026-09-09

## Completed

- Repository synchronized and baseline architecture reviewed.
- Reproducible pnpm/Docker foundation, versioned transactional migrations, readiness checks, and CI validation.
- Runtime domain contracts, deterministic hard-constraint matching, and guarded source-adapter boundaries.
- Authenticated, tenant-scoped API for canonical search/detail, saved/dismissed state, monitors, alerts, and direct publishing.
- Transactional direct publishing with immutable source snapshots, canonical candidate evidence, review queues, and idempotent replay.
- Leased recurring monitor execution with persisted snapshots, meaningful-change suppression, and idempotent in-app delivery.
- Automated coverage: 50 unit/contract checks, five PostgreSQL integration scenarios, and two Chromium release scenarios.
- Product direction recorded in `PRODUCT.md`: Spanish (Argentina), ARS/USD, five launch markets, and WCAG 2.2 AA.
- Mobile Discover, canonical detail/provenance, save/dismiss, monitor/alert, private publishing, and profile journeys verified at 360px against the production Docker build.
- Photo-first responsive UI with a modern mineral-green design system, reference-media disclosure, image-led opportunity cards, visual detail and comparison views, short state motion, and consistent surfaces across Discover, Monitors, Publish, Saved, and Profile.
- Provider-neutral natural-language intent interpretation with strict structured outputs, editable confirmation, deterministic fallback, request metadata, and Argentine-language evals.
- Professional onboarding, verified-operator gates, idempotent bounded imports, provenance-preserving claims, publisher-owned availability updates, inquiry routing, and mobile inventory/inbox UI.
- Grounded property Q&A and two-to-three-item comparison with source count, freshness, budget, and price-per-square-metre evidence.
- Keyboard-contained dialogs, background inertness, focus restoration, a skip link, live result announcements, stronger secondary-text contrast, and a 360px no-overflow check.
- Revocable HttpOnly browser sessions with origin checks, email verification, password recovery, one-time signed account tokens, and removal of browser token persistence.
- Verified-email notification preferences plus a leased webhook email outbox with idempotency, exponential retry, dead-letter state, admin inspection, and audited retry.
- Request correlation, Prometheus HTTP metrics, automated axe/Chromium accessibility gates, and backup/restore runbooks and guarded scripts.
- A checksummed local backup/restore drill reproduced all 11 migrations and audited table counts; the production-image read smoke completed 100 requests with no errors at 265 ms p95 on the development machine.

## Release state

- The repository is a verified release candidate. Public launch now depends on provider selection, authorized inventory, media storage, staging validation, and an independent security review.

## Next priorities

1. Select and configure the authorized launch source, media store/CDN, email webhook, telemetry, hosting, and managed PostgreSQL providers.
2. Integrate the authorized source and production media pipeline.
3. Deploy to staging, execute and record the documented backup/restore drill, and calibrate query performance with representative inventory.
4. Commission an independent security review and representative capacity test against the deployment candidate.

## Known technical debt

- Current opportunity discovery uses PostgreSQL filtering; ranking and geo search need production calibration.
- No authorized external inventory feed or production media storage has been selected.
- Monitor candidate selection SQL-pushes hard constraints and is bounded to 5,000 matching canonical records per run by default; the bound is configurable up to 20,000 and needs launch-volume calibration.

## Open product decisions

- Initial authorized external data source and its contractual limits.
- Production email webhook/provider and its delivery contract.
- Hosting, secrets, managed PostgreSQL, telemetry, and media-storage providers.
- Replacement policy for editorial reference images once verified source media becomes available.

## Production blockers

- Authorized inventory source and media storage/upload security.
- Production provider configuration, staging deployment, and recorded restore validation.
- Representative load test and independent security review.
