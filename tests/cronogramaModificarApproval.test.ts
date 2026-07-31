import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Punto 5: modificar una cuota EXISTENTE del cronograma en una unidad Escriturada
// requiere aprobación (agregar/eliminar ya la requerían). Cubre:
//  (a) el PATCH directo con planPagos modificado es rechazado (403) y no muta la unidad;
//  (b) al aprobar la solicitud 'modificar', el cambio se aplica a la fila correcta
//      identificada por uid — no por id/label, que puede estar duplicado entre filas
//      (mismo caso límite que cronogramaUtils.test.ts usa para probar la identidad por uid
//      en el frontend; acá se verifica que el backend tampoco se confunda al aplicar).
//  (c) control: Admin/Supervisor sí pueden seguir modificando directo (no deben quedar
//      atrapados por el guard nuevo).

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let adminToken = '';
let jefeToken = '';
const PROJECT = 'p1'; // JefeSala/Ventas seed están asignados a 'p1'

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

async function getUnidad(unitId: string): Promise<Record<string, unknown> | undefined> {
  const units = await request(app).get('/api/units').set(auth(adminToken));
  return (units.body as Array<Record<string, unknown>>).find(u => u.id === unitId);
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789-abcdefghij-xyz';
  const testDb = await import('./test-db');
  preparedTestDb = await testDb.prepareIsolatedTestSchema();

  const dbMod = await import('../db');
  pool = dbMod.pool;
  await dbMod.ensureSchema();
  await pool.query(
    'TRUNCATE units, clients, quotation_drafts, discount_requests, payment_plans, notifications, audit_logs, project_configs, projects, app_state, users, approval_requests RESTART IDENTITY CASCADE',
  );

  const { seedUsers } = await import('../scripts/seed-users');
  await seedUsers();
  await pool.query("INSERT INTO project_configs (id, project_id) VALUES ('cfg-p1', 'p1')");

  const srv = await import('../server');
  app = srv.app;
  adminToken = (await login('admin@danacorp.cl', 'admin123')).body.token;
  jefeToken = (await login('jefe@danacorp.cl', 'jefe123')).body.token;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

describe('Punto 5 — modificar cuota existente en unidad Escriturada requiere aprobación', () => {
  // Label duplicado a propósito ("Cuota 1" en dos filas): si el backend matcheara por
  // id/label en vez de uid al aplicar la aprobación, el cambio se aplicaría a la fila
  // equivocada (o a ambas).
  const PLAN_INICIAL = [
    { uid: 'uid-promesa', id: 'Promesa', date: '2024-01-15', amount: '100', status: 'Pagado', fechaPagoReal: '2024-01-15', observacion: '' },
    { uid: 'uid-cuota-1', id: 'Cuota 1', date: '2024-02-15', amount: '200', status: 'Pendiente', fechaPagoReal: '', observacion: '' },
    { uid: 'uid-cuota-2', id: 'Cuota 1', date: '2024-03-15', amount: '300', status: 'Pendiente', fechaPagoReal: '', observacion: '' }, // label duplicado
  ];

  async function crearUnidadEscrituradaConPlan(numero: string): Promise<string> {
    const unit = await request(app).post('/api/units').set(auth(adminToken))
      .send({ projectId: PROJECT, numero, precioLista: 1000, estado: 'Disponible' });
    expect(unit.status).toBe(200);
    const unitId = unit.body.id as string;
    // Se fija estado + plan directo en BD para no recorrer todo el ciclo de vida
    // Reservado→Promesado→Escriturado en el test (mismo criterio que sembrarProyecto()
    // en proyectoTerminado.test.ts).
    await pool.query("UPDATE units SET estado = 'Escriturado', plan_pagos = $1 WHERE id = $2", [
      JSON.stringify(PLAN_INICIAL), unitId,
    ]);
    return unitId;
  }

  it('(a) JefeSala no puede modificar una cuota existente directo: el PATCH es rechazado y la unidad no cambia', async () => {
    const unitId = await crearUnidadEscrituradaConPlan('ESC-MOD-1');

    const planModificado = PLAN_INICIAL.map(p => (p.uid === 'uid-cuota-2' ? { ...p, amount: '350' } : p));
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(jefeToken))
      .send({ planPagos: planModificado });

    expect(res.status).toBe(403);

    const unidad = await getUnidad(unitId);
    const plan = unidad?.planPagos as Array<{ uid: string; amount: string }>;
    expect(plan.find(p => p.uid === 'uid-cuota-2')?.amount).toBe('300'); // sin cambios
  });

  it('(b) al aprobar la solicitud, el cambio se aplica a la fila correcta por uid, no por id/label duplicado', async () => {
    const unitId = await crearUnidadEscrituradaConPlan('ESC-MOD-2');

    // Simula lo que hace el frontend tras revertir localmente el cambio directo: crea la
    // solicitud de aprobación con la fila modificada (mismo label duplicado "Cuota 1").
    const filaModificada = { ...PLAN_INICIAL[2], amount: '999', observacion: 'Ajuste manual' };
    const solicitud = await request(app).post('/api/approval-requests').set(auth(jefeToken)).send({
      tipo: 'cronograma_pago',
      unitId,
      projectId: PROJECT,
      descripcion: 'Solicitud de modificar pago en cronograma',
      datos: { accion: 'modificar', pago: filaModificada, unitId, estadoAntes: PLAN_INICIAL },
    });
    expect(solicitud.status).toBe(200);
    expect(solicitud.body.estado).toBe('pendiente');

    // Todavía no se aplicó: la unidad sigue con el plan original hasta que se apruebe.
    let unidad = await getUnidad(unitId);
    let plan = unidad?.planPagos as Array<{ uid: string; id: string; amount: string; observacion?: string }>;
    expect(plan.find(p => p.uid === 'uid-cuota-2')?.amount).toBe('300');

    const aprobar = await request(app).post(`/api/approval-requests/${solicitud.body.id}/aprobar`)
      .set(auth(adminToken)).send({});
    expect(aprobar.status).toBe(200);
    expect(aprobar.body.estado).toBe('aprobado');

    unidad = await getUnidad(unitId);
    plan = unidad?.planPagos as Array<{ uid: string; id: string; amount: string; observacion?: string }>;

    // La fila correcta (uid-cuota-2) cambió...
    const filaCambiada = plan.find(p => p.uid === 'uid-cuota-2');
    expect(filaCambiada?.amount).toBe('999');
    expect(filaCambiada?.observacion).toBe('Ajuste manual');

    // ...y la OTRA fila con el MISMO label ('Cuota 1', uid-cuota-1) quedó intacta. Si el
    // match fuera por id/label (bug corregido) en vez de uid, este valor habría cambiado
    // también, o el cambio se habría aplicado a la fila equivocada.
    const otraFilaMismoLabel = plan.find(p => p.uid === 'uid-cuota-1');
    expect(otraFilaMismoLabel?.amount).toBe('200');
    expect(otraFilaMismoLabel?.id).toBe('Cuota 1');

    expect(plan.length).toBe(3); // ninguna fila se perdió ni se duplicó
  });

  it('(c) control: Admin sí puede modificar una cuota existente directo en Escriturado', async () => {
    const unitId = await crearUnidadEscrituradaConPlan('ESC-MOD-3');

    const planModificado = PLAN_INICIAL.map(p => (p.uid === 'uid-cuota-1' ? { ...p, amount: '777' } : p));
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ planPagos: planModificado });

    expect(res.status).toBe(200);
    const unidad = await getUnidad(unitId);
    const plan = unidad?.planPagos as Array<{ uid: string; amount: string }>;
    expect(plan.find(p => p.uid === 'uid-cuota-1')?.amount).toBe('777');
  });
});
