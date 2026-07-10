import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// 3.2 — IDOR en notificaciones: read/delete solo por el destinatario (usuario, rol, o 'All').
let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let adminToken = '';   // u1, rol Admin
let ventasToken = '';  // u2, rol Ventas

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}
async function insertNotif(id: string, opts: { paraUserId?: string; paraRol?: string }) {
  await pool.query(
    `INSERT INTO notifications (id, para_user_id, para_rol, titulo, mensaje, tipo, leida, created_at)
     VALUES ($1, $2, $3, 'T', 'M', 'info', 0, now())`,
    [id, opts.paraUserId ?? null, opts.paraRol ?? null],
  );
}
const getNotif = async (id: string) =>
  (await pool.query('SELECT leida, COALESCE(eliminada,0) AS eliminada FROM notifications WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij-xyz';
  const testDb = await import('./test-db');
  preparedTestDb = await testDb.prepareIsolatedTestSchema();
  const dbMod = await import('../db');
  pool = dbMod.pool;
  await dbMod.ensureSchema();
  // `eliminada` se agrega vía migración inline en init() (no en schema.sql); replicarla aquí.
  await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS eliminada INTEGER DEFAULT 0');
  await pool.query('TRUNCATE users, notifications RESTART IDENTITY CASCADE');
  const { seedUsers } = await import('../scripts/seed-users');
  await seedUsers();
  const srv = await import('../server');
  app = srv.app;
  adminToken = (await login('admin@danacorp.cl', 'admin123')).body.token;
  ventasToken = (await login('vendedor@danacorp.cl', 'vendedor123')).body.token;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

describe('3.2 — IDOR notificaciones', () => {
  it('un usuario NO puede marcar leída una notificación de OTRO usuario (404, sin efecto)', async () => {
    await insertNotif('n-user-u2', { paraUserId: 'u2' }); // dirigida a Ventas (u2)
    const res = await request(app).post('/api/notifications/n-user-u2/read').set(auth(adminToken)).send({});
    expect(res.status).toBe(404);
    expect((await getNotif('n-user-u2')).leida).toBe(0); // sigue no leída
  });

  it('un usuario NO puede eliminar una notificación de OTRO usuario (404, sin efecto)', async () => {
    await insertNotif('n-del-u2', { paraUserId: 'u2' });
    const res = await request(app).delete('/api/notifications/n-del-u2').set(auth(adminToken)).send();
    expect(res.status).toBe(404);
    expect((await getNotif('n-del-u2')).eliminada).toBe(0); // sigue visible
  });

  it('el destinatario SÍ puede marcarla leída y eliminarla', async () => {
    await insertNotif('n-own', { paraUserId: 'u2' });
    const r1 = await request(app).post('/api/notifications/n-own/read').set(auth(ventasToken)).send({});
    expect(r1.status).toBe(200);
    expect((await getNotif('n-own')).leida).toBe(1);
    const r2 = await request(app).delete('/api/notifications/n-own').set(auth(ventasToken)).send();
    expect(r2.status).toBe(200);
    expect((await getNotif('n-own')).eliminada).toBe(1);
  });

  it('notificación por ROL: solo el rol destinatario puede accionarla', async () => {
    await insertNotif('n-rol-admin', { paraRol: 'Admin' });
    // Ventas no es Admin → 404
    const bad = await request(app).post('/api/notifications/n-rol-admin/read').set(auth(ventasToken)).send({});
    expect(bad.status).toBe(404);
    expect((await getNotif('n-rol-admin')).leida).toBe(0);
    // Admin sí
    const ok = await request(app).post('/api/notifications/n-rol-admin/read').set(auth(adminToken)).send({});
    expect(ok.status).toBe(200);
    expect((await getNotif('n-rol-admin')).leida).toBe(1);
  });
});
