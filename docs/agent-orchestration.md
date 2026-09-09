# Build-agent orchestration

## Orchestrator

The lead agent owns architecture decisions, interface contracts, branch integration, acceptance criteria, and release readiness. It delegates bounded work to specialist agents and rejects cross-boundary coupling.

## Parallel workstreams

1. UX agent: responsive design system, routes, interaction states, accessibility.
2. Domain/API agent: schemas, auth model, REST contracts, error model.
3. Ingestion agent: source adapter SDK, fixtures, normalization, freshness.
4. Canonicalization agent: duplicate evidence model, matching tests, review queue.
5. Monitoring agent: scheduler, monitor state, change detector, suppression policy.
6. AI agent: typed intent extraction, preference scoring, explanation layer, eval set.
7. Notifications agent: in-app first, email/push next, idempotent delivery.
8. Platform agent: Docker, CI, migrations, telemetry, backups, release config.
9. QA agent: contract, E2E, accessibility, idempotency, failure injection, load test.

## Required handoff artifacts

Every workstream must deliver code, automated tests, a short design note, operational metrics, and rollback notes.

## Release gates

- Zero P0/P1 security findings.
- Queue jobs are idempotent under retries.
- No duplicate user notification from the same alert/channel idempotency key.
- Source URLs retain provenance.
- Ambiguous canonical merges remain unmerged.
- Core mobile flows pass at 360x800 and 390x844.
- API p95 under 400 ms for cached/common reads at MVP load target.
- Monitor execution can process at least 10,000 active monitors/day on a single worker group before horizontal scale is required.
