import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  createResilientIntentInterpreter,
  createResilientPropertyAssistant,
  DeterministicIntentInterpreter,
  DeterministicPropertyAssistant,
  OpenAIIntentInterpreter,
  OpenAIPropertyAssistant
} from '@realty/ai';
import {
  alertDtoSchema,
  monitorDtoSchema,
  opportunityDtoSchema,
  propertyHistoryEventDtoSchema,
  publicationDtoSchema,
  searchCriteriaSchema
} from '@realty/core';
import { normalizeAddress } from '@realty/ingestion';
import { databaseReady, query, withTransaction } from '@realty/db';
import {
  authenticate,
  hashPassword,
  passwordCredentialOrDummy,
  verifyPassword,
  type Principal
} from './auth.js';
import { decodeCursor, encodeCursor } from './pagination.js';
import { loadApiConfig, type ApiConfig } from './config.js';
import {
  createDirectPublication,
  directPublicationInputSchema,
  IdempotencyConflictError
} from './publications.js';
import { registerOperatorRoutes } from './operator-routes.js';

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const registerInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(2).max(120).optional()
}).strict();
const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200)
}).strict();
const intentInputSchema = z.object({
  intent: z.string().trim().min(5).max(2000)
}).strict();
const propertyQuestionSchema = z.object({
  question: z.string().trim().min(3).max(1000)
}).strict();

const monitorInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  intentText: z.string().trim().min(5).max(2000),
  criteria: searchCriteriaSchema.default({}),
  cadence: z.enum(['hourly','daily','weekly']).default('daily'),
  timezone: z.string().trim().min(1).max(100).default('America/Argentina/Buenos_Aires'),
  instantExceptional: z.boolean().default(true)
}).strict();
const monitorUpdateSchema = monitorInputSchema.partial().extend({ enabled: z.boolean().optional() }).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one monitor field is required' }
);
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

const opportunityQuerySchema = z.object({
  operation: z.enum(['sale', 'rent']).optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  locations: z.string().trim().max(600).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  minAreaM2: z.coerce.number().nonnegative().optional(),
  rooms: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional()
}).strict().superRefine((value, context) => {
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    context.addIssue({ code: 'custom', path: ['maxPrice'], message: 'maxPrice must be greater than or equal to minPrice' });
  }
});

const opportunityParamsSchema = z.object({ id: z.string().uuid() }).strict();
const dismissalInputSchema = z.object({
  reason: z.enum(['price','location','condition','layout','floor','noise','expenses','unavailable','other']),
  note: z.string().trim().max(1000).optional()
}).strict();

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: Principal['role'];
  password_hash: string;
  password_salt: string;
};

type OpportunityRow = {
  id: string;
  address: string | null;
  operation: 'sale' | 'rent' | 'wanted';
  price: string | null;
  currency: string | null;
  area_total_m2: string | null;
  bedrooms: number | null;
  rooms: number | null;
  floor: string | null;
  status: string;
  updated_at: Date;
  last_verified_at: Date | null;
  publication_count: number;
};

type PublicationRow = {
  id: string;
  property_id: string;
  source_listing_id: string;
  source_url: string;
  publisher_type: string | null;
  publisher_name: string | null;
  title: string | null;
  description: string | null;
  currency: string | null;
  price: string | null;
  publication_status: string;
  first_seen_at: Date;
  last_seen_at: Date;
  last_verified_at: Date | null;
  source_code: string;
  source_name: string;
};

type MonitorRow = {
  id: string;
  name: string;
  intent_text: string;
  criteria: unknown;
  cadence: 'hourly' | 'daily' | 'weekly';
  timezone: string;
  instant_exceptional: boolean;
  enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
  created_at: Date;
};

type AlertRow = {
  id: string;
  monitor_id: string | null;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
};

function publicUser(user: Pick<UserRow, 'id' | 'email' | 'display_name' | 'role'>) {
  return { id: user.id, email: user.email, displayName: user.display_name, role: user.role };
}

function opportunityDto(row: OpportunityRow) {
  const verifiedAt = row.last_verified_at?.toISOString() ?? null;
  const ageHours = row.last_verified_at
    ? (Date.now() - row.last_verified_at.getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const freshness = ageHours <= 24
    ? 'verified_today'
    : ageHours <= 72
      ? 'verified_recently'
      : row.status === 'uncertain'
        ? 'status_uncertain'
        : 'possibly_unavailable';

  return opportunityDtoSchema.parse({
    id: row.id,
    title: row.address ?? 'Property opportunity',
    address: row.address,
    operation: row.operation,
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    areaTotalM2: row.area_total_m2 === null ? null : Number(row.area_total_m2),
    bedrooms: row.bedrooms,
    rooms: row.rooms,
    floor: row.floor,
    publicationCount: row.publication_count,
    lastVerifiedAt: verifiedAt,
    freshness
  });
}

function monitorDto(row: MonitorRow) {
  return monitorDtoSchema.parse({
    id: row.id,
    name: row.name,
    intentText: row.intent_text,
    criteria: row.criteria,
    cadence: row.cadence,
    timezone: row.timezone,
    instantExceptional: row.instant_exceptional,
    enabled: row.enabled,
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  });
}

function alertDto(row: AlertRow) {
  return alertDtoSchema.parse({
    id: row.id,
    monitorId: row.monitor_id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null
  });
}

function signToken(app: FastifyInstance, config: ApiConfig, user: Pick<UserRow, 'id' | 'email' | 'role'>) {
  return app.jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    {
      expiresIn: config.jwtExpiresIn,
      iss: config.jwtIssuer,
      aud: config.jwtAudience,
      algorithm: 'HS256'
    }
  );
}

export async function buildApp(config: ApiConfig = loadApiConfig()): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: false });
  const intentInterpreter = createResilientIntentInterpreter({
    primary: config.aiProvider === 'openai'
      ? new OpenAIIntentInterpreter({
          apiKey: config.openAiApiKey!,
          model: config.openAiModel,
          timeoutMs: config.aiTimeoutMs
        })
      : undefined,
    fallback: new DeterministicIntentInterpreter(),
    onFallback: ({ reason, error }) => {
      app.log.warn({ reason, err: error }, 'AI intent provider unavailable; deterministic interpretation used');
    }
  });
  const propertyAssistant = createResilientPropertyAssistant({
    primary: config.aiProvider === 'openai'
      ? new OpenAIPropertyAssistant({
          apiKey: config.openAiApiKey!, model: config.openAiModel, timeoutMs: config.aiTimeoutMs
        })
      : undefined,
    fallback: new DeterministicPropertyAssistant(),
    onFallback: ({ reason, error }) => {
      app.log.warn({ reason, err: error }, 'AI property assistant unavailable; deterministic answer used');
    }
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed'), false);
    },
    credentials: true
  });
  await app.register(rateLimit, { global: true, max: config.rateLimitMax, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { iss: config.jwtIssuer, aud: config.jwtAudience, algorithm: 'HS256' },
    verify: {
      allowedIss: config.jwtIssuer,
      allowedAud: config.jwtAudience,
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'iss', 'aud', 'exp']
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    if (error.validation) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: error.message } });
    }
    return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({
      error: {
        code: error.statusCode === 429 ? 'rate_limited' : 'internal_error',
        message: error.statusCode && error.statusCode < 500 ? error.message : 'The request could not be completed'
      }
    });
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true, service: 'api' }));
  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const ready = await databaseReady();
    return reply.code(ready ? 200 : 503).send({ ok: ready, service: 'api', dependency: 'postgres' });
  });

  app.post('/v1/intents/interpret', {
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const parsed = intentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    }
    return intentInterpreter.interpret(parsed.data.intent);
  });

  app.post('/v1/auth/register', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = registerInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    const input = parsed.data;
    const password = await hashPassword(input.password);

    try {
      const user = await withTransaction(async (client) => {
        const inserted = await client.query<UserRow>(`
          INSERT INTO app_user (email, display_name)
          VALUES ($1, $2)
          RETURNING id, email, display_name, role
        `, [input.email, input.displayName ?? null]);
        const created = inserted.rows[0]!;
        await client.query(`
          INSERT INTO user_credential (user_id, password_hash, password_salt)
          VALUES ($1, $2, $3)
        `, [created.id, password.hash, password.salt]);
        await client.query('INSERT INTO notification_preference (user_id) VALUES ($1)', [created.id]);
        await client.query(`
          INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id)
          VALUES ($1, 'user.registered', 'user', $2)
        `, [created.id, created.id]);
        return created;
      });

      return reply.code(201).send({ user: publicUser(user), token: signToken(app, config, user) });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: { code: 'email_in_use', message: 'An account already exists for this email' } });
      }
      throw error;
    }
  });

  app.post('/v1/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    const result = await query<UserRow>(`
      SELECT u.id, u.email, u.display_name, u.role, c.password_hash, c.password_salt
      FROM app_user u
      JOIN user_credential c ON c.user_id = u.id
      WHERE u.email = $1
    `, [parsed.data.email]);
    const user = result.rows[0];
    const credential = await passwordCredentialOrDummy(user);
    const valid = await verifyPassword(parsed.data.password, credential.hash, credential.salt);
    if (!user || !valid) {
      return reply.code(401).send({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } });
    }
    return { user: publicUser(user), token: signToken(app, config, user) };
  });

  app.get('/v1/me', { preHandler: authenticate }, async (request, reply) => {
    const result = await query<UserRow>(`
      SELECT id, email, display_name, role FROM app_user WHERE id = $1
    `, [request.user.sub]);
    const user = result.rows[0];
    if (!user) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Account is no longer active' } });
    return { user: publicUser(user) };
  });

  app.get('/v1/opportunities', async (request, reply) => {
    const parsed = opportunityQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    const input = parsed.data;
    const locations = input.locations
      ?.split(',')
      .map((location) => normalizeAddress(location))
      .filter(Boolean) ?? [];
    if (locations.length > 5) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'At most five locations are allowed' } });
    }
    let cursor;
    try {
      cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    } catch {
      return reply.code(400).send({ error: { code: 'invalid_cursor', message: 'Pagination cursor is invalid' } });
    }

    const values: unknown[] = [];
    const predicates = ["p.status IN ('active','uncertain')"];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (input.operation) predicates.push(`p.operation = ${add(input.operation)}`);
    if (input.currency) predicates.push(`p.currency = ${add(input.currency)}`);
    if (input.minPrice !== undefined) predicates.push(`p.canonical_price >= ${add(input.minPrice)}`);
    if (input.maxPrice !== undefined) predicates.push(`p.canonical_price <= ${add(input.maxPrice)}`);
    if (input.minAreaM2 !== undefined) predicates.push(`p.area_total_m2 >= ${add(input.minAreaM2)}`);
    if (input.rooms !== undefined) predicates.push(`p.rooms >= ${add(input.rooms)}`);
    if (locations.length) {
      const patterns = locations.map((location) => `%${location}%`);
      predicates.push(`p.normalized_address LIKE ANY(${add(patterns)}::text[])`);
    }
    if (cursor) {
      const updatedAt = add(cursor.updatedAt);
      const id = add(cursor.id);
      predicates.push(`(p.updated_at < ${updatedAt}::timestamptz OR (p.updated_at = ${updatedAt}::timestamptz AND p.id < ${id}::uuid))`);
    }
    const limit = add(input.limit + 1);
    const result = await query<OpportunityRow>(`
      SELECT p.id, p.canonical_address AS address, p.operation, p.canonical_price AS price,
        p.currency, p.area_total_m2, p.bedrooms, p.rooms, p.floor, p.status,
        p.updated_at, GREATEST(p.last_verified_at, MAX(pub.last_verified_at)) AS last_verified_at,
        COUNT(pub.id) FILTER (WHERE pub.publication_status = 'active')::int AS publication_count
      FROM property p
      LEFT JOIN publication pub ON pub.property_id = p.id
      WHERE ${predicates.join(' AND ')}
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ${limit}
    `, values);
    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(opportunityDto),
      nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at.toISOString(), id: last.id }) : null
    };
  });

  app.get('/v1/opportunities/:id', async (request, reply) => {
    const parsed = opportunityParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    const propertyResult = await query<OpportunityRow>(`
      SELECT p.id, p.canonical_address AS address, p.operation, p.canonical_price AS price,
        p.currency, p.area_total_m2, p.bedrooms, p.rooms, p.floor, p.status, p.updated_at,
        GREATEST(p.last_verified_at, MAX(pub.last_verified_at)) AS last_verified_at,
        COUNT(pub.id) FILTER (WHERE pub.publication_status = 'active')::int AS publication_count
      FROM property p LEFT JOIN publication pub ON pub.property_id = p.id
      WHERE p.id = $1 GROUP BY p.id
    `, [parsed.data.id]);
    const property = propertyResult.rows[0];
    if (!property) return reply.code(404).send({ error: { code: 'not_found', message: 'Opportunity was not found' } });

    const [publications, history] = await Promise.all([
      query<PublicationRow>(`
        SELECT pub.id, pub.property_id, pub.source_listing_id, pub.source_url, pub.publisher_type,
          pub.publisher_name, pub.title, pub.description, pub.currency, pub.price,
          pub.publication_status, pub.first_seen_at, pub.last_seen_at, pub.last_verified_at,
          s.code AS source_code, s.name AS source_name
        FROM publication pub JOIN source s ON s.id = pub.source_id
        WHERE pub.property_id = $1
        ORDER BY (pub.publication_status = 'active') DESC, pub.last_verified_at DESC NULLS LAST
      `, [property.id]),
      query<{ event_type: string; event_at: Date; payload: Record<string, unknown> }>(`
        SELECT event_type, event_at, payload FROM property_event
        WHERE property_id = $1 ORDER BY event_at DESC LIMIT 100
      `, [property.id])
    ]);

    return {
      opportunity: opportunityDto(property),
      publications: publications.rows.map((publication) => publicationDtoSchema.parse({
        id: publication.id,
        propertyId: publication.property_id,
        sourceCode: publication.source_code,
        sourceName: publication.source_name,
        sourceListingId: publication.source_listing_id,
        sourceUrl: publication.source_url,
        publisherType: publication.publisher_type,
        publisherName: publication.publisher_name,
        title: publication.title,
        description: publication.description,
        currency: publication.currency,
        price: publication.price === null ? null : Number(publication.price),
        status: publication.publication_status,
        firstSeenAt: publication.first_seen_at.toISOString(),
        lastSeenAt: publication.last_seen_at.toISOString(),
        lastVerifiedAt: publication.last_verified_at?.toISOString() ?? null
      })),
      history: history.rows.map((event) => propertyHistoryEventDtoSchema.parse({
        type: event.event_type,
        occurredAt: event.event_at.toISOString(),
        payload: event.payload
      }))
    };
  });

  app.post('/v1/opportunities/:id/questions', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const params = opportunityParamsSchema.safeParse(request.params);
    const input = propertyQuestionSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', details: input.success ? undefined : input.error.flatten() } });
    }
    const propertyResult = await query<OpportunityRow>(`
      SELECT p.id, p.canonical_address AS address, p.operation, p.canonical_price AS price,
        p.currency, p.area_total_m2, p.bedrooms, p.rooms, p.floor, p.status, p.updated_at,
        GREATEST(p.last_verified_at, MAX(pub.last_verified_at)) AS last_verified_at,
        COUNT(pub.id) FILTER (WHERE pub.publication_status='active')::int AS publication_count
      FROM property p LEFT JOIN publication pub ON pub.property_id=p.id
      WHERE p.id=$1 GROUP BY p.id
    `, [params.data.id]);
    const property = propertyResult.rows[0];
    if (!property) return reply.code(404).send({ error: { code: 'not_found', message: 'Opportunity was not found' } });
    const publications = await query<PublicationRow>(`
      SELECT pub.id, pub.property_id, pub.source_listing_id, pub.source_url, pub.publisher_type,
        pub.publisher_name, pub.title, pub.description, pub.currency, pub.price,
        pub.publication_status, pub.first_seen_at, pub.last_seen_at, pub.last_verified_at,
        s.code AS source_code, s.name AS source_name
      FROM publication pub JOIN source s ON s.id=pub.source_id
      WHERE pub.property_id=$1 ORDER BY pub.last_verified_at DESC NULLS LAST
    `, [property.id]);
    const dto = opportunityDto(property);
    return propertyAssistant.answer(input.data.question, {
      id: property.id,
      address: property.address,
      price: dto.price,
      currency: dto.currency,
      areaTotalM2: dto.areaTotalM2,
      rooms: dto.rooms,
      bedrooms: dto.bedrooms ?? null,
      floor: dto.floor ?? null,
      freshness: dto.freshness ?? 'possibly_unavailable',
      publications: publications.rows.map((publication) => ({
        sourceName: publication.source_name,
        publisherType: publication.publisher_type ?? 'aggregated',
        publisherName: publication.publisher_name,
        price: publication.price === null ? null : Number(publication.price),
        currency: publication.currency,
        status: publication.publication_status,
        lastVerifiedAt: publication.last_verified_at?.toISOString() ?? null
      }))
    });
  });

  app.post('/v1/monitors', { preHandler: authenticate }, async (request, reply) => {
    const parsed = monitorInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    const input = parsed.data;
    const result = await query<MonitorRow>(`
      INSERT INTO monitor (user_id, name, intent_text, criteria, cadence, timezone, instant_exceptional, next_run_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now()) RETURNING *
    `, [request.user.sub, input.name, input.intentText, JSON.stringify(input.criteria), input.cadence, input.timezone, input.instantExceptional]);
    return reply.code(201).send(monitorDto(result.rows[0]!));
  });

  app.get('/v1/monitors', { preHandler: authenticate }, async (request) => {
    const result = await query<MonitorRow>('SELECT * FROM monitor WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [request.user.sub]);
    return { items: result.rows.map(monitorDto) };
  });

  app.patch('/v1/monitors/:id', { preHandler: authenticate }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const input = monitorUpdateSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', details: input.success ? undefined : input.error.flatten() } });
    }
    const value = input.data;
    const updated = await query<MonitorRow>(`
      UPDATE monitor SET
        name=COALESCE($3,name), intent_text=COALESCE($4,intent_text), criteria=COALESCE($5::jsonb,criteria),
        cadence=COALESCE($6,cadence), timezone=COALESCE($7,timezone),
        instant_exceptional=COALESCE($8,instant_exceptional), enabled=COALESCE($9,enabled),
        next_run_at=CASE WHEN $9::boolean = true AND enabled = false THEN now() ELSE next_run_at END,
        lease_until=CASE WHEN $9::boolean = false THEN NULL ELSE lease_until END
      WHERE id=$1 AND user_id=$2
      RETURNING *
    `, [
      params.data.id,
      request.user.sub,
      value.name ?? null,
      value.intentText ?? null,
      value.criteria === undefined ? null : JSON.stringify(value.criteria),
      value.cadence ?? null,
      value.timezone ?? null,
      value.instantExceptional ?? null,
      value.enabled ?? null
    ]);
    if (!updated.rows[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'Monitor was not found' } });
    return monitorDto(updated.rows[0]);
  });

  app.get('/v1/alerts', { preHandler: authenticate }, async (request) => {
    const result = await query<AlertRow>('SELECT * FROM alert WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [request.user.sub]);
    return { items: result.rows.map(alertDto) };
  });

  app.put('/v1/alerts/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: 'invalid_request' } });
    const updated = await query(`
      UPDATE alert SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id
    `, [params.data.id, request.user.sub]);
    if (!updated.rowCount) return reply.code(404).send({ error: { code: 'not_found', message: 'Alert was not found' } });
    return reply.code(204).send();
  });

  app.get('/v1/saved', { preHandler: authenticate }, async (request) => {
    const result = await query<OpportunityRow & { note: string | null; visit_status: string; saved_at: Date }>(`
      SELECT p.id, p.canonical_address AS address, p.operation, p.canonical_price AS price,
        p.currency, p.area_total_m2, p.bedrooms, p.rooms, p.floor, p.status, p.updated_at,
        GREATEST(p.last_verified_at, MAX(pub.last_verified_at)) AS last_verified_at,
        COUNT(pub.id) FILTER (WHERE pub.publication_status = 'active')::int AS publication_count,
        sp.note, sp.visit_status, sp.created_at AS saved_at
      FROM saved_property sp
      JOIN property p ON p.id = sp.property_id
      LEFT JOIN publication pub ON pub.property_id = p.id
      WHERE sp.user_id = $1
      GROUP BY p.id, sp.user_id, sp.property_id
      ORDER BY sp.created_at DESC
    `, [request.user.sub]);
    return {
      items: result.rows.map((row) => ({
        ...opportunityDto(row),
        note: row.note,
        visitStatus: row.visit_status,
        savedAt: row.saved_at.toISOString()
      }))
    };
  });

  app.post('/v1/publications', { preHandler: authenticate }, async (request, reply) => {
    const parsed = directPublicationInputSchema.safeParse(request.body);
    const idempotencyKey = request.headers['idempotency-key'];
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', details: parsed.error.flatten() } });
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return reply.code(400).send({
        error: { code: 'invalid_idempotency_key', message: 'Idempotency-Key must contain 8 to 200 characters' }
      });
    }
    const user = await query<{ display_name: string | null; role: Principal['role']; operator_id: string | null; operator_name: string | null; verification_status: string | null }>(
      `SELECT u.display_name, u.role, op.id AS operator_id, op.display_name AS operator_name, op.verification_status
       FROM app_user u LEFT JOIN operator_profile op ON op.user_id=u.id WHERE u.id = $1`,
      [request.user.sub]
    );
    const publisherType = user.rows[0]?.role === 'operator' && user.rows[0]?.verification_status === 'verified' ? 'operator' : 'owner';
    try {
      const result = await withTransaction((client) => createDirectPublication(client, {
        userId: request.user.sub,
        displayName: publisherType === 'operator'
          ? user.rows[0]?.operator_name ?? user.rows[0]?.display_name ?? null
          : user.rows[0]?.display_name ?? null,
        publisherType,
        operatorProfileId: publisherType === 'operator' ? user.rows[0]?.operator_id ?? undefined : undefined,
        idempotencyKey,
        publicWebUrl: config.publicWebUrl,
        input: parsed.data
      }));
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: { code: 'idempotency_conflict', message: error.message } });
      }
      throw error;
    }
  });

  app.put('/v1/opportunities/:id/saved', { preHandler: authenticate }, async (request, reply) => {
    const parsed = opportunityParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request' } });
    const exists = await withTransaction(async (client) => {
      const saved = await client.query(`
        INSERT INTO saved_property (user_id, property_id)
        SELECT $1, p.id FROM property p WHERE p.id = $2
        ON CONFLICT (user_id, property_id) DO UPDATE SET updated_at = now()
        RETURNING property_id
      `, [request.user.sub, parsed.data.id]);
      if (!saved.rowCount) return false;
      await client.query('DELETE FROM property_dismissal WHERE user_id = $1 AND property_id = $2', [request.user.sub, parsed.data.id]);
      await client.query(`
        INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id)
        VALUES ($1,'property.saved','property',$2)
      `, [request.user.sub, parsed.data.id]);
      return true;
    });
    if (!exists) return reply.code(404).send({ error: { code: 'not_found', message: 'Opportunity was not found' } });
    return reply.code(204).send();
  });

  app.delete('/v1/opportunities/:id/saved', { preHandler: authenticate }, async (request, reply) => {
    const parsed = opportunityParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'invalid_request' } });
    await query('DELETE FROM saved_property WHERE user_id = $1 AND property_id = $2', [request.user.sub, parsed.data.id]);
    return reply.code(204).send();
  });

  app.put('/v1/opportunities/:id/dismissed', { preHandler: authenticate }, async (request, reply) => {
    const params = opportunityParamsSchema.safeParse(request.params);
    const input = dismissalInputSchema.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: { code: 'invalid_request' } });
    const exists = await withTransaction(async (client) => {
      const dismissed = await client.query(`
        INSERT INTO property_dismissal (user_id, property_id, reason, note)
        SELECT $1, p.id, $3, $4 FROM property p WHERE p.id = $2
        ON CONFLICT (user_id, property_id) DO UPDATE SET reason = excluded.reason, note = excluded.note, created_at = now()
        RETURNING property_id
      `, [request.user.sub, params.data.id, input.data.reason, input.data.note ?? null]);
      if (!dismissed.rowCount) return false;
      await client.query('DELETE FROM saved_property WHERE user_id = $1 AND property_id = $2', [request.user.sub, params.data.id]);
      await client.query(`
        INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id, metadata)
        VALUES ($1,'property.dismissed','property',$2,$3::jsonb)
      `, [request.user.sub, params.data.id, JSON.stringify({ reason: input.data.reason })]);
      return true;
    });
    if (!exists) return reply.code(404).send({ error: { code: 'not_found', message: 'Opportunity was not found' } });
    return reply.code(204).send();
  });

  await registerOperatorRoutes(app, config);

  return app;
}
