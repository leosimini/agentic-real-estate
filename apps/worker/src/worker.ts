import { PgBoss } from 'pg-boss';
import { closeDatabase } from '@realty/db';
import { deliverPendingInApp, leaseDueMonitors, runMonitor } from './monitor-runner.js';
import { deliverPendingEmails, WebhookEmailAdapter } from './delivery.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const emailProvider = process.env.EMAIL_PROVIDER ?? 'disabled';
if (!['disabled', 'webhook'].includes(emailProvider)) throw new Error('EMAIL_PROVIDER must be disabled or webhook');
const emailAdapter = emailProvider === 'webhook'
  ? new WebhookEmailAdapter(
      process.env.EMAIL_WEBHOOK_URL ?? (() => { throw new Error('EMAIL_WEBHOOK_URL is required'); })(),
      process.env.EMAIL_WEBHOOK_BEARER_TOKEN
    )
  : null;
const deliveryConfig = {
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  accountTokenSecret: process.env.ACCOUNT_TOKEN_SECRET
    ?? (() => { if (emailAdapter) throw new Error('ACCOUNT_TOKEN_SECRET is required'); return 'email-disabled'; })()
};

const boss = new PgBoss({ connectionString, useListenNotify: true });
boss.on('error', (error) => console.error(JSON.stringify({ level: 'error', service: 'worker', event: 'queue_error', error: String(error) })));
await boss.start();

const queues = ['monitor-scan-due', 'monitor-run', 'notification-scan-pending'];
for (const name of queues) {
  await boss.createQueue(name, { retryLimit: 5, retryDelay: 15, retryBackoff: true, notify: true });
}

await boss.schedule('monitor-scan-due', '* * * * *', {}, { tz: 'UTC' });
await boss.schedule('notification-scan-pending', '* * * * *', {}, { tz: 'UTC' });

await boss.work('monitor-scan-due', { batchSize: 1 }, async () => {
  const due = await leaseDueMonitors();
  for (const leased of due) {
    await boss.send('monitor-run', leased, {
      singletonKey: `${leased.monitorId}:${leased.scheduledFor}`,
      singletonSeconds: 600
    });
  }
});

await boss.work('monitor-run', { batchSize: Number(process.env.WORKER_CONCURRENCY ?? 5) }, async (jobs) => {
  for (const job of jobs) {
    const data = job.data as { monitorId?: unknown; scheduledFor?: unknown };
    if (typeof data.monitorId !== 'string' || typeof data.scheduledFor !== 'string') {
      throw new Error('Invalid monitor-run payload');
    }
    const result = await runMonitor(data.monitorId, data.scheduledFor);
    console.log(JSON.stringify({ level: 'info', service: 'worker', event: 'monitor_run', monitorId: data.monitorId, ...result }));
    if (result.alertId) await boss.send('notification-scan-pending', {});
  }
});

await boss.work('notification-scan-pending', { batchSize: 1 }, async () => {
  const delivered = await deliverPendingInApp();
  if (delivered) {
    console.log(JSON.stringify({ level: 'info', service: 'worker', event: 'in_app_deliveries', delivered }));
  }
  if (emailAdapter) {
    const email = await deliverPendingEmails(emailAdapter, deliveryConfig);
    if (email.sent || email.failed || email.dead || email.skipped) {
      console.log(JSON.stringify({ level: 'info', service: 'worker', event: 'email_deliveries', ...email }));
    }
  }
});

console.log(JSON.stringify({ level: 'info', service: 'worker', event: 'started' }));

async function shutdown(signal: string) {
  console.log(JSON.stringify({ level: 'info', service: 'worker', event: 'shutdown', signal }));
  await boss.stop({ graceful: true, timeout: 30_000 });
  await closeDatabase();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      console.error(JSON.stringify({ level: 'error', service: 'worker', event: 'shutdown_failed', error: String(error) }));
      process.exitCode = 1;
    });
  });
}
