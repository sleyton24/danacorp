import 'dotenv/config';
import pg from 'pg';

export type PreparedTestDatabase = {
  schema: string;
};

function pgConfig(max = 1): pg.PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, max };
  }
  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres',
    max,
  };
}

export async function prepareIsolatedTestSchema(): Promise<PreparedTestDatabase> {
  const schema = `danacorp_test_${process.pid}_${Date.now()}`;
  if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
    throw new Error(`Nombre de schema de test invalido: ${schema}`);
  }

  const adminPool = new pg.Pool(pgConfig());
  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await adminPool.end().catch(() => undefined);
  }

  process.env.PGOPTIONS = `-c search_path=${schema}`;
  return { schema };
}

export async function dropIsolatedTestSchema(prepared: PreparedTestDatabase): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(prepared.schema)) return;

  const adminPool = new pg.Pool(pgConfig());
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${prepared.schema} CASCADE`);
  } finally {
    await adminPool.end().catch(() => undefined);
  }
}
