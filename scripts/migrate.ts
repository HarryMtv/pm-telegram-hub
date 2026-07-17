import 'dotenv/config';

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is required to run migrations.\n' +
        'Use the Supabase direct/connection string (add ?sslmode=require).',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    // Managed Postgres (Supabase) requires TLS; allow override for local dev.
    ssl: process.env.PG_NO_SSL === '1' ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>(
      'select filename from schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.filename));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ✓ already applied: ${file}`);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  → applying: ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
        await client.query('commit');
        console.log(`  ✓ applied: ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
    console.log('migrations complete');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
