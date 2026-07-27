import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Tests del flujo de creación de usuarios con clave provisoria + cambio forzado.
// Mismo patrón de bootstrap que flows.test.ts: schema aislado, seedUsers, server en proceso.

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;
let sugerirPasswordProvisoria: (nombreCompleto: string, email: string) => string;

const ADMIN = { email: 'admin@danacorp.cl', password: 'admin123' };
let adminToken = '';
let ventasToken = '';
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
  sugerirPasswordProvisoria = srv.sugerirPasswordProvisoria;

  adminToken = (await login(ADMIN.email, ADMIN.password)).body.token;
  ventasToken = (await login('vendedor@danacorp.cl', 'vendedor123')).body.token;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

describe('sugerirPasswordProvisoria (unitario, casos borde)', () => {
  it('primer nombre simple', () => {
    expect(sugerirPasswordProvisoria('Ana García', 'ana@x.cl')).toBe('ana12345');
  });
  it('nombre compuesto con acentos y guion', () => {
    expect(sugerirPasswordProvisoria('María José Pérez-Soto', 'mjps@x.cl')).toBe('maria12345');
  });
  it('ñ y diacríticos → n / sin tilde', () => {
    expect(sugerirPasswordProvisoria('Ñuño Ríos', 'nr@x.cl')).toBe('nuno12345');
  });
  it('recorta espacios sobrantes', () => {
    expect(sugerirPasswordProvisoria('  Juan  ', 'juan@x.cl')).toBe('juan12345');
  });
  it('nombre vacío → cae al prefijo del email', () => {
    expect(sugerirPasswordProvisoria('', 'jperez@danacorp.cl')).toBe('jperez12345');
  });
  it('nombre de una sola letra → cae al prefijo del email', () => {
    expect(sugerirPasswordProvisoria('J Pérez', 'jp@danacorp.cl')).toBe('jp12345');
  });
});

describe('POST /api/users (Admin)', () => {
  it('crea el usuario (201), devuelve la clave provisoria y persiste en GET /api/users', async () => {
    const payload = { name: 'Carla Rivas', email: 'carla.rivas@danacorp.cl', company: 'Danacorp', role: 'Ventas', assignedProjectIds: [] };
    const res = await request(app).post('/api/users').set(auth(adminToken)).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.passwordProvisoria).toBe('carla12345');
    expect(res.body.user.email).toBe('carla.rivas@danacorp.cl');
    expect(res.body.user.passwordTemporal).toBe(true);
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();

    // Persistencia real: aparece en la lista (esto es lo que hoy falla con el estado local).
    const list = await request(app).get('/api/users').set(auth(adminToken));
    const found = (list.body as Array<Record<string, unknown>>).find(u => u.email === 'carla.rivas@danacorp.cl');
    expect(found).toBeTruthy();
    expect(found?.passwordTemporal).toBe(true);
  });

  it('rechaza email duplicado con 409', async () => {
    const payload = { name: 'Otra Carla', email: 'carla.rivas@danacorp.cl', role: 'Ventas' };
    const res = await request(app).post('/api/users').set(auth(adminToken)).send(payload);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Ya existe un usuario con ese correo');
  });

  it('rechaza rol inválido con 400', async () => {
    const res = await request(app).post('/api/users').set(auth(adminToken))
      .send({ name: 'Rol Malo', email: 'rolmalo@danacorp.cl', role: 'SuperAdmin' });
    expect(res.status).toBe(400);
  });

  it('un token de rol Ventas recibe 403', async () => {
    const res = await request(app).post('/api/users').set(auth(ventasToken))
      .send({ name: 'No Permitido', email: 'noperm@danacorp.cl', role: 'Ventas' });
    expect(res.status).toBe(403);
  });
});

describe('Clave provisoria — login y cambio forzado', () => {
  const NUEVO = { name: 'Diego Soto', email: 'diego.soto@danacorp.cl', role: 'Ventas' };
  let provisoria = '';

  it('crea el usuario y el login con la provisoria devuelve passwordTemporal: true', async () => {
    const create = await request(app).post('/api/users').set(auth(adminToken)).send(NUEVO);
    expect(create.status).toBe(201);
    provisoria = create.body.passwordProvisoria;
    expect(provisoria).toBe('diego12345');

    const res = await login(NUEVO.email, provisoria);
    expect(res.status).toBe(200);
    expect(res.body.user.passwordTemporal).toBe(true);
    expect(typeof res.body.token).toBe('string');
  });

  it('change-password rechaza la nueva clave igual a la actual (400)', async () => {
    const tok = (await login(NUEVO.email, provisoria)).body.token;
    const res = await request(app).post('/api/auth/change-password').set(auth(tok))
      .send({ passwordActual: provisoria, passwordNueva: provisoria });
    expect(res.status).toBe(400);
  });

  it('change-password rechaza clave nueva de menos de 8 caracteres (400)', async () => {
    const tok = (await login(NUEVO.email, provisoria)).body.token;
    const res = await request(app).post('/api/auth/change-password').set(auth(tok))
      .send({ passwordActual: provisoria, passwordNueva: 'corta' });
    expect(res.status).toBe(400);
  });

  it('change-password exitoso deja password_temporal en false', async () => {
    const tok = (await login(NUEVO.email, provisoria)).body.token;
    const res = await request(app).post('/api/auth/change-password').set(auth(tok))
      .send({ passwordActual: provisoria, passwordNueva: 'ClaveNueva2026' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Login con la clave nueva: el flag ya no está.
    const relogin = await login(NUEVO.email, 'ClaveNueva2026');
    expect(relogin.status).toBe(200);
    expect(relogin.body.user.passwordTemporal).toBe(false);
  });

  it('reset-password (Admin) vuelve a marcar la clave como provisoria', async () => {
    // Diego ya cambió su clave (flag en false). El Admin la regenera → flag true otra vez.
    const target = (await request(app).get('/api/users').set(auth(adminToken)).then(r =>
      (r.body as Array<Record<string, unknown>>).find(u => u.email === NUEVO.email)));
    const res = await request(app).post(`/api/users/${target?.id as string}/reset-password`).set(auth(adminToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.passwordProvisoria).toBe('diego12345');

    const relogin = await login(NUEVO.email, 'diego12345');
    expect(relogin.status).toBe(200);
    expect(relogin.body.user.passwordTemporal).toBe(true);
  });
});

describe('GET /api/users/:id/provisional-password (Admin)', () => {
  const USR = { name: 'Elena Vera', email: 'elena.vera@danacorp.cl', role: 'Ventas' };
  let elenaId = '';

  it('crea el usuario y devuelve la clave vigente, que además funciona en el login', async () => {
    const create = await request(app).post('/api/users').set(auth(adminToken)).send(USR);
    expect(create.status).toBe(201);
    elenaId = create.body.user.id;

    const res = await request(app).get(`/api/users/${elenaId}/provisional-password`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.passwordProvisoria).toBe('elena12345');
    expect(res.body.passwordProvisoria).toBe(sugerirPasswordProvisoria(USR.name, USR.email));

    // Garantía de que derivación y hash guardado no se separaron: la clave consultada loguea.
    const lg = await login(USR.email, res.body.passwordProvisoria);
    expect(lg.status).toBe(200);
    expect(lg.body.user.passwordTemporal).toBe(true);
  });

  it('404 para un id inexistente', async () => {
    const res = await request(app).get('/api/users/no-existe/provisional-password').set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it('403 con un token de rol Ventas', async () => {
    const res = await request(app).get(`/api/users/${elenaId}/provisional-password`).set(auth(ventasToken));
    expect(res.status).toBe(403);
  });

  it('409 cuando el usuario ya definió su propia clave (tras change-password)', async () => {
    const tok = (await login(USR.email, 'elena12345')).body.token;
    const chg = await request(app).post('/api/auth/change-password').set(auth(tok))
      .send({ passwordActual: 'elena12345', passwordNueva: 'ElenaSegura2026' });
    expect(chg.status).toBe(200);

    const res = await request(app).get(`/api/users/${elenaId}/provisional-password`).set(auth(adminToken));
    expect(res.status).toBe(409);
  });

  it('tras un reset del Admin, la clave vuelve a ser visible', async () => {
    const reset = await request(app).post(`/api/users/${elenaId}/reset-password`).set(auth(adminToken)).send({});
    expect(reset.status).toBe(200);

    const res = await request(app).get(`/api/users/${elenaId}/provisional-password`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.passwordProvisoria).toBe('elena12345');
  });
});
