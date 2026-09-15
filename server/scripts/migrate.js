#!/usr/bin/env node
/**
 * Plain-SQL migration runner. No ORM: each db/migrations/*.sql file runs once,
 * inside a transaction, and is recorded in schema_migrations by checksum.
 *
 *   node scripts/migrate.js                 # structural migrations only
 *   node scripts/migrate.js --include-seed  # also run *_seed.sql
 *   node scripts/migrate.js --dry-run
 */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

const includeSeed = process.argv.includes('--include-seed');
const dryRun = process.argv.includes('--dry-run');

const sha256 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function main() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => includeSeed || !f.includes('seed'))
    .sort();

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = sha256(sql);
    const previous = applied.get(file);

    if (previous === checksum) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    if (previous && previous !== checksum) {
      // Editing an applied migration silently diverges environments.
      throw new Error(
        `${file} changed after it was applied (${previous} -> ${checksum}). ` +
          `Add a new migration instead of editing this one.`
      );
    }
    if (dryRun) {
      console.log(`+ ${file} (dry run, not executed)`);
      continue;
    }

    // Seed files are re-runnable by design, so they may re-apply; structural
    // files each run exactly once.
    process.stdout.write(`+ ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)
         ON CONFLICT (filename) DO UPDATE SET checksum = $2, applied_at = NOW()`,
        [file, checksum]
      );
      await client.query('COMMIT');
      console.log('ok');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('failed');
      throw err;
    }
  }

  await client.end();
  console.log('migrations complete');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
