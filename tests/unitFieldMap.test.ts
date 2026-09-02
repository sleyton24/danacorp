import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Red de seguridad del guardado de UnitDetail.
 *
 * El PATCH /api/units/:id filtra el body contra UNIT_PATCH_FIELD_MAP y DESCARTA EN
 * SILENCIO todo lo que no está en el mapa: responde 200, el frontend actualiza su estado
 * en memoria y el dato nunca llega a la BD. Así se perdían gastosOperacionales,
 * gastosNotariales y gastosConservador — se editaban en Hitos, "Guardar Cambios" decía
 * que sí, y al reabrir la ficha estaban como antes.
 *
 * Hasta ahora la regla vivía solo en un comentario sobre el mapa. Estos tests la hacen
 * cumplir: cada campo del mapa tiene que sobrevivir un PATCH real y volver en el GET, y
 * todo campo que UnitDetail edite con handleChange() tiene que estar en el mapa.
 */

let app: import('express').Express;
let pool: import('pg').Pool;
let preparedTestDb: import('./test-db').PreparedTestDatabase | undefined;
let UNIT_PATCH_FIELD_MAP: Record<string, string>;

const ADMIN = { email: 'admin@danacorp.cl', password: 'admin123' };
let adminToken = '';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const PROJECT_ID = 'p-fieldmap';

async function crearUnidad(numero: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/units').set(auth(adminToken))
    .send({ projectId: PROJECT_ID, numero, precioLista: 5000, estado: 'Disponible', ...extra });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

async function leerUnidad(unitId: string) {
  const res = await request(app).get('/api/units').set(auth(adminToken));
  expect(res.status).toBe(200);
  const found = (res.body as Array<Record<string, unknown>>).find(u => u.id === unitId);
  expect(found).toBeTruthy();
  return found as Record<string, unknown>;
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
  UNIT_PATCH_FIELD_MAP = srv.UNIT_PATCH_FIELD_MAP;

  adminToken = (await login(ADMIN.email, ADMIN.password)).body.token;
});

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

afterAll(async () => {
  if (pool) await pool.end();
  if (preparedTestDb) {
    const { dropIsolatedTestSchema } = await import('./test-db');
    await dropIsolatedTestSchema(preparedTestDb);
  }
});

/**
 * Un valor por campo del fieldMap, elegido para que el round-trip sea comparable tal cual.
 *
 * Se excluyen a propósito `estado` y `clienteId`: los dos disparan efectos de transición
 * en el PATCH (limpieza de fechas de hito, de la reserva y del descuento) que pisarían al
 * resto del barrido. Su persistencia ya está cubierta por flows.test.ts,
 * reservaApproval.test.ts y proyectoTerminado.test.ts.
 *
 * `formaFinanciamiento` va con 'Financiamiento': con 'Contado' el backend normaliza y
 * vacía todo el bloque de crédito, que es justamente lo que este barrido quiere ver
 * persistido.
 */
const VALORES: Record<string, unknown> = {
  precioLista: 5500, precioVenta: 4987.65,
  pie: 1200.5, pieFormaPago: 'Cuotas', pieCuotas: 24,
  diaPago: 15,
  bonoDescuento: 33.25, reservaMonto: 50,
  reservaFormaPago: 'Contado', reservaCuotas: 3,
  creditoHipotecario: 3800.4, tasaFinanciamiento: 4.35,
  totalPagado: 640.2, saldoPorPagar: 4347.45,
  canalVenta: 'Corredor', intermediario: 'Corredora Ejemplo',
  banco: 'Banco de Prueba', notaria: 'Notaría Centro', repertorio: 'R-2026-99',
  fechaReserva: '2026-01-10', fechaPromesa: '2026-02-11',
  fechaSolicitudCredito: '2026-02-20', fechaAprobacionCredito: '2026-03-05',
  fechaEscritura: '2026-04-01', fechaTerminoPago: '2026-05-02',
  fechaAlzamiento: '2026-06-03', fechaEntrega: '2026-07-04', fechaPago: '2026-05-05',
  facturaNumero: 'F-1234', facturaFecha: '2026-04-15',
  recepcionMunicipalNumero: 'RM-77', recepcionMunicipalFecha: '2026-03-20',
  cbrFojas: '1234', cbrNumero: '567', cbrAno: '2026',
  formaFinanciamiento: 'Financiamiento', plazoCreditoAnios: 25,
  fechaIngresoCBR: '2026-04-10', fechaInscripcionCBR: '2026-04-20',
  observaciones: 'Nota de prueba del barrido de campos',
  descuentoPct: 7.5, descuentoCliente: 7.5,
  descuentoSolicitudId: 'dr-abc-123',
  asignadoPor: 'Vendedor Demo', fechaAsignacion: '2026-01-09',
  ejecutivoId: 'u2',
  gastosOperacionales: 41.5, gastosNotariales: 12.75, gastosConservador: 8.4,
  promesaPct: 3.5, cuotasPct: 12.25, escrituraPct: 4.25, creditoPct: 80,
  promesaOn: true, cuotasOn: true, escrituraOn: false,
};

/** Campos del mapa con efectos de transición: se prueban aparte, no en el barrido. */
const EXCLUIDOS_DEL_BARRIDO = ['estado', 'clienteId'];

describe('PATCH /api/units/:id — todo campo del fieldMap se persiste y vuelve en el GET', () => {
  it('el barrido cubre TODOS los campos del mapa (si alguien agrega uno, hay que darle valor)', () => {
    const sinValor = Object.keys(UNIT_PATCH_FIELD_MAP)
      .filter(k => !EXCLUIDOS_DEL_BARRIDO.includes(k))
      .filter(k => !(k in VALORES));
    expect(sinValor).toEqual([]);
  });

  it('un PATCH con todos los campos los devuelve idénticos en el GET', async () => {
    const unitId = await crearUnidad('FM-101');

    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send(VALORES);
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    const distintos: Array<{ campo: string; esperado: unknown; obtenido: unknown }> = [];
    for (const [campo, esperado] of Object.entries(VALORES)) {
      const obtenido = guardada[campo];
      // Comparación laxa por número: la BD puede devolver 4987.65 como number y el JSON
      // no arrastra la representación original.
      const igual = typeof esperado === 'number'
        ? Math.abs(Number(obtenido) - esperado) < 0.0001
        : obtenido === esperado;
      if (!igual) distintos.push({ campo, esperado, obtenido });
    }
    expect(distintos).toEqual([]);
  });

  // Los tres campos que originaron el reporte: se editan en el bloque Hitos de UnitDetail
  // y hasta ahora el PATCH los tiraba a la basura porque no estaban en el fieldMap.
  it('gastosOperacionales / gastosNotariales / gastosConservador sobreviven al guardado', async () => {
    const unitId = await crearUnidad('FM-GASTOS', {
      gastosOperacionales: 1, gastosNotariales: 2, gastosConservador: 3,
    });

    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ gastosOperacionales: 99.9, gastosNotariales: 55.5, gastosConservador: 11.1 });
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    expect(guardada.gastosOperacionales).toBeCloseTo(99.9, 4);
    expect(guardada.gastosNotariales).toBeCloseTo(55.5, 4);
    expect(guardada.gastosConservador).toBeCloseTo(11.1, 4);
  });

  it('precioVenta guarda el total del cuadro financiero, no el precio de lista', async () => {
    const unitId = await crearUnidad('FM-PRECIO', { precioVenta: 5000 });

    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ precioVenta: 6234.56 });
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    expect(Number(guardada.precioVenta)).toBeCloseTo(6234.56, 4);
  });

  it('la forma de pago se persiste, y null sigue significando "nunca se declaró"', async () => {
    const sinDeclarar = await crearUnidad('FM-FP-NULL');
    const nueva = await leerUnidad(sinDeclarar);
    // Sin declarar: undefined, para que UnitDetail caiga al plan de la cotización y
    // después al default del proyecto en vez de asumir un 0/false que nadie eligió.
    for (const campo of ['promesaPct', 'cuotasPct', 'escrituraPct', 'creditoPct', 'promesaOn', 'cuotasOn', 'escrituraOn']) {
      expect(nueva[campo] ?? null).toBeNull();
    }

    const unitId = await crearUnidad('FM-FP');
    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send({
      promesaPct: 5, cuotasPct: 10, escrituraPct: 5, creditoPct: 80,
      promesaOn: true, cuotasOn: false, escrituraOn: true,
    });
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    expect(Number(guardada.promesaPct)).toBeCloseTo(5, 4);
    expect(Number(guardada.cuotasPct)).toBeCloseTo(10, 4);
    expect(Number(guardada.escrituraPct)).toBeCloseTo(5, 4);
    expect(Number(guardada.creditoPct)).toBeCloseTo(80, 4);
    // false es un valor declarado (componente apagada), NO "sin declarar".
    expect(guardada.promesaOn).toBe(true);
    expect(guardada.cuotasOn).toBe(false);
    expect(guardada.escrituraOn).toBe(true);
  });

  /**
   * Los tres estados de una columna BOOLEAN tienen que llegar distintos al frontend, y
   * este test corre contra Postgres de verdad (schema aislado, ver test-db.ts), no contra
   * un doble. Importa porque promesa_on/cuotas_on/escritura_on pasan por el loop genérico
   * del fieldMap y no por el `? 1 : 0` explícito de descuento_pendiente y aplica_bono_pie:
   * si `false` se degradara a null, UnitDetail lo leería como "nunca se declaró forma de
   * pago" y la cotización volvería a pisar la componente que el usuario apagó a mano.
   */
  it('BOOLEAN en Postgres: true, false y null llegan como tres estados distintos', async () => {
    const unitId = await crearUnidad('FM-BOOL');

    const apagarTodo = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ promesaOn: false, cuotasOn: false, escrituraOn: false });
    expect(apagarTodo.status).toBe(200);

    const conFalse = await leerUnidad(unitId);
    for (const campo of ['promesaOn', 'cuotasOn', 'escrituraOn']) {
      // Tipo booleano real, no 0 ni "f" ni "false": el driver de pg tiene que parsearlo.
      expect(typeof conFalse[campo]).toBe('boolean');
      expect(conFalse[campo]).toBe(false);
      // Y false NO puede pasar por "sin declarar" en el guard de precarga de la cotización.
      expect(conFalse[campo] == null).toBe(false);
    }

    // Volver a null (explícito en el body) tiene que ser posible: es "sin declarar".
    const limpiar = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ promesaOn: null, cuotasOn: null, escrituraOn: null });
    expect(limpiar.status).toBe(200);

    const conNull = await leerUnidad(unitId);
    for (const campo of ['promesaOn', 'cuotasOn', 'escrituraOn']) {
      expect(conNull[campo] ?? null).toBeNull();
    }

    const encender = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ promesaOn: true, cuotasOn: true, escrituraOn: true });
    expect(encender.status).toBe(200);
    const conTrue = await leerUnidad(unitId);
    for (const campo of ['promesaOn', 'cuotasOn', 'escrituraOn']) {
      expect(conTrue[campo]).toBe(true);
    }
  });

  it('declarar solo los interruptores no inventa porcentajes', async () => {
    // El guard hayFormaPagoPersistida de UnitDetail mira los 7 campos, así que un false
    // suelto ya cuenta como "declarada". Los % siguen en null y la UI cae a su default.
    const unitId = await crearUnidad('FM-BOOL-SOLO');
    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ cuotasOn: false });
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    expect(guardada.cuotasOn).toBe(false);
    for (const campo of ['promesaPct', 'cuotasPct', 'escrituraPct', 'creditoPct']) {
      expect(guardada[campo] ?? null).toBeNull();
    }
  });

  it('totalPagado y saldoPorPagar se recalculan desde el cronograma al guardar', async () => {
    // UnitDetail los deriva del plan (Pagado = solo estado 'Pagado'); acá se verifica que
    // el PATCH los acepta y los devuelve, que es lo que después lee el endpoint de sync.
    const unitId = await crearUnidad('FM-TOTALES');
    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken))
      .send({ totalPagado: 230, saldoPorPagar: 770.5 });
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    expect(Number(guardada.totalPagado)).toBeCloseTo(230, 4);
    expect(Number(guardada.saldoPorPagar)).toBeCloseTo(770.5, 4);
  });

  // Campos editables que NO viajan por el fieldMap: el PATCH los serializa a JSON o los
  // normaliza a entero aparte. Si alguien rompe esas ramas, el barrido de arriba no se
  // entera.
  it('los campos editables que se guardan fuera del fieldMap también vuelven', async () => {
    const unitId = await crearUnidad('FM-JSON');
    const planPagos = [
      { uid: 'uid-1', id: 'Promesa', date: '2026-03-01', amount: '150.00', status: 'Pagado', fechaPagoReal: '2026-03-02', observacion: '' },
      { uid: 'uid-2', id: 'Cuota 1', date: '2026-04-01', amount: '80.00', status: 'Pendiente', fechaPagoReal: '', observacion: 'nota' },
    ];
    const patch = await request(app).patch(`/api/units/${unitId}`).set(auth(adminToken)).send({
      bodegas: ['B-1', 'B-2'],
      estacionamientos: ['E-9'],
      planPagos,
      documents: [],
      aplicaBonoPie: true,
      descuentoPendiente: true,
      descuentoCliente: 4,
    });
    expect(patch.status).toBe(200);

    const guardada = await leerUnidad(unitId);
    expect(guardada.bodegas).toEqual(['B-1', 'B-2']);
    expect(guardada.estacionamientos).toEqual(['E-9']);
    expect(guardada.planPagos).toEqual(planPagos);
    expect(guardada.aplicaBonoPie).toBe(true);
    expect(guardada.descuentoPendiente).toBe(true);
  });
});

describe('UnitDetail no puede editar campos que el fieldMap no conoce', () => {
  /**
   * Campos que UnitDetail escribe con setFormData() en vez de handleChange(). No se
   * detectan con una regex confiable (van dentro de objetos literales con spread), así
   * que se listan a mano. Al agregar uno nuevo en el componente, agregarlo acá.
   */
  const EDITABLES_VIA_SET_FORM_DATA = [
    'estado', 'clienteId', 'asignadoPor', 'fechaAsignacion', 'ejecutivoId',
    'precioVenta', 'pie', 'pieCuotas', 'reservaMonto',
    'descuentoPct', 'descuentoCliente', 'descuentoSolicitudId',
    'observaciones', 'formaFinanciamiento', 'diaPago',
    'promesaPct', 'cuotasPct', 'escrituraPct', 'creditoPct',
    'promesaOn', 'cuotasOn', 'escrituraOn',
  ];

  /** Editables que el PATCH resuelve fuera del fieldMap (JSON o normalización a entero). */
  const EDITABLES_FUERA_DEL_FIELDMAP = [
    'bodegas', 'estacionamientos', 'planPagos', 'documents',
    'aplicaBonoPie', 'descuentoPendiente',
  ];

  it('todo campo editado con handleChange() está en el fieldMap', () => {
    const fuente = fs.readFileSync(
      fileURLToPath(new URL('../src/components/UnitDetail.tsx', import.meta.url)), 'utf8',
    );
    const campos = new Set<string>();
    for (const m of fuente.matchAll(/handleChange\(\s*'([A-Za-z0-9_]+)'/g)) campos.add(m[1]);
    // Si esto queda vacío, la regex dejó de matchear y el test ya no protege nada.
    expect(campos.size).toBeGreaterThan(10);

    const conocidos = new Set([...Object.keys(UNIT_PATCH_FIELD_MAP), ...EDITABLES_FUERA_DEL_FIELDMAP]);
    const huerfanos = [...campos].filter(c => !conocidos.has(c));
    expect(huerfanos).toEqual([]);
  });

  it('todo campo editado con setFormData() está en el fieldMap', () => {
    const conocidos = new Set([...Object.keys(UNIT_PATCH_FIELD_MAP), ...EDITABLES_FUERA_DEL_FIELDMAP]);
    const huerfanos = EDITABLES_VIA_SET_FORM_DATA.filter(c => !conocidos.has(c));
    expect(huerfanos).toEqual([]);
  });
});
