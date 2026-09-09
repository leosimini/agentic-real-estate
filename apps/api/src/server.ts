import { closeDatabase } from '@realty/db';
import { buildApp } from './app.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig();
const app = await buildApp(config);
await app.listen({ port: config.port, host: '0.0.0.0' });

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
