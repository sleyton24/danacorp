import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Bloque D — flujo de aprobación de reserva (Disponible → Reservado).
// Ventas/JefeSala reservan → unidad Reservada YA + solicitud 'reserva' pendiente.
// Admin/Supervisor reservan directo, sin solicitud. Rechazo y timeout liberan la unidad.

let app: import('express').Express;
let pool: import('pg').Pool;
let srv: typeof import('../server');
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let adminToken = '';
let ventasToken = '';
let supervisorToken = '';
const PROJECT = 'p1'; // el usuario Ventas seed está asignado a 'p1'

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}
async function crearUnidad(numero: string): Promise<string> {
  const u = await request(app).post('/api/units').set(auth(adminToken))
    .send({ projectId: PROJECT, numero, precioLista: 1000, estado: 'Disponible' });
  expect(u.status).toBe(200);
  return u.body.id;
}
async function crearCliente(nombre: string): Promise<string> {
  const c = await request(app).post('/api/clients').set(auth(adminToken))
    .send({ projectId: PROJECT, nombre, rut: `${Math.floor(Math.random() * 1e7)}-1` });
  expect(c.status).toBe(200);
  return c.body.id;
}
async function getUnidad(unitId: string): Promise<Record<string, unknown> | undefined> {
  const units = await request(app).get('/api/units').set(auth(adminToken));
  return (units.body as Array<Record<string, unknown>>).find(u => u.id === unitId);
}
async function solicitudesReserva(unitId: string): Promise<Array<Record<string, unknown>>> {
  const r = await request(app).get('/api/approval-requests').query({ tipo: 'reserva' }).set(auth(adminToken));
  return (r.body as Array<Record<string, unknown>>).filter(a => a.unit_id === unitId);
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij-xyz';
  const testDb = await import('./test-db');
  preparedTestDb = await testDb.prepareIsolatedTestSchema();

  const dbMod = await import('../db');
  pool = dbMod.pool;
  await dbMod.ensureSchema();
  await pool.query('TRUNCATE units, clients, quotation_drafts, discount_requests, payment_plans, notifications, audit_logs, project_configs, projects, app_state, users, approval_requests RESTART IDENTITY CASCADE');

  const { seedUsers } = await import('../scripts/seed-users');
  await seedUsers();
  // config del proyecto con el default de 72h (Checkpoint A) para ejercitar el JOIN del checker.
  await pool.query("INSERT INTO project_configs (id, project_id) VALUES ('cfg-p1', 'p1')");

  srv = await import('../server');
  app = srv.app;
  adminToken = (await login('admin@danacorp.cl', 'admin123')).body.token;
  ventasToken = (await login('vendedor@danacorp.cl', 'vendedor123')).body.token;
  supervisorToken = (await login('supervisor@danacorp.cl', 'supervisor123')).body.token;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

describe('Bloque D — aprobación de reserva', () => {
  it('aprobación a tiempo: Ventas reserva → solicitud pendiente + unidad Reservada; Admin aprueba → aprobado, sigue Reservada', async () => {
    const unitId = await crearUnidad('RA-APROBAR');
    const clienteId = await crearCliente('Cliente Aprobar');

    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(ventasToken))
      .send({ estado: 'Reservado', clienteId });
    expect(res.status).toBe(200);
    expect((await getUnidad(unitId))?.estado).toBe('Reservado');

    const sols = await solicitudesReserva(unitId);
    expect(sols.length).toBe(1);
    expect(sols[0].estado).toBe('pendiente');

    const ap = await request(app).post(`/api/approval-requests/${sols[0].id}/aprobar`).set(auth(adminToken)).send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('aprobado');
    // La unidad sigue Reservada (sigue su ciclo normal de 10 días).
    expect((await getUnidad(unitId))?.estado).toBe('Reservado');
  });

  it('rechazo explícito: Admin rechaza → solicitud rechazada y unidad liberada a Disponible de inmediato', async () => {
    const unitId = await crearUnidad('RA-RECHAZAR');
    const clienteId = await crearCliente('Cliente Rechazar');
    await request(app).patch(`/api/units/${unitId}`).set(auth(ventasToken)).send({ estado: 'Reservado', clienteId });

    const sols = await solicitudesReserva(unitId);
    expect(sols.length).toBe(1);

    const rj = await request(app).post(`/api/approval-requests/${sols[0].id}/rechazar`).set(auth(adminToken)).send({});
    expect(rj.status).toBe(200);
    expect(rj.body.estado).toBe('rechazado');

    const u = await getUnidad(unitId);
    expect(u?.estado).toBe('Disponible');
    expect(u?.clienteId ?? null).toBeNull();
  });

  it('vencimiento por timeout: solicitud sin resolver más allá de 72h → unidad liberada y solicitud vencida', async () => {
    const unitId = await crearUnidad('RA-TIMEOUT');
    const clienteId = await crearCliente('Cliente Timeout');
    await request(app).patch(`/api/units/${unitId}`).set(auth(ventasToken)).send({ estado: 'Reservado', clienteId });
    const [sol] = await solicitudesReserva(unitId);
    expect(sol.estado).toBe('pendiente');

    // Fresca: el checker NO debe liberar todavía.
    await srv.checkAprobacionesReservaVencidas();
    expect((await getUnidad(unitId))?.estado).toBe('Reservado');

    // Envejecer la solicitud a 73h atrás (supera las 72h de config) y re-chequear.
    await pool.query("UPDATE approval_requests SET solicitado_at = now() - interval '73 hours' WHERE id = $1", [sol.id]);
    await srv.checkAprobacionesReservaVencidas();

    expect((await getUnidad(unitId))?.estado).toBe('Disponible');
    const [solPost] = await solicitudesReserva(unitId);
    expect(solPost.estado).toBe('vencido');
  });

  it('atomicidad: si falla el INSERT de la solicitud, se revierte el UPDATE (la unidad NO queda Reservada a medias)', async () => {
    const unitId = await crearUnidad('RA-ATOMIC');
    const clienteId = await crearCliente('Cliente Atomic');
    // Fuerzo el fallo del 2º paso: elimino la tabla para que el INSERT dentro de la tx falle.
    // ensureApprovalsTable ya corrió en tests previos (flag interno) → es no-op, no la recrea.
    await pool.query('DROP TABLE approval_requests');
    try {
      const res = await request(app).patch(`/api/units/${unitId}`).set(auth(ventasToken))
        .send({ estado: 'Reservado', clienteId });
      expect(res.status).toBe(500); // la transacción falló y propagó al error handler global
      // Rollback: la unidad sigue Disponible, no quedó Reservada sin solicitud.
      const u = await getUnidad(unitId);
      expect(u?.estado).toBe('Disponible');
      expect(u?.clienteId ?? null).toBeNull();
    } finally {
      await pool.query(`CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY, tipo TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente',
        solicitado_por TEXT NOT NULL, solicitado_nombre TEXT, solicitado_at TIMESTAMPTZ DEFAULT NOW(),
        resuelto_por TEXT, resuelto_at TIMESTAMPTZ, unit_id TEXT, project_id TEXT,
        descripcion TEXT, datos JSONB)`);
    }
  });

  it('transición directa por Admin o Supervisor: reserva sin generar solicitud de aprobación', async () => {
    for (const [nombre, token] of [['Admin', adminToken], ['Supervisor', supervisorToken]] as const) {
      const unitId = await crearUnidad(`RA-DIRECTA-${nombre}`);
      const clienteId = await crearCliente(`Cliente Directa ${nombre}`);
      const res = await request(app).patch(`/api/units/${unitId}`).set(auth(token))
        .send({ estado: 'Reservado', clienteId });
      expect(res.status).toBe(200);
      expect((await getUnidad(unitId))?.estado).toBe('Reservado');
      expect((await solicitudesReserva(unitId)).length).toBe(0);
    }
  });

  // Prioridad 1: el segundo camino de reserva (PATCH /assign) NO debe saltarse la aprobación.
  it('bypass /assign: Ventas reserva vía PATCH /api/units/:id/assign → también genera solicitud', async () => {
    const unitId = await crearUnidad('RA-ASSIGN-V');
    const clienteId = await crearCliente('Cliente Assign V');
    const res = await request(app).patch(`/api/units/${unitId}/assign`).set(auth(ventasToken)).send({ clienteId });
    expect(res.status).toBe(200);
    expect((await getUnidad(unitId))?.estado).toBe('Reservado');
    const sols = await solicitudesReserva(unitId);
    expect(sols.length).toBe(1);
    expect(sols[0].estado).toBe('pendiente');
  });

  it('/assign por Admin reserva directo, sin solicitud', async () => {
    const unitId = await crearUnidad('RA-ASSIGN-A');
    const clienteId = await crearCliente('Cliente Assign A');
    const res = await request(app).patch(`/api/units/${unitId}/assign`).set(auth(adminToken)).send({ clienteId });
    expect(res.status).toBe(200);
    expect((await getUnidad(unitId))?.estado).toBe('Reservado');
    expect((await solicitudesReserva(unitId)).length).toBe(0);
  });
});

describe('Bloque D — liberación cancela la solicitud pendiente (no huérfana)', () => {
  async function reservarPendiente(numero: string): Promise<string> {
    const unitId = await crearUnidad(numero);
    const clienteId = await crearCliente(`Cli ${numero}`);
    await request(app).patch(`/api/units/${unitId}`).set(auth(ventasToken)).send({ estado: 'Reservado', clienteId });
    const [sol] = await solicitudesReserva(unitId);
    expect(sol?.estado).toBe('pendiente');
    return unitId;
  }
  const estadoSolicitud = async (unitId: string) => (await solicitudesReserva(unitId))[0]?.estado;

  it('PATCH /:id → Disponible cancela la solicitud (no la deja pendiente)', async () => {
    const unitId = await reservarPendiente('LIB-PATCH');
    const r = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send({ estado: 'Disponible' });
    expect(r.status).toBe(200);
    expect((await getUnidad(unitId))?.estado).toBe('Disponible');
    expect(await estadoSolicitud(unitId)).toBe('cancelado');
    await srv.checkAprobacionesReservaVencidas();
    expect(await estadoSolicitud(unitId)).toBe('cancelado'); // el checker de timeout ya no la ve pendiente
  });

  it('/unassign cancela la solicitud', async () => {
    const unitId = await reservarPendiente('LIB-UNASSIGN');
    const r = await request(app).patch(`/api/units/${unitId}/unassign`).set(auth(adminToken)).send({});
    expect(r.status).toBe(200);
    expect((await getUnidad(unitId))?.estado).toBe('Disponible');
    expect(await estadoSolicitud(unitId)).toBe('cancelado');
    await srv.checkAprobacionesReservaVencidas();
    expect(await estadoSolicitud(unitId)).toBe('cancelado');
  });

  it('/liberar cancela la solicitud', async () => {
    const unitId = await reservarPendiente('LIB-LIBERAR');
    const r = await request(app).post(`/api/units/${unitId}/liberar`).set(auth(adminToken)).send({});
    expect(r.status).toBe(200);
    expect((await getUnidad(unitId))?.estado).toBe('Disponible');
    expect(await estadoSolicitud(unitId)).toBe('cancelado');
    await srv.checkAprobacionesReservaVencidas();
    expect(await estadoSolicitud(unitId)).toBe('cancelado');
  });
});
