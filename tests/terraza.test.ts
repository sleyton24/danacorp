import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Round-trip del campo Terraza: POST /api/units persiste terraza y GET /api/units la devuelve.
// Mismo bootstrap que flows.test.ts (schema aislado, seedUsers, server en proceso).

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const ADMIN = { email: 'admin@danacorp.cl', password: 'admin123' };
let adminToken = '';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij-xyz';
  const testDb = await import('./test-db');
  preparedTestDb = await testDb.prepareIsolatedTestSchema();

  const dbMod = await import('../db');
  pool = dbMod.pool;
  await dbMod.ensureSchema();
  await pool.query(
    'TRUNCATE units, clients, quotation_drafts, discount_requests, payment_plans, notifications, audit_logs, project_configs, projects, app_state, users RESTART IDENTITY CASCADE',
  );

  const { seedUsers } = await import('../scripts/seed-users');
  await seedUsers();

  const srv = await import('../server');
  app = srv.app;

  adminToken = (await login(ADMIN.email, ADMIN.password)).body.token;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

describe('Terraza — round-trip POST → GET /api/units', () => {
  it('persiste terraza: 12.3 y GET la devuelve idéntica', async () => {
    const projectId = 'p-terraza';
    const unit = await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId, numero: 'TER-101', precioLista: 1000, estado: 'Disponible', superficie: 65.5, terraza: 12.3 });
    expect(unit.status).toBe(200);
    const unitId = unit.body.id;

    const units = await request(app).get('/api/units').set(auth(adminToken));
    const found = (units.body as Array<Record<string, unknown>>).find(u => u.id === unitId);
    expect(found?.terraza).toBe(12.3);
    expect(found?.superficie).toBe(65.5); // no se cruzaron los valores (alineación de upsertUnit)
  });

  it('una unidad sin terraza la devuelve como null/undefined sin romper', async () => {
    const projectId = 'p-terraza-sin';
    const unit = await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId, numero: 'TER-SIN', precioLista: 1000, estado: 'Disponible', superficie: 40 });
    expect(unit.status).toBe(200);
    const unitId = unit.body.id;

    const units = await request(app).get('/api/units').set(auth(adminToken));
    const found = (units.body as Array<Record<string, unknown>>).find(u => u.id === unitId);
    expect(found).toBeTruthy();
    expect(found?.terraza ?? null).toBeNull();
    expect(found?.superficie).toBe(40);
  });
});
