import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Type parsers ──────────────────────────────────────────────────────────────
// Devolver timestamps como string ISO (como hacía SQLite), no como objeto Date,
// para conservar la forma de las respuestas JSON de la API.
pg.types.setTypeParser(1184, (v: string | null) => (v == null ? v : new Date(v).toISOString())); // timestamptz
pg.types.setTypeParser(1114, (v: string | null) => (v == null ? v : new Date(v).toISOString())); // timestamp

// ── Pool ────────────────────────────────────────────────────────────────────
// Lee la conexión de PG* (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) o DATABASE_URL.
export const pool = new pg.Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, max: 10 }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        max: 10,
      },
);

// El pool emite 'error' si un cliente inactivo muere; sin handler, el proceso cae.
pool.on('error', (err) => { console.error('[pg pool error]', err.message); });

// ── Adaptador ─────────────────────────────────────────────────────────────────
// Convierte los placeholders posicionales '?' de SQLite a '$1,$2,...' de PostgreSQL.
// El código de la app no usa '?' literales dentro de strings SQL, así que el
// reemplazo global es seguro.
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type Executor = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };
type Row = Record<string, unknown>;

export interface Statement {
  get: (...params: unknown[]) => Promise<Row | undefined>;
  all: (...params: unknown[]) => Promise<Row[]>;
  run: (...params: unknown[]) => Promise<{ changes: number }>;
}

export interface Db {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => Promise<void>;
}

function makeDb(exec: Executor): Db {
  return {
    prepare(sql: string): Statement {
      const text = toPg(sql);
      return {
        async get(...params: unknown[]) {
          const r = await exec.query(text, params);
          return r.rows[0] as Row | undefined;
        },
        async all(...params: unknown[]) {
          const r = await exec.query(text, params);
          return r.rows as Row[];
        },
        async run(...params: unknown[]) {
          const r = await exec.query(text, params);
          return { changes: r.rowCount ?? 0 };
        },
      };
    },
    async exec(sql: string) {
      await exec.query(sql);
    },
  };
}

// db global sobre el pool. Para queries normales.
export const db: Db = makeDb(pool);

// Ejecuta fn dentro de una transacción real (un client dedicado del pool con
// BEGIN/COMMIT/ROLLBACK). El `tx` expone la misma interfaz que `db`.
export async function withTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(makeDb(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignora errores de rollback */ }
    throw err;
  } finally {
    client.release();
  }
}

// Aplica scripts/schema.sql (idempotente). Lo usan el script de migración y los tests;
// NO se ejecuta al arrancar el servidor.
export async function ensureSchema(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, 'scripts', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Verifica conectividad (para health checks / arranque).
export async function ping(): Promise<boolean> {
  const r = await pool.query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}
