import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Hitos — respaldo server-side de las reglas nuevas de la sección:
//  (a) las dos fechas CBR son opcionales y su orden se valida solo si están presentes;
//      el rechazo es 400 y NO debe persistir nada;
//  (b) 'Contado' no admite datos de crédito: el PATCH los normaliza aunque el cliente
//      los mande (cubre llamadas directas a la API, no solo la UI).

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let adminToken = '';
const PROJECT = 'p1';

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

/** Fila cruda de la BD: lo que realmente quedó persistido, sin pasar por el mapper. */
async function filaUnidad(unitId: string) {
  return (await pool.query(
    `SELECT fecha_escritura, fecha_ingreso_cbr, fecha_inscripcion_cbr, forma_financiamiento,
            banco, fecha_solicitud_credito, fecha_aprobacion_credito, credito_hipotecario,
            plazo_credito_anios, tasa_financiamiento
     FROM units WHERE id = $1`, [unitId])).rows[0];
}

async function crearUnidadEscriturada(numero: string, fechaEscritura: string): Promise<string> {
  const u = await request(app).post('/api/units').set(auth(adminToken))
    .send({ projectId: PROJECT, numero, precioLista: 1000, estado: 'Disponible' });
  expect(u.status).toBe(200);
  const unitId = u.body.id as string;
  // Se fija estado + escritura directo en BD para no recorrer todo el ciclo de vida acá
  // (mismo criterio que sembrarProyecto en proyectoTerminado.test.ts).
  await pool.query("UPDATE units SET estado = 'Escriturado', fecha_escritura = $1 WHERE id = $2",
    [fechaEscritura, unitId]);
  return unitId;
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
  await pool.query("INSERT INTO project_configs (id, project_id) VALUES ('cfg-p1', 'p1')");

  const srv = await import('../server');
  app = srv.app;
  adminToken = (await login('admin@danacorp.cl', 'admin123')).body.token;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

describe('Hitos — fechas CBR (opcionales, con orden validado)', () => {
  const ESCRITURA = '2026-02-01';

  it('guardar con CBR vacío: 200, sin error de validación', async () => {
    // Las dos fechas nunca son requisito para cerrar el proceso de la unidad.
    const unitId = await crearUnidadEscriturada('CBR-VACIO', ESCRITURA);
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaIngresoCBR: '', fechaInscripcionCBR: '' });
    expect(res.status).toBe(200);
    const fila = await filaUnidad(unitId);
    expect(fila.fecha_ingreso_cbr).toBeFalsy();
    expect(fila.fecha_inscripcion_cbr).toBeFalsy();
  });

  it('un PATCH que ni menciona las fechas CBR pasa igual (no son requisito)', async () => {
    const unitId = await crearUnidadEscriturada('CBR-AUSENTE', ESCRITURA);
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ observaciones: 'sin tocar CBR' });
    expect(res.status).toBe(200);
  });

  it('ambas fechas en orden correcto: 200 y persistidas', async () => {
    const unitId = await crearUnidadEscriturada('CBR-OK', ESCRITURA);
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaIngresoCBR: '2026-02-05', fechaInscripcionCBR: '2026-02-20' });
    expect(res.status).toBe(200);
    const fila = await filaUnidad(unitId);
    expect(fila.fecha_ingreso_cbr).toBe('2026-02-05');
    expect(fila.fecha_inscripcion_cbr).toBe('2026-02-20');
  });

  it('fechas iguales a la escritura: admitidas ("no anterior" incluye igual)', async () => {
    const unitId = await crearUnidadEscriturada('CBR-IGUAL', ESCRITURA);
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaIngresoCBR: ESCRITURA, fechaInscripcionCBR: ESCRITURA });
    expect(res.status).toBe(200);
  });

  it('ingreso anterior a la escritura: 400 y no persiste nada', async () => {
    const unitId = await crearUnidadEscriturada('CBR-ORDEN-1', ESCRITURA);
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaIngresoCBR: '2026-01-31' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('Escritura');
    const fila = await filaUnidad(unitId);
    expect(fila.fecha_ingreso_cbr).toBeFalsy();
  });

  it('inscripción anterior al ingreso: 400 y no persiste nada', async () => {
    const unitId = await crearUnidadEscriturada('CBR-ORDEN-2', ESCRITURA);
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaIngresoCBR: '2026-02-10', fechaInscripcionCBR: '2026-02-09' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('ingreso');
    const fila = await filaUnidad(unitId);
    expect(fila.fecha_ingreso_cbr).toBeFalsy();
    expect(fila.fecha_inscripcion_cbr).toBeFalsy();
  });

  it('el orden se valida contra el estado RESULTANTE, no solo contra el body', async () => {
    // Ingreso ya guardado; un PATCH que solo manda la inscripción igual debe compararse
    // contra el ingreso persistido. Sin esto, un PATCH parcial evade la regla.
    const unitId = await crearUnidadEscriturada('CBR-RESULTANTE', ESCRITURA);
    expect((await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaIngresoCBR: '2026-02-10' })).status).toBe(200);

    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ fechaInscripcionCBR: '2026-02-05' });
    expect(res.status).toBe(400);
    const fila = await filaUnidad(unitId);
    expect(fila.fecha_inscripcion_cbr).toBeFalsy();
    expect(fila.fecha_ingreso_cbr).toBe('2026-02-10'); // el dato previo sigue intacto
  });
});

describe('Hitos — Contado no admite datos de crédito', () => {
  it("PATCH con formaFinanciamiento 'Contado' vacía el bloque de crédito aunque el cliente lo mande", async () => {
    const unitId = await crearUnidadEscriturada('CONTADO-1', '2026-02-01');
    // Primero se cargan datos de crédito con Financiamiento.
    expect((await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send({
      formaFinanciamiento: 'Financiamiento', banco: 'BCI',
      fechaSolicitudCredito: '2026-01-05', fechaAprobacionCredito: '2026-01-15',
      creditoHipotecario: 3500, plazoCreditoAnios: 20, tasaFinanciamiento: 4.5,
    })).status).toBe(200);

    let fila = await filaUnidad(unitId);
    expect(fila.banco).toBe('BCI');
    expect(Number(fila.credito_hipotecario)).toBe(3500);

    // Ahora se pasa a Contado MANDANDO datos de crédito a la vez (lo que haría una
    // llamada directa a la API salteándose la limpieza del frontend).
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send({
      formaFinanciamiento: 'Contado', banco: 'SANTANDER',
      fechaSolicitudCredito: '2026-03-01', creditoHipotecario: 9999,
      plazoCreditoAnios: 30, tasaFinanciamiento: 9.9,
    });
    expect(res.status).toBe(200);

    fila = await filaUnidad(unitId);
    expect(fila.forma_financiamiento).toBe('Contado');
    expect(fila.banco).toBeNull();
    expect(fila.fecha_solicitud_credito).toBeNull();
    expect(fila.fecha_aprobacion_credito).toBeNull();
    expect(fila.plazo_credito_anios).toBeNull();
    expect(fila.tasa_financiamiento).toBeNull();
    // credito_hipotecario es NOT NULL DEFAULT 0: se vacía a 0, no a null.
    expect(Number(fila.credito_hipotecario)).toBe(0);
  });

  it('una unidad ya en Contado sigue rechazando datos de crédito en PATCHes posteriores', async () => {
    const unitId = await crearUnidadEscriturada('CONTADO-2', '2026-02-01');
    expect((await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ formaFinanciamiento: 'Contado' })).status).toBe(200);

    // El body no vuelve a declarar la forma: el guard la lee del estado existente.
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ banco: 'ITAU', creditoHipotecario: 1234 });
    expect(res.status).toBe(200);
    const fila = await filaUnidad(unitId);
    expect(fila.banco).toBeNull();
    expect(Number(fila.credito_hipotecario)).toBe(0);
  });

  it("'Financiamiento' conserva los datos de crédito", async () => {
    const unitId = await crearUnidadEscriturada('FINANC-1', '2026-02-01');
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send({
      formaFinanciamiento: 'Financiamiento', banco: 'BANCO DE CHILE',
      creditoHipotecario: 4200, plazoCreditoAnios: 25, tasaFinanciamiento: 3.9,
    });
    expect(res.status).toBe(200);
    const fila = await filaUnidad(unitId);
    expect(fila.banco).toBe('BANCO DE CHILE');
    expect(Number(fila.credito_hipotecario)).toBe(4200);
    expect(fila.plazo_credito_anios).toBe(25);
    expect(Number(fila.tasa_financiamiento)).toBe(3.9);
  });

  it('forma no declarada (null) conserva los datos de crédito ya cargados', async () => {
    // Es el caso de todas las unidades anteriores al campo: no se les debe borrar nada.
    const unitId = await crearUnidadEscriturada('FINANC-NULL', '2026-02-01');
    const res = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ banco: 'ESTADO', creditoHipotecario: 1500 });
    expect(res.status).toBe(200);
    const fila = await filaUnidad(unitId);
    expect(fila.forma_financiamiento).toBeNull();
    expect(fila.banco).toBe('ESTADO');
    expect(Number(fila.credito_hipotecario)).toBe(1500);
  });
});
