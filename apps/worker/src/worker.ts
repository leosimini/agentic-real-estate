import { PgBoss } from 'pg-boss';
import { query } from '@realty/db';
import { basicMatchScore, type SearchCriteria, type Opportunity } from '@realty/core';
import { monitorAgent } from './agent.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const boss = new PgBoss({ connectionString, useListenNotify: true });
boss.on('error', (error) => console.error('[pg-boss]', error));
await boss.start();

const queues = ['monitor-scan-due', 'monitor-run', 'notification-send'];
for (const name of queues) {
  await boss.createQueue(name, { retryLimit: 5, retryDelay: 15, retryBackoff: true, notify: true });
}

await boss.schedule('monitor-scan-due', '* * * * *', {}, { tz: 'UTC' });

await boss.work('monitor-scan-due', { batchSize: 1 }, async () => {
  const due = await query<{id: string}>(`
    SELECT id FROM monitor
    WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= now())
    ORDER BY next_run_at NULLS FIRST
    LIMIT 200
  `);
  for (const row of due.rows) {
    await boss.send('monitor-run', { monitorId: row.id }, { singletonKey: row.id, singletonSeconds: 50 });
  }
});

await boss.work('monitor-run', { batchSize: Number(process.env.WORKER_CONCURRENCY ?? 5) }, async (jobs) => {
  for (const job of jobs) {
    const monitorId = (job.data as any).monitorId as string;
    const m = await query<any>(`SELECT * FROM monitor WHERE id=$1 AND enabled=true`, [monitorId]);
    const monitor = m.rows[0];
    if (!monitor) continue;

    const run = await query<{id: string}>(`
      INSERT INTO monitor_run (monitor_id) VALUES ($1) RETURNING id
    `, [monitorId]);
    const runId = run.rows[0]!.id;

    try {
      const rows = await query<any>(`
        SELECT p.id, p.canonical_address AS address, p.operation, p.canonical_price AS price,
               p.currency, p.area_total_m2, p.rooms, p.last_verified_at,
               COUNT(pub.id)::int AS publication_count
        FROM property p
        LEFT JOIN publication pub ON pub.property_id=p.id AND pub.publication_status='active'
        WHERE p.status IN ('active','uncertain')
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 500
      `);

      const criteria = monitor.criteria as SearchCriteria;
      const candidates = rows.rows.map((r: any) => {
        const item: Opportunity = {
          id: r.id,
          title: r.address ?? 'Property opportunity',
          address: r.address,
          operation: r.operation,
          price: r.price == null ? null : Number(r.price),
          currency: r.currency,
          areaTotalM2: r.area_total_m2 == null ? null : Number(r.area_total_m2),
          rooms: r.rooms,
          publicationCount: r.publication_count,
          lastVerifiedAt: r.last_verified_at
        };
        return { ...item, score: basicMatchScore(criteria, item), isNew: true };
      }).filter((x: any) => x.score >= 80);

      for (const c of candidates) {
        await query(`
          INSERT INTO monitor_match (monitor_id, property_id, score, reasons, last_matched_at)
          VALUES ($1,$2,$3,$4::jsonb,now())
          ON CONFLICT (monitor_id, property_id)
          DO UPDATE SET score=excluded.score, reasons=excluded.reasons, last_matched_at=now()
        `, [monitorId, c.id, c.score, JSON.stringify(['Matches structured MVP criteria'])]);
      }

      const agentResult: any = await monitorAgent.invoke({ monitor, candidates });
      const alert = agentResult.alert;
      if (alert) {
        const created = await query<{id: string}>(`
          INSERT INTO alert (user_id, monitor_id, type, title, body, payload)
          VALUES ($1,$2,'monitor_digest',$3,$4,$5::jsonb) RETURNING id
        `, [monitor.user_id, monitorId, alert.title, alert.body, JSON.stringify(alert.payload)]);
        await boss.send('notification-send', { alertId: created.rows[0]!.id, channel: 'in_app' });
      }

      const interval = monitor.cadence === 'hourly' ? '1 hour' : monitor.cadence === 'weekly' ? '7 days' : '1 day';
      await query(`
        UPDATE monitor
        SET last_run_at=now(), next_run_at=now() + $2::interval
        WHERE id=$1
      `, [monitorId, interval]);
      await query(`
        UPDATE monitor_run SET completed_at=now(), status='completed', candidates_count=$2,
          meaningful_changes_count=$3, summary=$4::jsonb WHERE id=$1
      `, [runId, rows.rowCount ?? rows.rows.length, candidates.length, JSON.stringify({ alert: alert ?? null })]);
    } catch (error) {
      await query(`UPDATE monitor_run SET completed_at=now(), status='failed', error=$2 WHERE id=$1`, [runId, String(error)]);
      throw error;
    }
  }
});

await boss.work('notification-send', async (jobs) => {
  for (const job of jobs) {
    const { alertId, channel } = job.data as any;
    await query(`
      INSERT INTO notification_delivery (alert_id, channel, status, attempt_count, sent_at)
      VALUES ($1,$2,'sent',1,now())
    `, [alertId, channel]);
    console.log(`[notification] ${channel} delivered for alert ${alertId}`);
  }
});

console.log('worker started');
