# MVP architecture

## Runtime topology

Client -> Next.js web -> Fastify API -> PostgreSQL
                                  -> pg-boss queues -> worker replicas
                                                     -> source adapters
                                                     -> agent graph
                                                     -> notification adapters

PostgreSQL is initially the system of record, job queue store, monitor state store, audit store, and vector store. This deliberately avoids Redis, Kafka, Elasticsearch, Kubernetes, and a separate vector database in the MVP.

## Scale boundaries

- Web is stateless and horizontally replicable.
- API is stateless and horizontally replicable.
- Workers are horizontally replicable. pg-boss coordinates competing workers in PostgreSQL.
- PostgreSQL can move from local Docker to a managed PostgreSQL service without changing domain code.
- Add read replicas when read traffic requires them.
- Add a dedicated search engine only after PostgreSQL full text, trigram, geo, and vector indexes are insufficient.
- Add object storage and CDN for property media before public launch.

## Source adapter contract

Every connector returns immutable source snapshots with:

- source code
- source listing ID
- direct source URL
- fetched timestamp
- raw payload
- normalized fields
- status evidence

Adapters must not directly modify canonical properties. The normalization/canonicalization pipeline owns that transition.

## Canonicalization

1. Exact source identity.
2. Normalized address and unit match.
3. Geo proximity plus structural fields.
4. Image fingerprint similarity when available.
5. Text/vector similarity.
6. AI review only for ambiguous candidates.

Persist match confidence and evidence. Do not silently merge low-confidence records.

## Monitor lifecycle

1. User supplies intent.
2. Intent interpreter generates typed criteria.
3. Hard constraints query candidates.
4. Preference ranker scores soft criteria.
5. Change detector compares with previous monitor state.
6. Significance policy suppresses noise.
7. Alert composer generates concise explanation.
8. Delivery adapter sends in-app, email, push, or WhatsApp.
9. Delivery state and errors are persisted.

## Observability

Instrument API requests, queue latency, queue failures, source adapter latency, source verification rates, monitor run duration, AI latency/cost, notifications sent, and notifications suppressed. Export traces and metrics through OpenTelemetry.
