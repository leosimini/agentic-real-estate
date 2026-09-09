import {
  basicMatchScore,
  evaluateHardConstraints,
  searchCriteriaSchema,
  type Opportunity,
  type SearchCriteria
} from '@realty/core';
import { query, withTransaction, type DatabaseClient } from '@realty/db';
import { normalizeAddress } from '@realty/ingestion';
import {
  buildMonitorDigest,
  createDeliveryIdempotencyKey,
  detectMonitorChanges,
  type AvailabilityState,
  type MonitorCandidateSnapshot,
  type MonitorDigest,
  type MonitorSnapshot
} from '@realty/monitoring';

type MonitorRow = {
  id: string;
  user_id: string;
  name: string;
  criteria: unknown;
  cadence: 'hourly' | 'daily' | 'weekly';
  enabled: boolean;
};

type CandidateRow = {
  id: string;
  address: string | null;
  operation: Opportunity['operation'];
  price: string | number | null;
  currency: string | null;
  area_total_m2: string | number | null;
  bedrooms: number | null;
  rooms: number | null;
  floor: string | null;
  last_verified_at: Date | string | null;
  status: AvailabilityState;
  publication_count: number;
  active_source_ids: string[] | null;
};

type MatchRow = {
  property_id: string;
  last_state: unknown;
};

export type LeasedMonitor = Readonly<{
  monitorId: string;
  scheduledFor: string;
}>;

export type MonitorRunResult = Readonly<{
  status: 'completed' | 'already_completed' | 'disabled';
  candidatesCount: number;
  meaningfulChangesCount: number;
  alertId: string | null;
}>;

const cadenceInterval: Record<MonitorRow['cadence'], string> = {
  hourly: '1 hour',
  daily: '1 day',
  weekly: '7 days'
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function finiteNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCandidateState(value: unknown): MonitorCandidateSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MonitorCandidateSnapshot>;
  if (
    typeof candidate.propertyId !== 'string' ||
    typeof candidate.score !== 'number' ||
    !Array.isArray(candidate.activeSourceIds) ||
    typeof candidate.availability !== 'string'
  ) return null;
  return candidate as MonitorCandidateSnapshot;
}

function toOpportunity(row: CandidateRow): Opportunity {
  return {
    id: row.id,
    title: row.address ?? 'Oportunidad inmobiliaria',
    address: row.address,
    operation: row.operation,
    price: finiteNumber(row.price),
    currency: row.currency,
    areaTotalM2: finiteNumber(row.area_total_m2),
    bedrooms: row.bedrooms,
    rooms: row.rooms,
    floor: row.floor,
    publicationCount: row.publication_count,
    lastVerifiedAt: row.last_verified_at ? iso(row.last_verified_at) : null
  };
}

function toSnapshot(row: CandidateRow, criteria: SearchCriteria): MonitorCandidateSnapshot | null {
  const opportunity = toOpportunity(row);
  const hardConstraints = evaluateHardConstraints(criteria, opportunity);
  if (!hardConstraints.matches) return null;
  return {
    propertyId: row.id,
    score: basicMatchScore(criteria, opportunity),
    price: opportunity.price === null || opportunity.currency === null
      ? null
      : { amount: opportunity.price, currency: opportunity.currency },
    availability: row.status,
    activeSourceIds: row.active_source_ids ?? []
  };
}

function digestCopy(digest: MonitorDigest): { title: string; body: string } {
  const labels: Record<string, string> = {
    new_matches: 'nuevas coincidencias',
    price_drops: 'bajas de precio',
    availability_changes: 'cambios de disponibilidad',
    source_changes: 'cambios de publicaciones',
    score_changes: 'cambios de afinidad',
    removed_matches: 'oportunidades que dejaron de coincidir'
  };
  const total = digest.groups.reduce((sum, group) => sum + group.events.length, 0);
  const details = digest.groups.map((group) => `${group.events.length} ${labels[group.kind]}`).join(', ');
  return {
    title: `${total} ${total === 1 ? 'cambio relevante' : 'cambios relevantes'}`,
    body: `Tu monitor encontró ${details}.`
  };
}

export async function leaseDueMonitors(limit = 200): Promise<LeasedMonitor[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid monitor lease limit');
  return withTransaction(async (client) => {
    const leased = await client.query<{ id: string; scheduled_for: Date | string }>(`
      WITH due AS (
        SELECT id, COALESCE(next_run_at, date_trunc('minute', now())) AS scheduled_for
        FROM monitor
        WHERE enabled = true
          AND (next_run_at IS NULL OR next_run_at <= now())
          AND (lease_until IS NULL OR lease_until < now())
        ORDER BY next_run_at NULLS FIRST, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE monitor AS monitor
      SET lease_until = now() + interval '10 minutes'
      FROM due
      WHERE monitor.id = due.id
      RETURNING monitor.id, due.scheduled_for
    `, [limit]);
    return leased.rows.map((row) => ({ monitorId: row.id, scheduledFor: iso(row.scheduled_for) }));
  });
}

async function beginRun(monitorId: string, scheduledFor: string): Promise<string | null> {
  const idempotencyKey = `monitor:${monitorId}:${scheduledFor}`;
  const result = await query<{ id: string }>(`
    INSERT INTO monitor_run (monitor_id, scheduled_for, idempotency_key)
    VALUES ($1, $2, $3)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET started_at = now(), completed_at = NULL, status = 'running', error = NULL
    WHERE monitor_run.status <> 'completed'
    RETURNING id
  `, [monitorId, scheduledFor, idempotencyKey]);
  return result.rows[0]?.id ?? null;
}

async function failRun(runId: string, monitorId: string, error: unknown): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE monitor_run SET completed_at=now(), status='failed', error=$2 WHERE id=$1`,
      [runId, String(error)]
    );
    await client.query(`UPDATE monitor SET lease_until=NULL WHERE id=$1`, [monitorId]);
  });
}

async function persistCompletedRun(
  client: DatabaseClient,
  monitor: MonitorRow,
  runId: string,
  scheduledFor: string,
  current: MonitorSnapshot,
  previousIds: readonly string[],
  digest: MonitorDigest | null
): Promise<string | null> {
  const currentIds = current.candidates.map((candidate) => candidate.propertyId);
  for (const candidate of current.candidates) {
    await client.query(`
      INSERT INTO monitor_match (
        monitor_id, property_id, score, reasons, active, last_state, last_changed_at, last_matched_at
      ) VALUES ($1,$2,$3,$4::jsonb,true,$5::jsonb,now(),now())
      ON CONFLICT (monitor_id, property_id) DO UPDATE SET
        score=excluded.score,
        reasons=excluded.reasons,
        active=true,
        last_state=excluded.last_state,
        last_changed_at=CASE
          WHEN monitor_match.last_state IS DISTINCT FROM excluded.last_state THEN now()
          ELSE monitor_match.last_changed_at
        END,
        last_matched_at=now()
    `, [
      monitor.id,
      candidate.propertyId,
      candidate.score,
      JSON.stringify(['Cumple todas las condiciones obligatorias']),
      JSON.stringify(candidate)
    ]);
  }

  const removedIds = previousIds.filter((id) => !currentIds.includes(id));
  if (removedIds.length) {
    await client.query(`
      UPDATE monitor_match
      SET active=false, last_changed_at=now()
      WHERE monitor_id=$1 AND property_id = ANY($2::uuid[])
    `, [monitor.id, removedIds]);
  }

  let alertId: string | null = null;
  if (digest) {
    const preference = await client.query<{ digest_enabled: boolean }>(`
      SELECT digest_enabled FROM notification_preference WHERE user_id=$1
    `, [monitor.user_id]);
    if (preference.rows[0]?.digest_enabled === false) {
      alertId = null;
    } else {
      const copy = digestCopy(digest);
      const alert = await client.query<{ id: string }>(`
        INSERT INTO alert (user_id, monitor_id, type, title, body, payload, idempotency_key)
        VALUES ($1,$2,'monitor_digest',$3,$4,$5::jsonb,$6)
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
        DO UPDATE SET idempotency_key=excluded.idempotency_key
        RETURNING id
      `, [monitor.user_id, monitor.id, copy.title, copy.body, JSON.stringify(digest), digest.alertKey]);
      alertId = alert.rows[0]!.id;
      const deliveryKey = createDeliveryIdempotencyKey(digest.alertKey, 'in_app');
      await client.query(`
        INSERT INTO notification_delivery (alert_id, channel, status, idempotency_key)
        SELECT $1,'in_app','pending',$2
        FROM notification_preference
        WHERE user_id=$3 AND in_app_enabled=true
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `, [alertId, deliveryKey, monitor.user_id]);
      const emailDeliveryKey = createDeliveryIdempotencyKey(digest.alertKey, 'email');
      await client.query(`
        INSERT INTO notification_delivery (alert_id, channel, destination, status, idempotency_key)
        SELECT $1, 'email', app_user.email, 'pending', $2
        FROM app_user
        JOIN notification_preference preference ON preference.user_id=app_user.id
        WHERE app_user.id=$3 AND app_user.email_verified_at IS NOT NULL
          AND preference.email_enabled=true
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `, [alertId, emailDeliveryKey, monitor.user_id]);
    }
  }

  const meaningfulChangesCount = digest?.eventKeys.length ?? 0;
  await client.query(`
    UPDATE monitor_run
    SET completed_at=now(), status='completed', candidates_count=$2,
        meaningful_changes_count=$3, summary=$4::jsonb
    WHERE id=$1
  `, [runId, current.candidates.length, meaningfulChangesCount, JSON.stringify({ digest })]);
  await client.query(`
    UPDATE monitor
    SET last_run_at=now(), next_run_at=GREATEST($2::timestamptz, now()) + $3::interval,
        lease_until=NULL
    WHERE id=$1
  `, [monitor.id, scheduledFor, cadenceInterval[monitor.cadence]]);
  return alertId;
}

export async function runMonitor(monitorId: string, scheduledFor: string): Promise<MonitorRunResult> {
  const runId = await beginRun(monitorId, scheduledFor);
  if (!runId) {
    return { status: 'already_completed', candidatesCount: 0, meaningfulChangesCount: 0, alertId: null };
  }

  try {
    const monitorResult = await query<MonitorRow>(`SELECT * FROM monitor WHERE id=$1`, [monitorId]);
    const monitor = monitorResult.rows[0];
    if (!monitor?.enabled) {
      await withTransaction(async (client) => {
        await client.query(`UPDATE monitor_run SET completed_at=now(), status='completed' WHERE id=$1`, [runId]);
        await client.query(`UPDATE monitor SET lease_until=NULL WHERE id=$1`, [monitorId]);
      });
      return { status: 'disabled', candidatesCount: 0, meaningfulChangesCount: 0, alertId: null };
    }
    const criteria = searchCriteriaSchema.parse(monitor.criteria);
    const observedAt = new Date().toISOString();
    const normalizedLocations = (criteria.locations ?? []).map(normalizeAddress).filter(Boolean);
    const candidateLimit = Number(process.env.MONITOR_CANDIDATE_LIMIT ?? 5_000);
    if (!Number.isInteger(candidateLimit) || candidateLimit < 100 || candidateLimit > 20_000) {
      throw new Error('MONITOR_CANDIDATE_LIMIT must be an integer between 100 and 20000');
    }
    const candidatesResult = await query<CandidateRow>(`
      SELECT p.id, p.canonical_address AS address, p.operation,
             p.canonical_price AS price, p.currency, p.area_total_m2, p.bedrooms,
             p.rooms, p.floor, p.last_verified_at, p.status,
             COUNT(pub.id)::int AS publication_count,
             COALESCE(array_agg(DISTINCT s.code) FILTER (WHERE s.code IS NOT NULL), '{}') AS active_source_ids
      FROM property p
      LEFT JOIN publication pub
        ON pub.property_id=p.id AND pub.publication_status='active'
      LEFT JOIN source s ON s.id=pub.source_id
      WHERE p.status IN ('active','uncertain')
        AND ($1::text IS NULL OR p.operation=$1)
        AND ($2::text IS NULL OR upper(p.currency)=upper($2))
        AND ($3::numeric IS NULL OR p.canonical_price >= $3)
        AND ($4::numeric IS NULL OR p.canonical_price <= $4)
        AND ($5::numeric IS NULL OR p.area_total_m2 >= $5)
        AND ($6::integer IS NULL OR p.bedrooms >= $6)
        AND ($7::integer IS NULL OR p.rooms >= $7)
        AND (
          cardinality($8::text[]) = 0
          OR EXISTS (
            SELECT 1 FROM unnest($8::text[]) location
            WHERE strpos(p.normalized_address, location) > 0
          )
        )
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT $9
    `, [
      criteria.operation ?? null,
      criteria.currency ?? null,
      criteria.minPrice ?? null,
      criteria.maxPrice ?? null,
      criteria.minAreaM2 ?? null,
      criteria.bedrooms ?? null,
      criteria.rooms ?? null,
      normalizedLocations,
      candidateLimit + 1
    ]);
    if (candidatesResult.rows.length > candidateLimit) {
      throw new Error(`Monitor candidate limit exceeded (${candidateLimit}); narrow criteria or raise MONITOR_CANDIDATE_LIMIT`);
    }
    const currentCandidates = candidatesResult.rows
      .map((row) => toSnapshot(row, criteria))
      .filter((candidate): candidate is MonitorCandidateSnapshot => candidate !== null);

    const previousResult = await query<MatchRow>(`
      SELECT property_id, last_state
      FROM monitor_match
      WHERE monitor_id=$1 AND active=true
    `, [monitorId]);
    const previousCandidates = previousResult.rows
      .map((row) => parseCandidateState(row.last_state))
      .filter((candidate): candidate is MonitorCandidateSnapshot => candidate !== null);
    const previous: MonitorSnapshot | null = previousCandidates.length
      ? { monitorId, observationKey: 'previous', observedAt, candidates: previousCandidates }
      : null;
    const current: MonitorSnapshot = {
      monitorId,
      observationKey: scheduledFor,
      observedAt,
      candidates: currentCandidates
    };
    const events = detectMonitorChanges(previous, current);
    const dismissed = await query<{ property_id: string }>(`
      SELECT property_id FROM property_dismissal WHERE user_id=$1
      UNION
      SELECT property_id FROM monitor_match WHERE monitor_id=$2 AND dismissed=true
    `, [monitor.user_id, monitorId]);
    const digest = buildMonitorDigest(monitorId, scheduledFor, events, {
      suppressedPropertyIds: dismissed.rows.map((row) => row.property_id),
      maxEventsPerGroup: 20
    });

    const alertId = await withTransaction((client) => persistCompletedRun(
      client,
      monitor,
      runId,
      scheduledFor,
      current,
      previousResult.rows.map((row) => row.property_id),
      digest
    ));
    return {
      status: 'completed',
      candidatesCount: currentCandidates.length,
      meaningfulChangesCount: digest?.eventKeys.length ?? 0,
      alertId
    };
  } catch (error) {
    await failRun(runId, monitorId, error);
    throw error;
  }
}

export async function deliverPendingInApp(limit = 100): Promise<number> {
  return withTransaction(async (client) => {
    const deliveries = await client.query<{ id: string }>(`
      SELECT id FROM notification_delivery
      WHERE channel='in_app' AND status IN ('pending','failed')
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    `, [limit]);
    if (!deliveries.rows.length) return 0;
    await client.query(`
      UPDATE notification_delivery
      SET status='sent', attempt_count=attempt_count+1, sent_at=now(), last_error=NULL
      WHERE id = ANY($1::uuid[])
    `, [deliveries.rows.map((row) => row.id)]);
    return deliveries.rows.length;
  });
}
