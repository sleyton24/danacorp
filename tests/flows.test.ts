import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Tests de integración de los 4 flujos críticos que la migración a PostgreSQL va a
// tocar. Fijan el comportamiento esperado (red de seguridad anti-regresión) y, de
// paso, verifican que el bug de transacciones (db.transaction undefined -> runTx)
// quedó realmente arreglado: assign unidad y generar cotización corren dentro de runTx.
//
// El server se importa en proceso (sin bindear puerto) gracias al guard isMain, y
// usa una BD SQLite efímera vía DB_PATH.

let app: import('express').Express;
const dbPath = path.join(os.tmpdir(), `danacorp-test-${process.pid}-${Date.now()}.db`);

const ADMIN = { email: 'admin@danacorp.cl', password: 'admin123' };
let adminToken = '';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij-xyz';
  process.env.DB_PATH = dbPath;
  process.env.PORT = '0';
  const mod = await import('../server.ts');
  app = mod.app;

  const res = await login(ADMIN.email, ADMIN.password);
  adminToken = res.body.token;
});

afterAll(() => {
  // Limpia la BD efímera y sus sidecars WAL.
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* noop */ }
  }
});

describe('Flujo 1 — Login', () => {
  it('credenciales válidas devuelven token y user sin password', async () => {
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe(ADMIN.email);
    expect(res.body.user.role).toBe('Admin');
    expect(res.body.user.password).toBeUndefined();
  });

  it('password incorrecta devuelve 401', async () => {
    const res = await login(ADMIN.email, 'mala-clave');
    expect(res.status).toBe(401);
  });

  it('sin token, un endpoint protegido devuelve 401', async () => {
    const res = await request(app).get('/api/units');
    expect(res.status).toBe(401);
  });
});

describe('Flujo 2 — Asignar/reservar unidad (transacción runTx)', () => {
  it('asigna una unidad disponible a un cliente y la deja Reservada', async () => {
    const projectId = 'p-test-assign';

    const cli = await request(app).post('/api/clients').set(auth(adminToken))
      .send({ projectId, nombre: 'Cliente Test', rut: '11.111.111-1' });
    expect(cli.status).toBe(200);
    const clienteId = cli.body.id;

    const unit = await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId, numero: 'ASG-101', precioLista: 1000, estado: 'Disponible' });
    expect(unit.status).toBe(200);
    const unitId = unit.body.id;

    const assign = await request(app).patch(`/api/units/${unitId}/assign`).set(auth(adminToken))
      .send({ clienteId });
    expect(assign.status).toBe(200);
    expect(assign.body.ok).toBe(true);

    const units = await request(app).get('/api/units').set(auth(adminToken));
    const reservada = (units.body as Array<Record<string, unknown>>).find(u => u.id === unitId);
    expect(reservada?.estado).toBe('Reservado');
    expect(reservada?.clienteId).toBe(clienteId);
  });

  it('asignar una unidad inexistente devuelve 404', async () => {
    const res = await request(app).patch('/api/units/no-existe/assign').set(auth(adminToken))
      .send({ clienteId: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('Flujo 3 — Generar cotización (transacción runTx + insertPlan en loop)', () => {
  it('genera la cotización, marca el borrador y crea el plan de pago', async () => {
    const projectId = 'p-test-gen';

    const draft = await request(app).post('/api/quotation-drafts').set(auth(adminToken))
      .send({
        projectId,
        selectedUnits: [{ id: 'u-gen-1', numero: 'GEN-1', precioLista: 1000 }],
        adjustments: [{ key: 'paymentConfig', value: {
          includePaymentPlan: true,
          promesaPct: 10, cuotasPct: 10, escrituraPct: 10, nCuotasNew: 6, bonoPct: 0, bonoPieUnits: [],
        } }],
      });
    expect(draft.status).toBe(200);
    const draftId = draft.body.id;

    const gen = await request(app).post(`/api/quotation-drafts/${draftId}/generate`).set(auth(adminToken)).send({});
    expect(gen.status).toBe(200);
    expect(gen.body.ok).toBe(true);

    // El insertPlan (statement reusado dentro de runTx) debió crear el plan de pago.
    const plans = await request(app).get('/api/payment-plans')
      .query({ unitNumero: 'GEN-1', projectId }).set(auth(adminToken));
    expect(plans.status).toBe(200);
    expect(Array.isArray(plans.body)).toBe(true);
    expect(plans.body.length).toBeGreaterThanOrEqual(1);
    expect(plans.body[0].unitNumero).toBe('GEN-1');
  });

  it('generar un borrador inexistente devuelve 404', async () => {
    const res = await request(app).post('/api/quotation-drafts/no-existe/generate').set(auth(adminToken)).send({});
    expect(res.status).toBe(404);
  });
});

describe('Flujo 4 — Solicitar y aprobar descuento', () => {
  it('crea una solicitud dentro del límite y un Admin la aprueba', async () => {
    const projectId = 'p-test-desc';

    const unit = await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId, numero: 'DESC-1', precioLista: 1000, estado: 'Disponible' });
    const unitId = unit.body.id;

    const dr = await request(app).post('/api/discount-requests').set(auth(adminToken))
      .send({ projectId, unitId, unitNumero: 'DESC-1', precioSolicitado: 950 }); // 5% <= 8%
    expect(dr.status).toBe(200);
    expect(dr.body.estado).toBe('Pendiente');
    const drId = dr.body.id;

    const approve = await request(app).post(`/api/discount-requests/${drId}/approve`).set(auth(adminToken)).send({});
    expect(approve.status).toBe(200);
    expect(approve.body.estado).toBe('Aprobado');
  });

  it('un descuento por sobre el límite del supervisor se rechaza con 403', async () => {
    const projectId = 'p-test-desc2';
    const unit = await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId, numero: 'DESC-2', precioLista: 1000, estado: 'Disponible' });
    const res = await request(app).post('/api/discount-requests').set(auth(adminToken))
      .send({ projectId, unitId: unit.body.id, unitNumero: 'DESC-2', precioSolicitado: 800 }); // 20% > 8%
    expect(res.status).toBe(403);
  });
});

describe('Manejo de errores', () => {
  it('una ruta /api inexistente devuelve 404 JSON (no HTML)', async () => {
    const res = await request(app).get('/api/no-existe-ruta').set(auth(adminToken));
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
