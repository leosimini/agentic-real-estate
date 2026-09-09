import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDatabase, query } from '@realty/db';
import { deliverPendingInApp, runMonitor } from '../src/monitor-runner.js';

const databaseUrl = process.env.DATABASE_URL;

describe('monitor execution', { skip: !databaseUrl }, () => {
  let userId: string;
  let propertyId: string;
  let monitorId: string;
  let location: string;

  before(async () => {
    const suffix = crypto.randomUUID();
    location = `monitor-zone-${suffix}`;
    const user = await query<{ id: string }>(`
      INSERT INTO app_user (email, display_name)
      VALUES ($1, 'Monitor test') RETURNING id
    `, [`monitor-${suffix}@example.test`]);
    userId = user.rows[0]!.id;
    const property = await query<{ id: string }>(`
      INSERT INTO property (
        canonical_address, normalized_address, operation, currency,
        canonical_price, rooms, area_total_m2, status, last_verified_at
      ) VALUES ($1, $2,
        'sale', 'USD', 180000, 3, 72, 'active', now())
      RETURNING id
    `, [`Thames 1800, ${location}`, `thames 1800 ${location}`]);
    propertyId = property.rows[0]!.id;
    const monitor = await query<{ id: string }>(`
      INSERT INTO monitor (user_id, name, intent_text, criteria, cadence, next_run_at)
      VALUES ($1, 'Palermo', 'Comprar en Palermo', $2::jsonb, 'daily', now())
      RETURNING id
    `, [userId, JSON.stringify({ operation: 'sale', locations: [location], currency: 'USD', maxPrice: 200000 })]);
    monitorId = monitor.rows[0]!.id;
  });

  after(async () => {
    if (userId) await query(`DELETE FROM app_user WHERE id=$1`, [userId]);
    if (propertyId) await query(`DELETE FROM property WHERE id=$1`, [propertyId]);
    await closeDatabase();
  });

  it('does not notify twice for an unchanged match and detects a later price drop', async () => {
    const firstSchedule = '2026-09-09T12:00:00.000Z';
    const first = await runMonitor(monitorId, firstSchedule);
    assert.equal(first.status, 'completed');
    assert.equal(first.meaningfulChangesCount, 1);
    assert.ok(first.alertId);

    const retry = await runMonitor(monitorId, firstSchedule);
    assert.equal(retry.status, 'already_completed');

    const unchanged = await runMonitor(monitorId, '2026-09-10T12:00:00.000Z');
    assert.equal(unchanged.meaningfulChangesCount, 0);
    assert.equal(unchanged.alertId, null);

    const alertCount = await query<{ count: string }>(`SELECT count(*)::text AS count FROM alert WHERE monitor_id=$1`, [monitorId]);
    assert.equal(Number(alertCount.rows[0]!.count), 1);

    await query(`UPDATE property SET canonical_price=165000 WHERE id=$1`, [propertyId]);
    const changed = await runMonitor(monitorId, '2026-09-11T12:00:00.000Z');
    assert.equal(changed.meaningfulChangesCount, 1);
    assert.ok(changed.alertId);

    assert.equal(await deliverPendingInApp(), 2);
    assert.equal(await deliverPendingInApp(), 0);
    const deliveries = await query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM notification_delivery delivery
      JOIN alert ON alert.id=delivery.alert_id
      WHERE alert.monitor_id=$1 AND delivery.status='sent'
    `, [monitorId]);
    assert.equal(Number(deliveries.rows[0]!.count), 2);
  });
});
