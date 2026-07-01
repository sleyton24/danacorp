import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Demostración de MODO AUDIT (log-only, sin bloqueo) para canAccessProject.
//
// Objetivo: mostrar exactamente qué accesos QUEDARÍAN bloqueados cuando se active
// el enforcement, SIN bloquear todavía. Ninguna request de este test recibe 403
// por project-access: todas responden 200. Lo único que ocurre es que se registra
// una línea `[project-access:audit]` (console.warn) y una fila en audit_logs.
//
// Corre contra un schema Postgres aislado (danacorp_test_<pid>_<ts>), separado de
// la base danacorp real, igual que tests/flows.test.ts.

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password });

// Captura de las líneas de audit emitidas por console.warn durante el test.
const warnSpy = vi.spyOn(console, 'warn');

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

  // Datos mínimos bajo p1 (asignado a vendedor) y p2 (no asignado a nadie no-admin),
  // creados por Admin para que los GET devuelvan filas reales.
  const admin = await login('admin@danacorp.cl', 'admin123');
  const adminToken = admin.body.token as string;
  for (const projectId of ['p1', 'p2']) {
    await request(app).post('/api/clients').set(auth(adminToken))
      .send({ projectId, nombre: `Cliente ${projectId}`, rut: '11.111.111-1' });
    await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId, numero: `${projectId}-U1`, precioLista: 1000, estado: 'Disponible' });
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
  warnSpy.mockRestore();
});

describe('MODO AUDIT — canAccessProject (log-only, sin bloqueo)', () => {
  it('lectura@danacorp.cl ([] → unassigned-empty) queda registrado pero NO bloqueado', async () => {
    const lectura = await login('lectura@danacorp.cl', 'lectura123');
    const token = lectura.body.token as string;

    const units = await request(app).get('/api/units').query({ projectId: 'p2' }).set(auth(token));
    const clients = await request(app).get('/api/clients').query({ projectId: 'p2' }).set(auth(token));
    const plans = await request(app).get('/api/payment-plans').query({ projectId: 'p2', unitNumero: 'p2-U1' }).set(auth(token));

    // AUDIT: responde 200, no 403. No se bloquea nada todavía.
    expect(units.status).toBe(200);
    expect(clients.status).toBe(200);
    expect(plans.status).toBe(200);
  });

  it('vendedor@danacorp.cl (["p1"]) queda registrado en p2 (not-assigned) pero NO en p1 (assigned)', async () => {
    const vendedor = await login('vendedor@danacorp.cl', 'vendedor123');
    const token = vendedor.body.token as string;

    const p1 = await request(app).get('/api/units').query({ projectId: 'p1' }).set(auth(token));
    const p2 = await request(app).get('/api/units').query({ projectId: 'p2' }).set(auth(token));

    expect(p1.status).toBe(200); // assigned → sin audit
    expect(p2.status).toBe(200); // not-assigned → audit, pero sin bloqueo
  });

  it('admin@danacorp.cl (Admin) nunca genera audit', async () => {
    const admin = await login('admin@danacorp.cl', 'admin123');
    const token = admin.body.token as string;
    const res = await request(app).get('/api/units').query({ projectId: 'p2' }).set(auth(token));
    expect(res.status).toBe(200);
  });

  it('imprime el rastro de auditoría acumulado (console.warn + tabla audit_logs)', async () => {
    // 1) Líneas [project-access:audit] capturadas de console.warn
    const auditWarns = warnSpy.mock.calls
      .map(args => String(args[0]))
      .filter(line => line.includes('[project-access:audit]'));

    // 2) Filas persistidas en audit_logs
    const { rows } = await pool.query(
      `SELECT user_name, user_role, entity_id AS project_id, description
         FROM audit_logs
        WHERE action = 'Project access audit'
        ORDER BY created_at`,
    );

    // eslint-disable-next-line no-console
    console.log('\n================ AUDIT MODE — would-be-blocked (NO enforcement) ================');
    console.log(`console.warn lines: ${auditWarns.length}`);
    auditWarns.forEach(l => console.log('  ' + l));
    console.log(`\naudit_logs rows: ${rows.length}`);
    rows.forEach((r: Record<string, unknown>) =>
      console.log(`  [${r.user_role}] ${r.user_name} → project=${r.project_id} :: ${r.description}`));
    console.log('================================================================================\n');

    // Verificaciones: hubo audit para lectura ([]) y para vendedor en p2, y NADA para admin.
    expect(auditWarns.length).toBeGreaterThan(0);
    expect(rows.some(r => String(r.user_role) === 'Lectura' && String(r.description).includes('unassigned-empty'))).toBe(true);
    expect(rows.some(r => String(r.user_role) === 'Ventas' && String(r.description).includes('not-assigned'))).toBe(true);
    expect(rows.some(r => String(r.user_role) === 'Admin')).toBe(false);
    // El proyecto asignado (p1) del vendedor NO debe aparecer en el rastro.
    expect(rows.some(r => String(r.user_role) === 'Ventas' && String(r.project_id) === 'p1')).toBe(false);
  });
});
