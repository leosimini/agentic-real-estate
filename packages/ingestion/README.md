# Ingestion domain package

This package owns source-boundary validation and deterministic canonical candidate evidence. It has no database or queue dependency.

## Adapter boundary

- Simulated and manual/import adapters validate complete batches before exposing them.
- The HTTP adapter accepts source-specific response mappers, but validates their output with `@realty/core` schemas.
- HTTP endpoints require HTTPS, an explicit hostname allowlist, standard port 443, JSON responses, bounded response sizes, and a timeout. Redirects, URL credentials, localhost, and IP literals are rejected.
- Adapters only return snapshots. They do not write publications or canonical properties, and they do not implement retries; durable workers own those concerns.

## Canonical decisions

- Exact source identity is `confirmed`.
- An exact building and matching explicit unit can be `confirmed` when supporting evidence reaches the threshold.
- Missing unit evidence can only be `likely` or `potential`.
- Conflicting units or operations are `no_match`.
- Only `confirmed` sets `autoConfirm: true`; all uncertain outcomes must remain separate until reviewed.

When this package is connected to the worker, record adapter latency, invalid snapshot counts, status distribution, decision distribution, and canonical review outcomes. Rollback is safe because the package is currently pure and persistence-free.
