import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { closeDatabase, databaseReady, query } from '@realty/db';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true, service: 'api' }));
app.get('/ready', async (_request, reply) => {
  const ready = await databaseReady();
  return reply.code(ready ? 200 : 503).send({ ok: ready, service: 'api', dependency: 'postgres' });
});

app.get('/v1/opportunities', async () => {
  const result = await query(`
    SELECT
      p.id,
      p.canonical_address AS address,
      p.operation,
      p.canonical_price AS price,
      p.currency,
      p.area_total_m2,
      p.rooms,
      p.last_verified_at,
      COUNT(pub.id)::int AS publication_count
    FROM property p
    LEFT JOIN publication pub ON pub.property_id = p.id AND pub.publication_status = 'active'
    WHERE p.status IN ('active','uncertain')
    GROUP BY p.id
    ORDER BY p.last_verified_at DESC NULLS LAST, p.updated_at DESC
    LIMIT 100
  `);
  return { items: result.rows };
});

const monitorInput = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  intentText: z.string().min(5).max(2000),
  criteria: z.record(z.string(), z.unknown()).default({}),
  cadence: z.enum(['hourly','daily','weekly']).default('daily'),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),
  instantExceptional: z.boolean().default(true)
});

app.post('/v1/monitors', async (request, reply) => {
  const parsed = monitorInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const input = parsed.data;

  const result = await query(`
    INSERT INTO monitor (user_id, name, intent_text, criteria, cadence, timezone, instant_exceptional, next_run_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now())
    RETURNING *
  `, [input.userId ?? null, input.name, input.intentText, JSON.stringify(input.criteria), input.cadence, input.timezone, input.instantExceptional]);

  return reply.code(201).send(result.rows[0]);
});

app.get('/v1/monitors', async () => {
  const result = await query(`SELECT * FROM monitor ORDER BY created_at DESC LIMIT 100`);
  return { items: result.rows };
});

app.get('/v1/alerts', async () => {
  const result = await query(`SELECT * FROM alert ORDER BY created_at DESC LIMIT 100`);
  return { items: result.rows };
});

const publicationInput = z.object({
  sourceCode: z.string().default('demo'),
  sourceListingId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().min(2),
  description: z.string().optional(),
  publisherType: z.enum(['owner','operator','aggregated']).default('owner'),
  publisherName: z.string().optional(),
  operation: z.enum(['sale','rent']),
  address: z.string().min(4),
  price: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  rooms: z.number().int().positive().optional(),
  areaTotalM2: z.number().positive().optional()
});

app.post('/v1/publications', async (request, reply) => {
  const parsed = publicationInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const i = parsed.data;

  const sourceResult = await query<{id: string}>(`SELECT id FROM source WHERE code=$1`, [i.sourceCode]);
  const sourceId = sourceResult.rows[0]?.id;
  if (!sourceId) return reply.code(400).send({ error: 'Unknown source' });

  const propertyResult = await query<{id: string}>(`
    INSERT INTO property (canonical_address, operation, canonical_price, currency, rooms, area_total_m2, last_verified_at)
    VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id
  `, [i.address, i.operation, i.price, i.currency, i.rooms ?? null, i.areaTotalM2 ?? null]);

  const propertyId = propertyResult.rows[0]!.id;
  const publicationResult = await query(`
    INSERT INTO publication (source_id, source_listing_id, source_url, property_id, publisher_type, publisher_name, title, description, currency, price, last_verified_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *
  `, [sourceId, i.sourceListingId, i.sourceUrl, propertyId, i.publisherType, i.publisherName ?? null, i.title, i.description ?? null, i.currency, i.price]);

  return reply.code(201).send(publicationResult.rows[0]);
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDatabase();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      app.log.error(error, 'graceful shutdown failed');
      process.exitCode = 1;
    });
  });
}
