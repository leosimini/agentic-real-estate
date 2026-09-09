import { createAccountToken, type AccountTokenPurpose } from '@realty/core';
import { query, withTransaction } from '@realty/db';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

export interface EmailAdapter {
  send(message: EmailMessage): Promise<{ messageId?: string }>;
}

export class WebhookEmailAdapter implements EmailAdapter {
  constructor(
    private readonly url: string,
    private readonly bearerToken?: string,
    private readonly request: typeof fetch = fetch
  ) {}

  async send(message: EmailMessage): Promise<{ messageId?: string }> {
    const response = await this.request(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
        ...(this.bearerToken ? { authorization: `Bearer ${this.bearerToken}` } : {})
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
    const body = await response.json().catch(() => ({})) as { messageId?: unknown; id?: unknown };
    const candidate = typeof body.messageId === 'string' ? body.messageId : typeof body.id === 'string' ? body.id : undefined;
    return candidate ? { messageId: candidate } : {};
  }
}

type DeliveryRow = {
  id: string;
  destination: string;
  attempt_count: number;
  max_attempts: number;
  idempotency_key: string;
  alert_type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
};

export type DeliveryConfig = {
  publicWebUrl: string;
  accountTokenSecret: string;
};

class UnusableAccountTokenError extends Error {}

async function leaseEmailDeliveries(limit: number, alertIds?: string[]): Promise<DeliveryRow[]> {
  return withTransaction(async (client) => {
    const result = await client.query<DeliveryRow>(`
      WITH due AS (
        SELECT delivery.id
        FROM notification_delivery delivery
        WHERE delivery.channel='email'
          AND ($2::uuid[] IS NULL OR delivery.alert_id=ANY($2::uuid[]))
          AND delivery.attempt_count < delivery.max_attempts
          AND (
            (delivery.status IN ('pending','failed') AND delivery.next_attempt_at <= now())
            OR (delivery.status='processing' AND delivery.lease_until < now())
          )
        ORDER BY delivery.next_attempt_at, delivery.created_at, delivery.id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      ), leased AS (
        UPDATE notification_delivery delivery
        SET status='processing', attempt_count=attempt_count+1,
            last_attempt_at=now(), lease_until=now() + interval '5 minutes', updated_at=now()
        FROM due
        WHERE delivery.id=due.id
        RETURNING delivery.*
      )
      SELECT leased.id, leased.destination, leased.attempt_count, leased.max_attempts,
             leased.idempotency_key, alert.type AS alert_type, alert.title, alert.body, alert.payload
      FROM leased
      JOIN alert ON alert.id=leased.alert_id
    `, [limit, alertIds ?? null]);
    return result.rows;
  });
}

async function renderEmail(delivery: DeliveryRow, config: DeliveryConfig): Promise<EmailMessage> {
  let text = delivery.body;
  const tokenId = delivery.payload.accountTokenId;
  const purpose = delivery.payload.purpose;
  if (typeof tokenId === 'string' && (purpose === 'verify_email' || purpose === 'reset_password')) {
    const token = await query<{ id: string; user_id: string; purpose: AccountTokenPurpose }>(`
      SELECT id, user_id, purpose FROM account_token
      WHERE id=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at > now()
    `, [tokenId, purpose]);
    const row = token.rows[0];
    if (!row) throw new UnusableAccountTokenError('Account token is no longer usable');
    const value = createAccountToken({ id: row.id, userId: row.user_id, purpose: row.purpose }, config.accountTokenSecret);
    const parameter = purpose === 'verify_email' ? 'verify_email' : 'reset_password';
    text = `${delivery.body}\n\n${config.publicWebUrl}/?${parameter}=${encodeURIComponent(value)}`;
  } else if (delivery.alert_type === 'monitor_digest') {
    text = `${delivery.body}\n\nAbrí Umbral: ${config.publicWebUrl}`;
  }
  return {
    to: delivery.destination,
    subject: delivery.title,
    text,
    idempotencyKey: delivery.idempotency_key
  };
}

async function markSent(id: string, messageId?: string) {
  await query(`
    UPDATE notification_delivery
    SET status='sent', provider_message_id=$2, sent_at=now(), lease_until=NULL,
        last_error=NULL, updated_at=now()
    WHERE id=$1 AND status='processing'
  `, [id, messageId ?? null]);
}

async function markFailed(delivery: DeliveryRow, error: unknown) {
  const terminal = delivery.attempt_count >= delivery.max_attempts;
  const retrySeconds = Math.min(3600, 60 * (2 ** Math.max(0, delivery.attempt_count - 1)));
  await query(`
    UPDATE notification_delivery
    SET status=$2, last_error=$3, lease_until=NULL,
        next_attempt_at=CASE WHEN $2='dead' THEN next_attempt_at ELSE now() + ($4 || ' seconds')::interval END,
        updated_at=now()
    WHERE id=$1 AND status='processing'
  `, [delivery.id, terminal ? 'dead' : 'failed', String(error).slice(0, 2000), retrySeconds]);
}

async function markSkipped(id: string, reason: string) {
  await query(`
    UPDATE notification_delivery
    SET status='skipped', last_error=$2, lease_until=NULL, updated_at=now()
    WHERE id=$1 AND status='processing'
  `, [id, reason.slice(0, 2000)]);
}

export async function deliverPendingEmails(
  adapter: EmailAdapter,
  config: DeliveryConfig,
  limit = 25,
  alertIds?: string[]
): Promise<{ sent: number; failed: number; dead: number; skipped: number }> {
  const deliveries = await leaseEmailDeliveries(limit, alertIds);
  const summary = { sent: 0, failed: 0, dead: 0, skipped: 0 };
  for (const delivery of deliveries) {
    try {
      const message = await renderEmail(delivery, config);
      const result = await adapter.send(message);
      await markSent(delivery.id, result.messageId);
      summary.sent += 1;
    } catch (error) {
      if (error instanceof UnusableAccountTokenError) {
        await markSkipped(delivery.id, error.message);
        summary.skipped += 1;
        continue;
      }
      await markFailed(delivery, error);
      if (delivery.attempt_count >= delivery.max_attempts) summary.dead += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
