// Migración de datos SQLite (danacorp.db) -> PostgreSQL (danacorp).
// Idempotente (ON CONFLICT DO NOTHING): se puede re-ejecutar sin duplicar.
// Pasos: aplica esquema, siembra usuarios, copia cada tabla y verifica conteos.
//
// Uso:  npx tsx scripts/migrate-sqlite-to-pg.ts
// La BD destino se fija con PGDATABASE (default 'danacorp'); el resto de la conexión
// (PGHOST/PGPORT/PGUSER/PGPASSWORD) sale de .env vía db.ts.

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// Importante: fijar la BD destino ANTES de importar db.ts (que crea el pool).
// dotenv no pisa variables ya definidas, así que esto gana sobre .env.
process.env.PGDATABASE = process.env.PGDATABASE && process.env.PGDATABASE !== 'postgres'
  ? process.env.PGDATABASE
  : 'danacorp';

const TABLES: Array<{ name: string; pk: string }> = [
  { name: 'projects', pk: 'id' },
  { name: 'project_configs', pk: 'id' },
  { name: 'clients', pk: 'id' },
  { name: 'units', pk: 'id' },
  { name: 'quotation_drafts', pk: 'id' },
  { name: 'notifications', pk: 'id' },
  { name: 'audit_logs', pk: 'id' },
  { name: 'payment_plans', pk: 'id' },
  { name: 'app_state', pk: 'key' },
  // discount_requests: 0 filas y esquema distinto (user_id vs vendedor_id) -> se omite.
];

async function main() {
  const { db, ensureSchema, pool } = await import('../db');
  const { seedUsers } = await import('./seed-users');

  const target = process.env.PGDATABASE;
  const OUT = path.join(process.cwd(), '_migrate-result.json');
  const sqlite = new DatabaseSync(path.join(process.cwd(), 'danacorp.db'));
  const report: Record<string, unknown> = {};

  try {
    await ensureSchema();
    const seededUsers = await seedUsers();

    for (const t of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM ${t.name}`).all() as Array<Record<string, unknown>>;
      let copied = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(', ');
        const sql = `INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${t.pk}) DO NOTHING`;
        const r = await db.prepare(sql).run(...cols.map((c) => row[c]));
        copied += r.changes;
      }
      const pgCount = await db.prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get() as { c: string | number };
      report[t.name] = { sqlite: rows.length, copied, pgTotal: Number(pgCount.c) };
    }

    const out = { ok: true, target, seededUsers, report };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('[migrate] OK ->', target, JSON.stringify(report));
  } catch (e) {
    const err = e as Error;
    fs.writeFileSync(OUT, JSON.stringify({ ok: false, target, msg: err.message }, null, 2));
    console.error('[migrate] FALLO:', err.message);
    process.exitCode = 1;
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main();
