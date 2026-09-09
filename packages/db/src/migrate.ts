import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationsDirectory = process.env.MIGRATIONS_DIR
  ?? fileURLToPath(new URL('../../../infra/postgres/', import.meta.url));

const client = new Client({ connectionString: databaseUrl });

function log(event: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ level: 'info', service: 'db-migrate', event, ...fields })}\n`);
}

await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));

  for (const file of migrationFiles) {
    const sql = await readFile(join(migrationsDirectory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('realty-schema-migrations'))");
      const applied = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migration WHERE version = $1',
        [file]
      );

      const existingChecksum = applied.rows[0]?.checksum;
      if (existingChecksum && existingChecksum !== checksum) {
        throw new Error(`Applied migration ${file} has a different checksum`);
      }

      if (!existingChecksum) {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migration (version, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        log('migration_applied', { version: file });
      } else {
        log('migration_skipped', { version: file });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  log('migrations_complete', { count: migrationFiles.length });
} finally {
  await client.end();
}
