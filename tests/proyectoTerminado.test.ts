import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Proyecto terminado: solo lectura con descarga de reportes.
 *
 * El punto central es la matriz de los 23 endpoints de escritura: un endpoint olvidado es
 * un agujero silencioso, así que se recorren todos con it.each y todos deben dar 409.
 * Mismo bootstrap que los otros tests de integración (schema aislado, seedUsers,
 * servidor en proceso).
 */

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let adminToken = '';
let ventasToken = '';
let supervisorToken = '';

// Proyectos: uno por escenario, para que un borrado no arruine la matriz.
const P_TERM = 'pt-terminado';       // terminado; sobre él corre la matriz de 409
const P_ACTIVO = 'pt-activo';        // activo; control de que nada se bloquea
const P_CICLO = 'pt-ciclo';          // terminar → 409 → reabrir → 200
const P_DEL_OK = 'pt-del-ok';        // terminado, solo Disponible → borrado feliz
const P_DEL_ESC = 'pt-del-esc';      // terminado con una Escriturado → 409
const P_DEL_PROM = 'pt-del-prom';    // terminado con una Promesado → 409
const P_ROLLBACK = 'pt-rollback';    // terminado; se fuerza un error en la transacción

const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

/** Siembra un proyecto con una unidad, un cliente y las solicitudes asociadas. */
async function sembrarProyecto(pid: string, nombre: string, estadoUnidad = 'Disponible') {
  await q('INSERT INTO projects (id, nombre) VALUES ($1, $2)', [pid, nombre]);
  await q('INSERT INTO project_configs (id, project_id) VALUES ($1, $2)', [`cfg-${pid}`, pid]);
  await q(
    `INSERT INTO units (id, project_id, numero, type, estado, precio_lista, precio_venta, documents)
     VALUES ($1, $2, $3, 'Departamento', $4, 1000, 1000, '[]')`,
    [`u-${pid}`, pid, `N-${pid}`, estadoUnidad],
  );
  await q(
    `INSERT INTO clients (id, project_id, nombre, rut, documents) VALUES ($1, $2, 'Cliente', '1-9', '[]')`,
    [`c-${pid}`, pid],
  );
  await q('INSERT INTO quotation_drafts (id, project_id, user_id) VALUES ($1, $2, $3)', [`q-${pid}`, pid, 'u1']);
  await q(
    `INSERT INTO discount_requests (id, project_id, unit_id, unit_numero, vendedor_id,
       precio_original, precio_solicitado, descuento_pct, descuento_monto)
     VALUES ($1, $2, $3, $4, 'u1', 1000, 900, 10, 100)`,
    [`d-${pid}`, pid, `u-${pid}`, `N-${pid}`],
  );
  await q(
    `INSERT INTO approval_requests (id, tipo, solicitado_por, project_id, unit_id)
     VALUES ($1, 'cronograma_pago', 'u1', $2, $3)`,
    [`ar-${pid}`, pid, `u-${pid}`],
  );
}

const terminar = (pid: string, valor: boolean, token = adminToken) =>
  request(app).patch(`/api/projects/${pid}/archivar`).set(auth(token)).send({ archivado: valor });

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

  adminToken = (await login('admin@danacorp.cl', 'admin123')).body.token;
  ventasToken = (await login('vendedor@danacorp.cl', 'vendedor123')).body.token;
  supervisorToken = (await login('supervisor@danacorp.cl', 'supervisor123')).body.token;

  // price_history no se crea en ensureSchema en todas las bases: se asegura acá.
  await pool.query(`CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, project_id TEXT NOT NULL,
    precio_anterior REAL NOT NULL, precio_nuevo REAL NOT NULL, variacion_pct REAL NOT NULL,
    motivo TEXT, usuario_id TEXT NOT NULL, usuario_nombre TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await sembrarProyecto(P_TERM, 'Proyecto Terminado');
  await sembrarProyecto(P_ACTIVO, 'Proyecto Activo');
  await sembrarProyecto(P_CICLO, 'Proyecto Ciclo');
  await sembrarProyecto(P_DEL_OK, 'Proyecto Borrable');
  await sembrarProyecto(P_DEL_ESC, 'Proyecto Escriturado', 'Escriturado');
  await sembrarProyecto(P_DEL_PROM, 'Proyecto Promesado', 'Promesado');
  await sembrarProyecto(P_ROLLBACK, 'Proyecto Rollback');

  for (const pid of [P_TERM, P_DEL_OK, P_DEL_ESC, P_DEL_PROM, P_ROLLBACK]) {
    const r = await terminar(pid, true);
    if (r.status !== 200) throw new Error(`No se pudo terminar ${pid}: ${r.status} ${JSON.stringify(r.body)}`);
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

// ── La matriz: los 23 endpoints de escritura ────────────────────────────────
type Caso = {
  nombre: string;
  metodo: 'post' | 'patch' | 'delete';
  ruta: (pid: string) => string;
  body?: (pid: string) => Record<string, unknown>;
  query?: (nombre: string) => Record<string, string>;
};

const ENDPOINTS_BLOQUEADOS: Caso[] = [
  { nombre: 'POST /api/quotation-drafts', metodo: 'post', ruta: () => '/api/quotation-drafts', body: pid => ({ projectId: pid, data: {} }) },
  { nombre: 'DELETE /api/quotation-drafts/:id', metodo: 'delete', ruta: pid => `/api/quotation-drafts/q-${pid}` },
  { nombre: 'POST /api/quotation-drafts/:id/generate', metodo: 'post', ruta: pid => `/api/quotation-drafts/q-${pid}/generate`, body: () => ({}) },
  { nombre: 'POST /api/quotation-drafts/:id/pdf', metodo: 'post', ruta: pid => `/api/quotation-drafts/q-${pid}/pdf`, body: () => ({ pdfBase64: 'AAAA' }) },
  { nombre: 'POST /api/discount-requests', metodo: 'post', ruta: () => '/api/discount-requests', body: pid => ({ projectId: pid, unitId: `u-${pid}`, unitNumero: 'N', precioOriginal: 1000, precioSolicitado: 900, descuentoPct: 10, descuentoMonto: 100 }) },
  { nombre: 'POST /api/discount-requests/:id/approve', metodo: 'post', ruta: pid => `/api/discount-requests/d-${pid}/approve`, body: () => ({}) },
  { nombre: 'POST /api/discount-requests/:id/reject', metodo: 'post', ruta: pid => `/api/discount-requests/d-${pid}/reject`, body: () => ({ motivo: 'x' }) },
  { nombre: 'POST /api/discount-requests/:id/cancel', metodo: 'post', ruta: pid => `/api/discount-requests/d-${pid}/cancel`, body: () => ({}) },
  { nombre: 'POST /api/approval-requests', metodo: 'post', ruta: () => '/api/approval-requests', body: pid => ({ tipo: 'cronograma_pago', projectId: pid }) },
  { nombre: 'POST /api/approval-requests/:id/aprobar', metodo: 'post', ruta: pid => `/api/approval-requests/ar-${pid}/aprobar`, body: () => ({}) },
  { nombre: 'POST /api/approval-requests/:id/rechazar', metodo: 'post', ruta: pid => `/api/approval-requests/ar-${pid}/rechazar`, body: () => ({ motivo: 'x' }) },
  { nombre: 'POST /api/quotations/documents', metodo: 'post', ruta: () => '/api/quotations/documents', query: nombre => ({ project_name: nombre, file_name: 'x.pdf' }) },
  { nombre: 'POST /api/projects/:id/config', metodo: 'post', ruta: pid => `/api/projects/${pid}/config`, body: () => ({ jefeMaxPct: 5 }) },
  { nombre: 'POST /api/clients', metodo: 'post', ruta: () => '/api/clients', body: pid => ({ projectId: pid, id: `nuevo-${pid}`, nombre: 'X', rut: '2-7' }) },
  { nombre: 'PATCH /api/clients/:id', metodo: 'patch', ruta: pid => `/api/clients/c-${pid}`, body: () => ({ nombre: 'Cambiado' }) },
  { nombre: 'POST /api/clients/bulk-import', metodo: 'post', ruta: () => '/api/clients/bulk-import', body: pid => ({ projectId: pid, clients: [{ nombre: 'X', rut: '3-5' }] }) },
  { nombre: 'DELETE /api/clients/:id', metodo: 'delete', ruta: pid => `/api/clients/c-${pid}` },
  { nombre: 'POST /api/units/bulk-price-update', metodo: 'post', ruta: () => '/api/units/bulk-price-update', body: pid => ({ unitIds: [`u-${pid}`], tipo: 'porcentaje', valor: 5 }) },
  { nombre: 'POST /api/units', metodo: 'post', ruta: () => '/api/units', body: pid => ({ projectId: pid, numero: 'NUEVA', type: 'Departamento', estado: 'Disponible', precioLista: 1, precioVenta: 1 }) },
  { nombre: 'PATCH /api/units/:id', metodo: 'patch', ruta: pid => `/api/units/u-${pid}`, body: () => ({ precioVenta: 2000 }) },
  { nombre: 'PATCH /api/units/:id/assign', metodo: 'patch', ruta: pid => `/api/units/u-${pid}/assign`, body: pid => ({ clienteId: `c-${pid}` }) },
  { nombre: 'PATCH /api/units/:id/unassign', metodo: 'patch', ruta: pid => `/api/units/u-${pid}/unassign`, body: () => ({}) },
  { nombre: 'POST /api/units/:id/liberar', metodo: 'post', ruta: pid => `/api/units/u-${pid}/liberar`, body: () => ({}) },
];

const ejecutar = (caso: Caso, pid: string, nombreProyecto: string, token = adminToken) => {
  let r = request(app)[caso.metodo](caso.ruta(pid)).set(auth(token));
  if (caso.query) r = r.query(caso.query(nombreProyecto));
  return caso.body ? r.send(caso.body(pid)) : r;
};

describe('Proyecto terminado — matriz de escritura bloqueada', () => {
  it('la matriz cubre los 23 endpoints de escritura de la lista', () => {
    expect(ENDPOINTS_BLOQUEADOS).toHaveLength(23);
  });

  it.each(ENDPOINTS_BLOQUEADOS.map(c => [c.nombre, c] as [string, Caso]))(
    '%s responde 409 sobre un proyecto terminado',
    async (_nombre, caso) => {
      const res = await ejecutar(caso, P_TERM, 'Proyecto Terminado');
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('PROYECTO_TERMINADO');
      expect(String(res.body.error)).toContain('terminado');
    },
  );

  it.each(ENDPOINTS_BLOQUEADOS.map(c => [c.nombre, c] as [string, Caso]))(
    '%s no lo bloquea el congelamiento sobre un proyecto activo',
    async (_nombre, caso) => {
      const res = await ejecutar(caso, P_ACTIVO, 'Proyecto Activo');
      // El handler puede rechazar por sus propias reglas (400/404, o 409 "ya fue resuelta"
      // cuando un caso anterior de la matriz ya resolvió la solicitud). Lo que se verifica
      // acá es que el rechazo NO venga del middleware de congelamiento.
      expect(res.body?.codigo).not.toBe('PROYECTO_TERMINADO');
    },
  );
});

// ── Exentos ────────────────────────────────────────────────────────────────
describe('Proyecto terminado — endpoints exentos', () => {
  it('se puede reabrir (si no, un terminado quedaría congelado para siempre)', async () => {
    const r = await terminar(P_CICLO, true);
    expect(r.status).toBe(200);
    const reabrir = await terminar(P_CICLO, false);
    expect(reabrir.status).toBe(200);
    expect(reabrir.body.archivado).toBe(false);
  });

  it('marcar una notificación como leída sigue funcionando', async () => {
    await q(`INSERT INTO notifications (id, para_user_id, titulo, mensaje, related_id) VALUES ('n-pt', 'u1', 't', 'm', $1)`, [`u-${P_TERM}`]);
    const res = await request(app).post('/api/notifications/n-pt/read').set(auth(adminToken));
    expect(res.status).toBe(200);
  });

  it('POST /api/audit-logs registra actividad sobre el proyecto terminado', async () => {
    // NOTA: ALLOWED_AUDIT_ACTIONS no tiene ninguna acción de descarga/consulta, así que se
    // usa una permitida. Registrar explícitamente una descarga requeriría ampliar esa
    // allowlist, que está fuera del alcance de esta tarea.
    const res = await request(app).post('/api/audit-logs').set(auth(adminToken))
      .send({ action: 'Ventas:Cotización', entityType: 'Project', entityId: P_TERM, description: 'Consulta de proyecto terminado' });
    expect(res.status).toBe(200);
    const filas = await q('SELECT 1 FROM audit_logs WHERE entity_id = $1 AND description LIKE $2', [P_TERM, '%terminado%']);
    expect(filas.length).toBeGreaterThan(0);
  });

  it('renombrar el proyecto no está bloqueado (queda fuera del alcance del congelamiento)', async () => {
    const res = await request(app).patch(`/api/projects/${P_TERM}`).set(auth(adminToken)).send({ nombre: 'Proyecto Terminado' });
    expect(res.status).toBe(200);
  });
});

// ── Lecturas ───────────────────────────────────────────────────────────────
describe('Proyecto terminado — las lecturas siguen abiertas', () => {
  it('GET /api/units, /api/clients, /api/projects y la config responden 200', async () => {
    for (const ruta of ['/api/units', '/api/clients', '/api/projects', `/api/projects/${P_TERM}/config`]) {
      const res = await request(app).get(ruta).set(auth(adminToken));
      expect(res.status, `${ruta} deberia ser 200`).toBe(200);
    }
  });

  it('GET /api/projects expone archivado, el sello de cierre y los conteos', async () => {
    const res = await request(app).get('/api/projects').set(auth(adminToken));
    const p = (res.body as Array<Record<string, unknown>>).find(x => x.id === P_TERM)!;
    expect(p.archivado).toBe(true);
    expect(p.archivadoPor).toBe('Administrador Principal');
    expect(typeof p.archivadoAt).toBe('string');
    expect(p.unidadesCount).toBeGreaterThan(0);
  });

  it('las unidades del proyecto terminado se siguen leyendo (base del Excel de reportes)', async () => {
    const res = await request(app).get('/api/units').query({ projectId: P_TERM }).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThan(0);
  });

  it('reabrir limpia el sello de cierre', async () => {
    await terminar(P_CICLO, true);
    await terminar(P_CICLO, false);
    const [row] = await q('SELECT archivado, archivado_at, archivado_por FROM projects WHERE id = $1', [P_CICLO]);
    expect(row.archivado).toBe(false);
    expect(row.archivado_at).toBeNull();
    expect(row.archivado_por).toBeNull();
  });
});

// ── Ciclo completo ─────────────────────────────────────────────────────────
describe('Proyecto terminado — ciclo terminar / editar / reabrir', () => {
  it('terminar → 409 al editar la unidad → reabrir → la misma edición da 200', async () => {
    const editar = () => request(app).patch(`/api/units/u-${P_CICLO}`).set(auth(adminToken)).send({ precioVenta: 4321 });

    expect((await terminar(P_CICLO, true)).status).toBe(200);
    const bloqueada = await editar();
    expect(bloqueada.status).toBe(409);

    expect((await terminar(P_CICLO, false)).status).toBe(200);
    const permitida = await editar();
    expect(permitida.status).toBe(200);

    const [u] = await q('SELECT precio_venta FROM units WHERE id = $1', [`u-${P_CICLO}`]);
    expect(Number(u.precio_venta)).toBe(4321);
  });
});

// ── Permisos ───────────────────────────────────────────────────────────────
describe('Proyecto terminado — permisos', () => {
  it('un rol no-Admin no puede terminar, reabrir ni eliminar', async () => {
    for (const token of [ventasToken, supervisorToken]) {
      expect((await terminar(P_ACTIVO, true, token)).status).toBe(403);
      expect((await terminar(P_TERM, false, token)).status).toBe(403);
      const del = await request(app).delete(`/api/projects/${P_TERM}`).set(auth(token));
      expect(del.status).toBe(403);
    }
    // El proyecto activo sigue activo: ningún 403 lo modificó.
    const [row] = await q('SELECT archivado FROM projects WHERE id = $1', [P_ACTIVO]);
    expect(row.archivado).toBe(false);
  });
});

// ── Borrado definitivo ─────────────────────────────────────────────────────
describe('Proyecto terminado — precondiciones del borrado', () => {
  it('409 al eliminar un proyecto que no está terminado', async () => {
    const res = await request(app).delete(`/api/projects/${P_ACTIVO}`).set(auth(adminToken));
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('PROYECTO_NO_TERMINADO');
    expect((await q('SELECT id FROM projects WHERE id = $1', [P_ACTIVO]))).toHaveLength(1);
  });

  it('409 al eliminar un terminado con una unidad Escriturado', async () => {
    const res = await request(app).delete(`/api/projects/${P_DEL_ESC}`).set(auth(adminToken));
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('UNIDADES_CON_VALOR_LEGAL');
    expect(String(res.body.error)).toContain('Escriturado');
    expect((await q('SELECT id FROM units WHERE project_id = $1', [P_DEL_ESC]))).toHaveLength(1);
  });

  it('409 al eliminar un terminado con una unidad Promesado', async () => {
    const res = await request(app).delete(`/api/projects/${P_DEL_PROM}`).set(auth(adminToken));
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('UNIDADES_CON_VALOR_LEGAL');
    expect(String(res.body.error)).toContain('Promesado');
  });

  it('borrado feliz: terminado y solo Disponible → 200 y no queda ninguna fila', async () => {
    // Rastros extra que la cascada debe limpiar.
    await q(
      `INSERT INTO price_history (id, unit_id, project_id, precio_anterior, precio_nuevo, variacion_pct, usuario_id, usuario_nombre)
       VALUES ($1, $2, $3, 1000, 900, -10, 'u1', 'Admin')`,
      [`ph-${P_DEL_OK}`, `u-${P_DEL_OK}`, P_DEL_OK],
    );
    await q(`INSERT INTO payment_plans (id, quotation_id, unit_numero, project_id) VALUES ($1, $2, 'N', $3)`,
      [`pp-${P_DEL_OK}`, `q-${P_DEL_OK}`, P_DEL_OK]);
    await q(`INSERT INTO notifications (id, titulo, mensaje, related_id) VALUES ($1, 't', 'm', $2)`,
      [`n-${P_DEL_OK}`, `ar-${P_DEL_OK}`]);
    await q(`UPDATE users SET assigned_project_ids = $1::jsonb WHERE id = 'u1'`, [JSON.stringify([P_DEL_OK, 'otro'])]);

    const res = await request(app).delete(`/api/projects/${P_DEL_OK}`).set(auth(adminToken));
    expect(res.status).toBe(200);

    for (const tabla of ['units', 'clients', 'quotation_drafts', 'discount_requests', 'payment_plans', 'approval_requests', 'price_history', 'project_configs']) {
      const filas = await q(`SELECT 1 FROM ${tabla} WHERE project_id = $1`, [P_DEL_OK]);
      expect(filas, `${tabla} deberia quedar sin filas del proyecto`).toHaveLength(0);
    }
    expect(await q('SELECT 1 FROM projects WHERE id = $1', [P_DEL_OK])).toHaveLength(0);
    expect(await q('SELECT 1 FROM notifications WHERE id = $1', [`n-${P_DEL_OK}`])).toHaveLength(0);

    // users.assigned_project_ids pierde el id borrado y conserva el resto.
    const [u] = await q(`SELECT assigned_project_ids FROM users WHERE id = 'u1'`);
    const asignados = u.assigned_project_ids as string[];
    expect(asignados).not.toContain(P_DEL_OK);
    expect(asignados).toContain('otro');
  });

  it('rollback: si la transacción falla, no se borró nada', async () => {
    // Una FK externa hacia units bloquea el DELETE FROM units dentro de la transacción.
    await pool.query(`CREATE TABLE pt_traba (id TEXT PRIMARY KEY, unit_id TEXT REFERENCES units(id))`);
    await pool.query(`INSERT INTO pt_traba (id, unit_id) VALUES ('t1', $1)`, [`u-${P_ROLLBACK}`]);
    try {
      const res = await request(app).delete(`/api/projects/${P_ROLLBACK}`).set(auth(adminToken));
      expect(res.status).toBeGreaterThanOrEqual(500);

      // Todo sigue en su lugar: el ROLLBACK revirtió los DELETE previos de la cascada.
      expect(await q('SELECT 1 FROM projects WHERE id = $1', [P_ROLLBACK])).toHaveLength(1);
      expect(await q('SELECT 1 FROM units WHERE project_id = $1', [P_ROLLBACK])).toHaveLength(1);
      expect(await q('SELECT 1 FROM clients WHERE project_id = $1', [P_ROLLBACK])).toHaveLength(1);
      expect(await q('SELECT 1 FROM approval_requests WHERE project_id = $1', [P_ROLLBACK])).toHaveLength(1);
      expect(await q('SELECT 1 FROM project_configs WHERE project_id = $1', [P_ROLLBACK])).toHaveLength(1);
    } finally {
      await pool.query('DROP TABLE IF EXISTS pt_traba');
    }
  });
});

// ── POST /api/sync ─────────────────────────────────────────────────────────
describe('Proyecto terminado — POST /api/sync', () => {
  it('409 si el payload app_state toca un proyecto terminado, nombrándolo', async () => {
    const res = await request(app).post('/api/sync').set(auth(adminToken)).send({
      key: 'app_state',
      value: { projects: [{ id: P_TERM, nombre: 'Renombrado por sync' }], clients: [], units: [] },
    });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('PROYECTO_TERMINADO');
    expect(res.body.proyectosTerminados).toContain('Proyecto Terminado');
    // Rechazo explícito, no filtrado silencioso: el nombre no cambió.
    const [p] = await q('SELECT nombre FROM projects WHERE id = $1', [P_TERM]);
    expect(p.nombre).toBe('Proyecto Terminado');
  });

  it('409 si el payload trae unidades o clientes de un proyecto terminado', async () => {
    const porUnidad = await request(app).post('/api/sync').set(auth(adminToken)).send({
      key: 'app_state',
      value: { projects: [], clients: [], units: [{ id: `u-${P_TERM}`, projectId: P_TERM }] },
    });
    expect(porUnidad.status).toBe(409);

    const porCliente = await request(app).post('/api/sync').set(auth(adminToken)).send({
      key: 'app_state',
      value: { projects: [], clients: [{ id: `c-${P_TERM}`, projectId: P_TERM }], units: [] },
    });
    expect(porCliente.status).toBe(409);
  });

  it('409 si la key es la config de un proyecto terminado', async () => {
    const res = await request(app).post('/api/sync').set(auth(adminToken))
      .send({ key: `project_config_${P_TERM}`, value: { jefeMaxPct: 9 } });
    expect(res.status).toBe(409);
  });

  it('un payload que solo toca proyectos activos pasa', async () => {
    const res = await request(app).post('/api/sync').set(auth(adminToken)).send({
      key: 'app_state',
      value: { projects: [{ id: P_ACTIVO, nombre: 'Proyecto Activo' }], clients: [], units: [] },
    });
    expect(res.status).toBe(200);
  });
});
