import express from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'danacorp_secret_local_2026';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── SQLite (node:sqlite — Node.js 22.5+, sin dependencias nativas) ─────────
const db = new DatabaseSync(path.join(__dirname, 'danacorp.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS quotation_drafts (
    id             TEXT PRIMARY KEY,
    project_id     TEXT,
    user_id        TEXT NOT NULL,
    cliente_rut    TEXT,
    cliente_nombre TEXT,
    data           TEXT NOT NULL DEFAULT '{}',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS discount_requests (
    id                       TEXT PRIMARY KEY,
    project_id               TEXT NOT NULL,
    unit_id                  TEXT NOT NULL,
    unit_numero              TEXT NOT NULL,
    vendedor_id              TEXT NOT NULL,
    vendedor_nombre          TEXT NOT NULL DEFAULT '',
    cotizacion_id            TEXT,
    precio_original          REAL NOT NULL,
    precio_solicitado        REAL NOT NULL,
    descuento_pct            REAL NOT NULL,
    descuento_monto          REAL NOT NULL,
    estado                   TEXT NOT NULL DEFAULT 'Pendiente',
    aprobado_jefe_id         TEXT,
    aprobado_jefe_at         DATETIME,
    aprobado_supervisor_id   TEXT,
    aprobado_supervisor_at   DATETIME,
    rechazado_por_id         TEXT,
    rechazado_por_at         DATETIME,
    rechazo_motivo           TEXT,
    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    para_user_id TEXT,
    para_rol    TEXT,
    titulo      TEXT NOT NULL,
    mensaje     TEXT NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'info',
    leida       INTEGER NOT NULL DEFAULT 0,
    link_view   TEXT,
    related_id  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    fecha_creacion TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_configs (
    id                       TEXT PRIMARY KEY,
    project_id               TEXT NOT NULL,
    jefe_max_pct             REAL NOT NULL DEFAULT 3,
    supervisor_max_pct       REAL NOT NULL DEFAULT 8,
    bono_pie_pct             REAL NOT NULL DEFAULT 10,
    vigencia_cotizacion_dias INTEGER NOT NULL DEFAULT 7,
    reserva_clp              REAL,
    nombre_inmobiliaria      TEXT,
    direccion_proyecto       TEXT,
    comuna_proyecto          TEXT,
    ciudad_proyecto          TEXT,
    cantidad_cuotas_pie      INTEGER,
    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id                         TEXT PRIMARY KEY,
    project_id                 TEXT NOT NULL,
    tipo_persona               TEXT NOT NULL DEFAULT 'Natural',
    nombre                     TEXT NOT NULL,
    rut                        TEXT NOT NULL,
    nacionalidad               TEXT,
    profesion                  TEXT,
    sueldo_range               TEXT,
    fecha_nacimiento           TEXT,
    email                      TEXT NOT NULL DEFAULT '',
    telefono                   TEXT NOT NULL DEFAULT '',
    direccion                  TEXT,
    ciudad                     TEXT,
    comuna                     TEXT,
    region                     TEXT,
    ejecutivo_id               TEXT,
    estado                     TEXT NOT NULL DEFAULT 'Activo',
    fecha_registro             TEXT,
    representante_nombre       TEXT,
    representante_rut          TEXT,
    representante_nacionalidad TEXT,
    representante_email        TEXT,
    representante_telefono     TEXT,
    representante_direccion    TEXT,
    historial                  TEXT NOT NULL DEFAULT '[]',
    documents                  TEXT NOT NULL DEFAULT '[]',
    created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                 DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS units (
    id                         TEXT PRIMARY KEY,
    project_id                 TEXT NOT NULL,
    type                       TEXT NOT NULL DEFAULT 'Departamento',
    numero                     TEXT NOT NULL,
    estado                     TEXT NOT NULL DEFAULT 'Disponible',
    superficie                 REAL,
    orientacion                TEXT,
    piso                       INTEGER,
    dormitorios                INTEGER,
    banos                      INTEGER,
    gasto_comun                REAL,
    gastos_operacionales       REAL,
    gastos_notariales          REAL,
    gastos_conservador         REAL,
    bodegas                    TEXT NOT NULL DEFAULT '[]',
    estacionamientos           TEXT NOT NULL DEFAULT '[]',
    cliente_id                 TEXT,
    asignado_por               TEXT,
    fecha_asignacion           TEXT,
    precio_lista               REAL NOT NULL DEFAULT 0,
    precio_venta               REAL NOT NULL DEFAULT 0,
    pie                        REAL NOT NULL DEFAULT 0,
    pie_forma_pago             TEXT,
    pie_cuotas                 INTEGER,
    bono_descuento             REAL NOT NULL DEFAULT 0,
    reserva_monto              REAL NOT NULL DEFAULT 0,
    reserva_forma_pago         TEXT,
    reserva_cuotas             INTEGER,
    credito_hipotecario        REAL NOT NULL DEFAULT 0,
    tasa_financiamiento        REAL,
    total_pagado               REAL NOT NULL DEFAULT 0,
    saldo_por_pagar            REAL NOT NULL DEFAULT 0,
    canal_venta                TEXT,
    intermediario              TEXT,
    banco                      TEXT,
    notaria                    TEXT,
    repertorio                 TEXT,
    fecha_reserva              TEXT,
    fecha_promesa              TEXT,
    fecha_solicitud_credito    TEXT,
    fecha_aprobacion_credito   TEXT,
    fecha_escritura            TEXT,
    fecha_termino_pago         TEXT,
    fecha_alzamiento           TEXT,
    fecha_entrega              TEXT,
    fecha_pago                 TEXT,
    factura_numero             TEXT,
    factura_fecha              TEXT,
    recepcion_municipal_numero TEXT,
    recepcion_municipal_fecha  TEXT,
    cbr_fojas                  TEXT,
    cbr_numero                 TEXT,
    cbr_ano                    TEXT,
    plan_pagos                 TEXT NOT NULL DEFAULT '[]',
    observaciones              TEXT NOT NULL DEFAULT '',
    documents                  TEXT NOT NULL DEFAULT '[]',
    descuento_pct              REAL,
    descuento_pendiente        INTEGER,
    descuento_solicitud_id     TEXT,
    aplica_bono_pie            INTEGER,
    extras                     TEXT NOT NULL DEFAULT '{}',
    created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                 DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate old discount_requests columns if they exist in older schema
try {
  db.exec(`ALTER TABLE discount_requests ADD COLUMN vendedor_nombre TEXT NOT NULL DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE discount_requests ADD COLUMN aprobado_jefe_id TEXT`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN aprobado_jefe_at DATETIME`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN aprobado_supervisor_id TEXT`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN aprobado_supervisor_at DATETIME`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN rechazado_por_id TEXT`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN rechazado_por_at DATETIME`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN rechazo_motivo TEXT`);
  db.exec(`ALTER TABLE discount_requests ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
} catch { /* already migrated */ }

// Migrate quotation_drafts: add estado/fecha_generada/generada_por columns
try { db.exec(`ALTER TABLE quotation_drafts ADD COLUMN estado TEXT DEFAULT 'borrador'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE quotation_drafts ADD COLUMN fecha_generada TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE quotation_drafts ADD COLUMN generada_por TEXT`); } catch { /* already exists */ }

// Migrate existing NULL estado drafts to 'generada'
db.exec(`UPDATE quotation_drafts SET estado = 'generada', fecha_generada = updated_at, generada_por = user_id WHERE estado IS NULL`);

// ── Helper: upsert unit row ───────────────────────────────────────────────────
function upsertUnit(u: Record<string, unknown>, stableId: string, now: string) {
  db.prepare(`INSERT INTO units (id, project_id, type, numero, estado, superficie, orientacion, piso, dormitorios, banos, gasto_comun, gastos_operacionales, gastos_notariales, gastos_conservador, bodegas, estacionamientos, cliente_id, asignado_por, fecha_asignacion, precio_lista, precio_venta, pie, pie_forma_pago, pie_cuotas, bono_descuento, reserva_monto, reserva_forma_pago, reserva_cuotas, credito_hipotecario, tasa_financiamiento, total_pagado, saldo_por_pagar, canal_venta, intermediario, banco, notaria, repertorio, fecha_reserva, fecha_promesa, fecha_solicitud_credito, fecha_aprobacion_credito, fecha_escritura, fecha_termino_pago, fecha_alzamiento, fecha_entrega, fecha_pago, factura_numero, factura_fecha, recepcion_municipal_numero, recepcion_municipal_fecha, cbr_fojas, cbr_numero, cbr_ano, plan_pagos, observaciones, documents, descuento_pct, descuento_pendiente, descuento_solicitud_id, aplica_bono_pie, extras, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET estado = excluded.estado, precio_venta = excluded.precio_venta, cliente_id = excluded.cliente_id, asignado_por = excluded.asignado_por, fecha_asignacion = excluded.fecha_asignacion, descuento_pct = excluded.descuento_pct, descuento_pendiente = excluded.descuento_pendiente, descuento_solicitud_id = excluded.descuento_solicitud_id, updated_at = excluded.updated_at`
  ).run(
    stableId, (u.projectId as string | undefined) || '',
    (u.type as string | undefined) || 'Departamento',
    (u.numero as string | undefined) || '',
    (u.estado as string | undefined) || 'Disponible',
    (u.superficie as number | undefined) ?? null,
    (u.orientacion as string | undefined) ?? null,
    (u.piso as number | undefined) ?? null,
    (u.dormitorios as number | undefined) ?? null,
    (u.banos as number | undefined) ?? null,
    (u.gastoComun as number | undefined) ?? null,
    (u.gastosOperacionales as number | undefined) ?? null,
    (u.gastosNotariales as number | undefined) ?? null,
    (u.gastosConservador as number | undefined) ?? null,
    JSON.stringify(u.bodegas || []),
    JSON.stringify(u.estacionamientos || []),
    (u.clienteId as string | undefined) ?? null,
    (u.asignadoPor as string | undefined) ?? null,
    (u.fechaAsignacion as string | undefined) ?? null,
    (u.precioLista as number | undefined) || 0,
    (u.precioVenta as number | undefined) || 0,
    (u.pie as number | undefined) || 0,
    (u.pieFormaPago as string | undefined) ?? null,
    (u.pieCuotas as number | undefined) ?? null,
    (u.bonoDescuento as number | undefined) || 0,
    (u.reservaMonto as number | undefined) || 0,
    (u.reservaFormaPago as string | undefined) ?? null,
    (u.reservaCuotas as number | undefined) ?? null,
    (u.creditoHipotecario as number | undefined) || 0,
    (u.tasaFinanciamiento as number | undefined) ?? null,
    (u.totalPagado as number | undefined) || 0,
    (u.saldoPorPagar as number | undefined) || 0,
    (u.canalVenta as string | undefined) ?? null,
    (u.intermediario as string | undefined) ?? null,
    (u.banco as string | undefined) ?? null,
    (u.notaria as string | undefined) ?? null,
    (u.repertorio as string | undefined) ?? null,
    (u.fechaReserva as string | undefined) ?? null,
    (u.fechaPromesa as string | undefined) ?? null,
    (u.fechaSolicitudCredito as string | undefined) ?? null,
    (u.fechaAprobacionCredito as string | undefined) ?? null,
    (u.fechaEscritura as string | undefined) ?? null,
    (u.fechaTerminoPago as string | undefined) ?? null,
    (u.fechaAlzamiento as string | undefined) ?? null,
    (u.fechaEntrega as string | undefined) ?? null,
    (u.fechaPago as string | undefined) ?? null,
    (u.facturaNumero as string | undefined) ?? null,
    (u.facturaFecha as string | undefined) ?? null,
    (u.recepcionMunicipalNumero as string | undefined) ?? null,
    (u.recepcionMunicipalFecha as string | undefined) ?? null,
    (u.cbrFojas as string | undefined) ?? null,
    (u.cbrNumero as string | undefined) ?? null,
    (u.cbrAno as string | undefined) ?? null,
    JSON.stringify(u.planPagos || []),
    (u.observaciones as string | undefined) || '',
    JSON.stringify(u.documents || []),
    (u.descuentoPct as number | undefined) ?? null,
    u.descuentoPendiente ? 1 : 0,
    (u.descuentoSolicitudId as string | undefined) ?? null,
    u.aplicaBonoPie ? 1 : 0,
    '{}', now, now
  );
}

function syncProjectConfigToTable(projectId: string, cfg: Record<string, unknown>, now: string) {
  try {
    const dc = cfg.discountConfig as Record<string, unknown> | undefined;
    const cfgId = `cfg_${projectId}`;
    db.prepare(`INSERT INTO project_configs (id, project_id, jefe_max_pct, supervisor_max_pct, bono_pie_pct, vigencia_cotizacion_dias, reserva_clp, nombre_inmobiliaria, direccion_proyecto, comuna_proyecto, ciudad_proyecto, cantidad_cuotas_pie, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET jefe_max_pct = excluded.jefe_max_pct, supervisor_max_pct = excluded.supervisor_max_pct, bono_pie_pct = excluded.bono_pie_pct, vigencia_cotizacion_dias = excluded.vigencia_cotizacion_dias, reserva_clp = excluded.reserva_clp, nombre_inmobiliaria = excluded.nombre_inmobiliaria, direccion_proyecto = excluded.direccion_proyecto, comuna_proyecto = excluded.comuna_proyecto, ciudad_proyecto = excluded.ciudad_proyecto, cantidad_cuotas_pie = excluded.cantidad_cuotas_pie, updated_at = excluded.updated_at`
    ).run(
      cfgId, projectId,
      (dc?.jefeMaxPct as number | undefined) ?? 3,
      (dc?.supervisorMaxPct as number | undefined) ?? 8,
      (cfg.bonoPiePct as number | undefined) ?? 10,
      (dc?.vigenciaCotizacionDias as number | undefined) ?? 7,
      (cfg.reservaCLP as number | undefined) ?? null,
      (cfg.nombreInmobiliaria as string | undefined) ?? null,
      (cfg.direccionProyecto as string | undefined) ?? null,
      (cfg.comunaProyecto as string | undefined) ?? null,
      (cfg.ciudadProyecto as string | undefined) ?? null,
      (cfg.cantidadCuotasPie as number | undefined) ?? null,
      now, now
    );
  } catch (err) {
    console.error('[syncProjectConfigToTable] Error:', err);
  }
}

function syncAppStateToTables(state: Record<string, unknown>, now: string) {
  try {
    const projects = (state.projects as Array<Record<string, unknown>>) || [];
    const clients = (state.clients as Array<Record<string, unknown>>) || [];
    const units = (state.units as Array<Record<string, unknown>>) || [];

    for (const p of projects) {
      db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, updated_at = excluded.updated_at`
      ).run(p.id as string, (p.nombre as string | undefined) || '', (p.fechaCreacion as string | undefined) || now, now, now);
    }

    for (const c of clients) {
      db.prepare(`INSERT INTO clients (id, project_id, tipo_persona, nombre, rut, nacionalidad, profesion, sueldo_range, fecha_nacimiento, email, telefono, direccion, ciudad, comuna, region, ejecutivo_id, estado, fecha_registro, representante_nombre, representante_rut, representante_nacionalidad, representante_email, representante_telefono, representante_direccion, historial, documents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, rut = excluded.rut, email = excluded.email, telefono = excluded.telefono, estado = excluded.estado, ejecutivo_id = excluded.ejecutivo_id, historial = excluded.historial, documents = excluded.documents, updated_at = excluded.updated_at`
      ).run(
        c.id as string, (c.projectId as string | undefined) || '',
        (c.tipoPersona as string | undefined) || 'Natural',
        (c.nombre as string | undefined) || '', (c.rut as string | undefined) || '',
        (c.nacionalidad as string | undefined) ?? null,
        (c.profesion as string | undefined) ?? null,
        (c.sueldoRange as string | undefined) ?? null,
        (c.fechaNacimiento as string | undefined) ?? null,
        (c.email as string | undefined) || '', (c.telefono as string | undefined) || '',
        (c.direccion as string | undefined) ?? null, (c.ciudad as string | undefined) ?? null,
        (c.comuna as string | undefined) ?? null, (c.region as string | undefined) ?? null,
        (c.ejecutivoId as string | undefined) ?? null,
        (c.estado as string | undefined) || 'Activo',
        (c.fechaRegistro as string | undefined) ?? null,
        (c.representanteNombre as string | undefined) ?? null, (c.representanteRut as string | undefined) ?? null,
        (c.representanteNacionalidad as string | undefined) ?? null, (c.representanteEmail as string | undefined) ?? null,
        (c.representanteTelefono as string | undefined) ?? null, (c.representanteDireccion as string | undefined) ?? null,
        JSON.stringify(c.historial || []), JSON.stringify(c.documents || []),
        now, now
      );
    }

    const unitIdMapping: Record<string, string> = {};
    const mappingRow = db.prepare("SELECT value FROM app_state WHERE key = 'unit_id_mapping'").get() as { value: string } | undefined;
    if (mappingRow) { try { Object.assign(unitIdMapping, JSON.parse(mappingRow.value)); } catch { /* */ } }

    for (const u of units) {
      const origId = u.id as string;
      let stableId = origId;
      if (origId?.startsWith('new-')) {
        if (!unitIdMapping[origId]) { unitIdMapping[origId] = crypto.randomUUID(); }
        stableId = unitIdMapping[origId];
      }
      upsertUnit(u, stableId, now);
    }

    if (Object.keys(unitIdMapping).length > 0) {
      db.prepare("INSERT INTO app_state (key, value) VALUES ('unit_id_mapping', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(unitIdMapping));
    }
  } catch (err) {
    console.error('[syncAppStateToTables] Error:', err);
  }
}

function buildAppStateFromTables(): Record<string, unknown> | null {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  if (projects.length === 0) return null;

  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  const units = db.prepare('SELECT * FROM units ORDER BY numero ASC').all() as Array<Record<string, unknown>>;
  const configs = db.prepare('SELECT * FROM project_configs').all() as Array<Record<string, unknown>>;
  const cfgByProject: Record<string, Record<string, unknown>> = {};
  for (const c of configs) { cfgByProject[c.project_id as string] = c; }

  return {
    projects: projects.map(p => {
      const cfg = cfgByProject[p.id as string];
      return {
        id: p.id, nombre: p.nombre, fechaCreacion: p.fecha_creacion,
        discountConfig: cfg ? {
          jefeMaxPct: cfg.jefe_max_pct, supervisorMaxPct: cfg.supervisor_max_pct,
          bonoPiePct: cfg.bono_pie_pct, vigenciaCotizacionDias: cfg.vigencia_cotizacion_dias,
        } : undefined,
      };
    }),
    clients: clients.map(c => ({
      id: c.id, projectId: c.project_id, tipoPersona: c.tipo_persona,
      nombre: c.nombre, rut: c.rut, nacionalidad: c.nacionalidad,
      profesion: c.profesion, sueldoRange: c.sueldo_range, fechaNacimiento: c.fecha_nacimiento,
      email: c.email, telefono: c.telefono, direccion: c.direccion,
      ciudad: c.ciudad, comuna: c.comuna, region: c.region,
      ejecutivoId: c.ejecutivo_id, estado: c.estado, fechaRegistro: c.fecha_registro,
      representanteNombre: c.representante_nombre, representanteRut: c.representante_rut,
      representanteNacionalidad: c.representante_nacionalidad, representanteEmail: c.representante_email,
      representanteTelefono: c.representante_telefono, representanteDireccion: c.representante_direccion,
      historial: JSON.parse((c.historial as string) || '[]'),
      documents: JSON.parse((c.documents as string) || '[]'),
    })),
    units: units.map(u => ({
      id: u.id, projectId: u.project_id, type: u.type, numero: u.numero, estado: u.estado,
      superficie: u.superficie, orientacion: u.orientacion, piso: u.piso,
      dormitorios: u.dormitorios, banos: u.banos,
      gastoComun: u.gasto_comun, gastosOperacionales: u.gastos_operacionales,
      gastosNotariales: u.gastos_notariales, gastosConservador: u.gastos_conservador,
      bodegas: JSON.parse((u.bodegas as string) || '[]'),
      estacionamientos: JSON.parse((u.estacionamientos as string) || '[]'),
      clienteId: u.cliente_id, asignadoPor: u.asignado_por, fechaAsignacion: u.fecha_asignacion,
      precioLista: u.precio_lista, precioVenta: u.precio_venta, pie: u.pie,
      pieFormaPago: u.pie_forma_pago, pieCuotas: u.pie_cuotas,
      bonoDescuento: u.bono_descuento, reservaMonto: u.reserva_monto,
      reservaFormaPago: u.reserva_forma_pago, reservaCuotas: u.reserva_cuotas,
      creditoHipotecario: u.credito_hipotecario, tasaFinanciamiento: u.tasa_financiamiento,
      totalPagado: u.total_pagado, saldoPorPagar: u.saldo_por_pagar,
      canalVenta: u.canal_venta, intermediario: u.intermediario,
      banco: u.banco, notaria: u.notaria, repertorio: u.repertorio,
      fechaReserva: u.fecha_reserva, fechaPromesa: u.fecha_promesa,
      fechaSolicitudCredito: u.fecha_solicitud_credito, fechaAprobacionCredito: u.fecha_aprobacion_credito,
      fechaEscritura: u.fecha_escritura, fechaTerminoPago: u.fecha_termino_pago,
      fechaAlzamiento: u.fecha_alzamiento, fechaEntrega: u.fecha_entrega, fechaPago: u.fecha_pago,
      facturaNumero: u.factura_numero, facturaFecha: u.factura_fecha,
      recepcionMunicipalNumero: u.recepcion_municipal_numero, recepcionMunicipalFecha: u.recepcion_municipal_fecha,
      cbrFojas: u.cbr_fojas, cbrNumero: u.cbr_numero, cbrAno: u.cbr_ano,
      planPagos: JSON.parse((u.plan_pagos as string) || '[]'),
      observaciones: u.observaciones,
      documents: JSON.parse((u.documents as string) || '[]'),
      descuentoPct: u.descuento_pct, descuentoPendiente: u.descuento_pendiente === 1,
      descuentoSolicitudId: u.descuento_solicitud_id, aplicaBonoPie: u.aplica_bono_pie === 1,
    })),
  };
}

function migrateFromAppState() {
  const flagRow = db.prepare("SELECT value FROM app_state WHERE key = 'migration_v1_complete'").get() as { value: string } | undefined;
  if (flagRow?.value === 'true') {
    console.log('[Migration] v1 already complete, skipping.');
    return;
  }

  const stateRow = db.prepare("SELECT value FROM app_state WHERE key = 'u1:app_state'").get() as { value: string } | undefined;
  if (!stateRow) {
    console.log('[Migration] No u1:app_state blob found, marking v1 complete.');
    db.prepare("INSERT INTO app_state (key, value) VALUES ('migration_v1_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
    return;
  }

  let appState: Record<string, unknown>;
  try { appState = JSON.parse(stateRow.value) as Record<string, unknown>; }
  catch { console.error('[Migration] Failed to parse app_state JSON'); return; }

  const projects = (appState.projects as Array<Record<string, unknown>>) || [];
  const clients = (appState.clients as Array<Record<string, unknown>>) || [];
  const units = (appState.units as Array<Record<string, unknown>>) || [];
  const now = new Date().toISOString();

  console.log(`[Migration] Starting v1: ${projects.length} projects, ${clients.length} clients, ${units.length} units`);

  for (const p of projects) {
    const pid = p.id as string;
    db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(pid, (p.nombre as string | undefined) || '', (p.fechaCreacion as string | undefined) || now, now, now);

    const cfgRow = db.prepare("SELECT value FROM app_state WHERE key = ?").get(`u1:project_config_${pid}`) as { value: string } | undefined;
    if (cfgRow) {
      try { syncProjectConfigToTable(pid, JSON.parse(cfgRow.value) as Record<string, unknown>, now); } catch { /* */ }
    }
  }

  for (const c of clients) {
    db.prepare(`INSERT INTO clients (id, project_id, tipo_persona, nombre, rut, nacionalidad, profesion, sueldo_range, fecha_nacimiento, email, telefono, direccion, ciudad, comuna, region, ejecutivo_id, estado, fecha_registro, representante_nombre, representante_rut, representante_nacionalidad, representante_email, representante_telefono, representante_direccion, historial, documents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(
        c.id as string, (c.projectId as string | undefined) || '',
        (c.tipoPersona as string | undefined) || 'Natural',
        (c.nombre as string | undefined) || '', (c.rut as string | undefined) || '',
        (c.nacionalidad as string | undefined) ?? null,
        (c.profesion as string | undefined) ?? null,
        (c.sueldoRange as string | undefined) ?? null,
        (c.fechaNacimiento as string | undefined) ?? null,
        (c.email as string | undefined) || '', (c.telefono as string | undefined) || '',
        (c.direccion as string | undefined) ?? null, (c.ciudad as string | undefined) ?? null,
        (c.comuna as string | undefined) ?? null, (c.region as string | undefined) ?? null,
        (c.ejecutivoId as string | undefined) ?? null,
        (c.estado as string | undefined) || 'Activo',
        (c.fechaRegistro as string | undefined) ?? null,
        (c.representanteNombre as string | undefined) ?? null, (c.representanteRut as string | undefined) ?? null,
        (c.representanteNacionalidad as string | undefined) ?? null, (c.representanteEmail as string | undefined) ?? null,
        (c.representanteTelefono as string | undefined) ?? null, (c.representanteDireccion as string | undefined) ?? null,
        JSON.stringify(c.historial || []), JSON.stringify(c.documents || []),
        now, now
      );
  }

  const unitIdMapping: Record<string, string> = {};
  const mappingRow = db.prepare("SELECT value FROM app_state WHERE key = 'unit_id_mapping'").get() as { value: string } | undefined;
  if (mappingRow) { try { Object.assign(unitIdMapping, JSON.parse(mappingRow.value)); } catch { /* */ } }

  for (const u of units) {
    const origId = u.id as string;
    let stableId = origId;
    if (origId?.startsWith('new-')) {
      if (!unitIdMapping[origId]) { unitIdMapping[origId] = crypto.randomUUID(); }
      stableId = unitIdMapping[origId];
    }
    upsertUnit(u, stableId, now);
  }

  if (Object.keys(unitIdMapping).length > 0) {
    db.prepare("INSERT INTO app_state (key, value) VALUES ('unit_id_mapping', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(unitIdMapping));
  }

  db.prepare("INSERT INTO app_state (key, value) VALUES ('migration_v1_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
  console.log(`[Migration] ✓ v1 complete: ${projects.length} projects, ${clients.length} clients, ${units.length} units`);
}

migrateFromAppState();

// ── UF Cache ────────────────────────────────────────────────────────────────
let ufCache: { value: number; fecha: string; cachedAt: number } | null = null;
const UF_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// ── Usuarios hardcodeados (nunca en el frontend) ────────────────────────────
const USERS = [
  { id: 'u1', name: 'Administrador Principal', email: 'admin@danacorp.cl',       password: 'admin123',       role: 'Admin',      company: 'Danacorp',        assignedProjectIds: [] },
  { id: 'u3', name: 'Jefe de Sala',            email: 'jefe@danacorp.cl',        password: 'jefe123',        role: 'JefeSala',   company: 'Sala de Ventas',  assignedProjectIds: ['p1'] },
  { id: 'u5', name: 'Supervisor Demo',          email: 'supervisor@danacorp.cl',  password: 'supervisor123',  role: 'Supervisor', company: 'Danacorp',        assignedProjectIds: ['p1'] },
  { id: 'u2', name: 'Vendedor Demo',            email: 'vendedor@danacorp.cl',    password: 'vendedor123',    role: 'Ventas',     company: 'Danacorp Ventas', assignedProjectIds: ['p1'] },
  { id: 'u4', name: 'Solo Lectura',             email: 'lectura@danacorp.cl',     password: 'lectura123',     role: 'Lectura',    company: 'Danacorp',        assignedProjectIds: [] },
] as const;

type AuthenticatedRequest = express.Request & { userId: string; userRole: string };

// ── Auth Middleware ─────────────────────────────────────────────────────────
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: string; role: string };
    (req as AuthenticatedRequest).userId = payload.userId;
    (req as AuthenticatedRequest).userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. GET /api/uf-hoy ──────────────────────────────────────────────────────
app.get('/api/uf-hoy', async (_req, res) => {
  if (ufCache && Date.now() - ufCache.cachedAt < UF_CACHE_TTL_MS) {
    res.json({ uf: ufCache.value, fecha: ufCache.fecha });
    return;
  }
  try {
    const r = await fetch('https://mindicador.cl/api/uf');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as Record<string, unknown>;
    const serie = data.serie as Array<{ valor: number; fecha: string }> | undefined;
    const valor: number = serie?.[0]?.valor ?? (data.valor as number);
    const fecha: string = serie?.[0]?.fecha ?? new Date().toISOString();
    ufCache = { value: valor, fecha, cachedAt: Date.now() };
    res.json({ uf: valor, fecha });
  } catch {
    if (ufCache) {
      res.json({ uf: ufCache.value, fecha: ufCache.fecha, cached: true });
      return;
    }
    res.status(503).json({ error: 'Servicio UF no disponible temporalmente' });
  }
});

// ── 2. POST /api/auth/login ──────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = USERS.find(u => u.email === email && u.password === password);
  if (!user) {
    res.status(401).json({ error: 'Credenciales incorrectas' });
    return;
  }
  const { password: _pw, ...userWithoutPassword } = user;
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: userWithoutPassword });
});

// ── 3. GET /api/me ───────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const user = USERS.find(u => u.id === userId);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }
  const { password: _pw, ...userWithoutPassword } = user;
  res.json({ user: userWithoutPassword });
});

// ── 4. Borradores de Cotización ──────────────────────────────────────────────

app.post('/api/quotation-drafts', requireAuth, (req, res) => {
  const { id, projectId, clienteRut, clienteNombre, ...rest } = req.body as Record<string, unknown>;
  const userId = (req as AuthenticatedRequest).userId;
  const draftId = (id as string) || crypto.randomUUID();
  const now = new Date().toISOString();
  const data = JSON.stringify({ projectId, clienteRut, clienteNombre, ...rest });

  db.prepare(`
    INSERT INTO quotation_drafts (id, project_id, user_id, cliente_rut, cliente_nombre, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data           = excluded.data,
      cliente_rut    = excluded.cliente_rut,
      cliente_nombre = excluded.cliente_nombre,
      updated_at     = excluded.updated_at
  `).run(draftId, (projectId as string) || null, userId, (clienteRut as string) || null, (clienteNombre as string) || null, data, now, now);

  res.json({ id: draftId, projectId, clienteRut, clienteNombre, updatedAt: now });
});

app.get('/api/quotation-drafts', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;

  let rows: Array<Record<string, unknown>>;
  if (userRole === 'Admin' || userRole === 'Supervisor') {
    rows = db.prepare(
      'SELECT * FROM quotation_drafts ORDER BY updated_at DESC'
    ).all() as Array<Record<string, unknown>>;
  } else if (userRole === 'JefeSala') {
    const jefe = USERS.find(u => u.id === userId);
    const projectIds = (jefe?.assignedProjectIds ?? []) as readonly string[];
    if (projectIds.length === 0) {
      rows = db.prepare(
        'SELECT * FROM quotation_drafts WHERE user_id = ? ORDER BY updated_at DESC'
      ).all(userId) as Array<Record<string, unknown>>;
    } else {
      const placeholders = projectIds.map(() => '?').join(',');
      rows = db.prepare(
        `SELECT * FROM quotation_drafts WHERE project_id IN (${placeholders}) ORDER BY updated_at DESC`
      ).all(...(projectIds as string[])) as Array<Record<string, unknown>>;
    }
  } else {
    rows = db.prepare(
      'SELECT * FROM quotation_drafts WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId) as Array<Record<string, unknown>>;
  }

  res.json(rows.map(r => ({
    ...r,
    data: JSON.parse((r.data as string) || '{}'),
  })));
});

app.delete('/api/quotation-drafts/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const result = db.prepare(
    'DELETE FROM quotation_drafts WHERE id = ? AND user_id = ?'
  ).run(req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Borrador no encontrado o sin permisos' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/quotation-drafts/:id/generate', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { vendedorId } = req.body as { vendedorId?: string };
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE quotation_drafts SET estado = 'generada', fecha_generada = ?, generada_por = ? WHERE id = ? AND user_id = ?`
  ).run(now, vendedorId ?? userId, req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Borrador no encontrado o sin permisos' });
    return;
  }
  res.json({ ok: true, fechaGenerada: now });
});

// Stub para compatibilidad con Quoter.tsx
app.get('/api/quotation-drafts/:id/check-approvals', requireAuth, (_req, res) => {
  res.json({ pending: [], rejected: [] });
});

// ── Helper: Notification factory ─────────────────────────────────────────────
function createNotification(opts: {
  paraUserId?: string;
  paraRol?: string;
  titulo: string;
  mensaje: string;
  tipo?: 'info' | 'success' | 'warning' | 'error';
  linkView?: string;
  relatedId?: string;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, para_user_id, para_rol, titulo, mensaje, tipo, leida, link_view, related_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    id,
    opts.paraUserId || null,
    opts.paraRol || null,
    opts.titulo,
    opts.mensaje,
    opts.tipo || 'info',
    opts.linkView || null,
    opts.relatedId || null,
    now,
  );
  return id;
}

// Helper: Get project discount config — real table first, fall back to app_state blob
function getProjectDiscountConfig(projectId: string): {
  jefeMaxPct: number; supervisorMaxPct: number; bonoPiePct: number; vigenciaCotizacionDias: number;
} {
  const cfgRow = db.prepare('SELECT * FROM project_configs WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
  if (cfgRow) {
    return {
      jefeMaxPct: (cfgRow.jefe_max_pct as number | undefined) ?? 3,
      supervisorMaxPct: (cfgRow.supervisor_max_pct as number | undefined) ?? 8,
      bonoPiePct: (cfgRow.bono_pie_pct as number | undefined) ?? 10,
      vigenciaCotizacionDias: (cfgRow.vigencia_cotizacion_dias as number | undefined) ?? 7,
    };
  }
  // Fall back to app_state blob
  const adminRows = db.prepare(`SELECT key, value FROM app_state WHERE key LIKE '%project_config_${projectId}'`)
    .all() as Array<{ key: string; value: string }>;
  if (adminRows.length > 0) {
    try {
      const cfg = JSON.parse(adminRows[0].value) as { discountConfig?: { jefeMaxPct?: number; supervisorMaxPct?: number }; bonoPiePct?: number; vigenciaCotizacionDias?: number };
      return {
        jefeMaxPct: cfg.discountConfig?.jefeMaxPct ?? 3,
        supervisorMaxPct: cfg.discountConfig?.supervisorMaxPct ?? 8,
        bonoPiePct: cfg.bonoPiePct ?? 10,
        vigenciaCotizacionDias: cfg.vigenciaCotizacionDias ?? 7,
      };
    } catch { /* fall through */ }
  }
  return { jefeMaxPct: 3, supervisorMaxPct: 8, bonoPiePct: 10, vigenciaCotizacionDias: 7 };
}

// ── 5. Solicitudes de Descuento ──────────────────────────────────────────────

// Create discount request
app.post('/api/discount-requests', requireAuth, (req, res) => {
  const {
    projectId, unitId, unitNumero,
    precioOriginal, precioSolicitado,
    descuentoPct, descuentoMonto, cotizacionId,
  } = req.body as Record<string, unknown>;
  const userId = (req as AuthenticatedRequest).userId;
  const user = USERS.find(u => u.id === userId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO discount_requests
      (id, project_id, unit_id, unit_numero, vendedor_id, vendedor_nombre,
       cotizacion_id, precio_original, precio_solicitado, descuento_pct,
       descuento_monto, estado, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
  `).run(id, projectId, unitId, unitNumero, userId, user?.name || '',
         (cotizacionId as string) || null,
         precioOriginal, precioSolicitado, descuentoPct, descuentoMonto, now, now);

  // Notify JefeSala
  createNotification({
    paraRol: 'JefeSala',
    titulo: 'Nueva solicitud de descuento',
    mensaje: `${user?.name || 'Vendedor'} solicita ${(descuentoPct as number).toFixed(1)}% descuento en unidad ${unitNumero}`,
    tipo: 'warning',
    linkView: 'approvals',
    relatedId: id,
  });

  res.json({ id, estado: 'Pendiente', projectId, unitId, createdAt: now });
});

// Get pending requests (filtered by role)
app.get('/api/discount-requests/pending', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;

  let rows: unknown[];
  if (userRole === 'Admin') {
    rows = db.prepare(
      `SELECT * FROM discount_requests WHERE estado NOT IN ('Cancelado') ORDER BY created_at DESC`
    ).all();
  } else if (userRole === 'JefeSala') {
    rows = db.prepare(
      `SELECT * FROM discount_requests WHERE estado = 'Pendiente' ORDER BY created_at DESC`
    ).all();
  } else if (userRole === 'Supervisor') {
    rows = db.prepare(
      `SELECT * FROM discount_requests WHERE estado = 'AprobadoJefe' ORDER BY created_at DESC`
    ).all();
  } else {
    // Ventas: only own requests
    rows = db.prepare(
      `SELECT * FROM discount_requests WHERE vendedor_id = ? ORDER BY created_at DESC`
    ).all(userId);
  }

  res.json(rows);
});

// Get single discount request
app.get('/api/discount-requests/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'No encontrado' }); return; }
  res.json(row);
});

// Approve discount request
app.post('/api/discount-requests/:id/approve', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const { motivo } = req.body as { motivo?: string };
  const now = new Date().toISOString();

  const dr = db.prepare('SELECT * FROM discount_requests WHERE id = ?')
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!dr) { res.status(404).json({ error: 'Solicitud no encontrada' }); return; }

  if (!['JefeSala', 'Supervisor', 'Admin'].includes(userRole)) {
    res.status(403).json({ error: 'Sin permisos para aprobar' }); return;
  }

  const fullCfg = getProjectDiscountConfig(dr.project_id as string);
  const discountCfg = { jefeMaxPct: fullCfg.jefeMaxPct, supervisorMaxPct: fullCfg.supervisorMaxPct };

  const descuentoPct = dr.descuento_pct as number;
  let newEstado = '';

  if (userRole === 'Admin') {
    newEstado = 'Aprobado';
    db.prepare(`
      UPDATE discount_requests SET estado = 'Aprobado',
        aprobado_supervisor_id = ?, aprobado_supervisor_at = ?, updated_at = ?
      WHERE id = ?
    `).run(userId, now, now, req.params.id);

  } else if (userRole === 'JefeSala') {
    if (descuentoPct <= discountCfg.jefeMaxPct) {
      // Banda 1: JefeSala aprueba directamente
      newEstado = 'Aprobado';
      db.prepare(`
        UPDATE discount_requests SET estado = 'Aprobado',
          aprobado_jefe_id = ?, aprobado_jefe_at = ?, updated_at = ?
        WHERE id = ?
      `).run(userId, now, now, req.params.id);
    } else if (descuentoPct <= discountCfg.supervisorMaxPct) {
      // Banda 2: pasa a Supervisor
      newEstado = 'AprobadoJefe';
      db.prepare(`
        UPDATE discount_requests SET estado = 'AprobadoJefe',
          aprobado_jefe_id = ?, aprobado_jefe_at = ?, updated_at = ?
        WHERE id = ?
      `).run(userId, now, now, req.params.id);
      // Notify supervisors
      createNotification({
        paraRol: 'Supervisor',
        titulo: 'Solicitud visada por Jefe — requiere aprobación',
        mensaje: `Descuento ${descuentoPct.toFixed(1)}% en unidad ${dr.unit_numero} visado por JefeSala. Pendiente tu aprobación.`,
        tipo: 'warning',
        linkView: 'approvals',
        relatedId: req.params.id,
      });
    } else {
      res.status(400).json({ error: 'Descuento supera el límite permitido para este rol' });
      return;
    }

  } else if (userRole === 'Supervisor') {
    if (dr.estado !== 'AprobadoJefe') {
      res.status(400).json({ error: 'La solicitud debe estar en estado AprobadoJefe' });
      return;
    }
    newEstado = 'Aprobado';
    db.prepare(`
      UPDATE discount_requests SET estado = 'Aprobado',
        aprobado_supervisor_id = ?, aprobado_supervisor_at = ?, updated_at = ?
      WHERE id = ?
    `).run(userId, now, now, req.params.id);
  }

  if (newEstado === 'Aprobado') {
    // Notify vendedor
    createNotification({
      paraUserId: dr.vendedor_id as string,
      titulo: '✓ Descuento aprobado',
      mensaje: `Tu solicitud de ${descuentoPct.toFixed(1)}% descuento en unidad ${dr.unit_numero} fue aprobada.`,
      tipo: 'success',
      linkView: 'quoter',
      relatedId: req.params.id,
    });
  }

  const updated = db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(req.params.id);
  res.json({ ok: true, estado: newEstado || dr.estado, dr: updated });
});

// Reject discount request
app.post('/api/discount-requests/:id/reject', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const { motivo } = req.body as { motivo?: string };
  const now = new Date().toISOString();

  if (!['JefeSala', 'Supervisor', 'Admin'].includes(userRole)) {
    res.status(403).json({ error: 'Sin permisos para rechazar' }); return;
  }

  const dr = db.prepare('SELECT * FROM discount_requests WHERE id = ?')
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!dr) { res.status(404).json({ error: 'No encontrado' }); return; }

  db.prepare(`
    UPDATE discount_requests SET estado = 'Rechazado',
      rechazado_por_id = ?, rechazado_por_at = ?, rechazo_motivo = ?, updated_at = ?
    WHERE id = ?
  `).run(userId, now, motivo || '', now, req.params.id);

  // Notify vendedor
  createNotification({
    paraUserId: dr.vendedor_id as string,
    titulo: '✗ Descuento rechazado',
    mensaje: `Tu solicitud de descuento en unidad ${dr.unit_numero} fue rechazada.${motivo ? ` Motivo: ${motivo}` : ''}`,
    tipo: 'error',
    linkView: 'quoter',
    relatedId: req.params.id,
  });

  res.json({ ok: true });
});

// Cancel discount request (vendedor only)
app.post('/api/discount-requests/:id/cancel', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE discount_requests SET estado = 'Cancelado', updated_at = ? WHERE id = ? AND vendedor_id = ?`
  ).run(now, req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'No encontrado o sin permisos' }); return;
  }
  res.json({ ok: true });
});

// ── 5b. Notificaciones ────────────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;

  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE (para_user_id = ? OR para_rol = ? OR para_rol = 'All')
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId, userRole);

  res.json(rows);
});

app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET leida = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  db.prepare(`
    UPDATE notifications SET leida = 1
    WHERE para_user_id = ? OR para_rol = ? OR para_rol = 'All'
  `).run(userId, userRole);
  res.json({ ok: true });
});

// ── 6. Documentos de Cotización ──────────────────────────────────────────────

app.post('/api/quotations/documents', requireAuth, (req, res) => {
  const { client_rut, client_name, project_name, file_name, created_by } =
    req.query as Record<string, string>;

  const dateFolder = new Date().toISOString().split('T')[0];
  const uploadDir = path.join(__dirname, 'uploads', 'quotations', dateFolder);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const safeFileName = (file_name || `doc_${Date.now()}.pdf`)
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(uploadDir, safeFileName);

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      fs.writeFileSync(filePath, Buffer.concat(chunks));
      res.json({
        url: `/uploads/quotations/${dateFolder}/${safeFileName}`,
        clientRut: client_rut,
        clientName: client_name,
        projectName: project_name,
        createdBy: created_by,
      });
    } catch {
      res.status(500).json({ error: 'Error al escribir archivo' });
    }
  });
  req.on('error', () => res.status(500).json({ error: 'Error al recibir archivo' }));
});

// ── 7. Email (stub) ──────────────────────────────────────────────────────────
app.post('/api/quotations/send-email', requireAuth, (req, res) => {
  const { to, clientName, projectName, fileName } = req.body as Record<string, string>;
  // TODO: configurar SMTP con Nodemailer
  // import nodemailer from 'nodemailer';
  // const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, ... });
  console.log(`[EMAIL STUB] Para: ${to} | Cliente: ${clientName} | Proyecto: ${projectName} | Archivo: ${fileName}`);
  res.json({ ok: true, message: 'Email en cola (SMTP no configurado)' });
});

// ── 8. Projects ──────────────────────────────────────────────────────────────

app.get('/api/projects', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, pc.id as config_id, pc.jefe_max_pct, pc.supervisor_max_pct, pc.bono_pie_pct,
      pc.vigencia_cotizacion_dias, pc.reserva_clp, pc.nombre_inmobiliaria,
      pc.direccion_proyecto, pc.comuna_proyecto, pc.ciudad_proyecto, pc.cantidad_cuotas_pie
    FROM projects p
    LEFT JOIN project_configs pc ON pc.project_id = p.id
    ORDER BY p.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  res.json(rows);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (userRole !== 'Admin') { res.status(403).json({ error: 'Solo Admin puede crear proyectos' }); return; }
  const { id, nombre, fechaCreacion } = req.body as Record<string, string>;
  const now = new Date().toISOString();
  const pid = id || crypto.randomUUID();
  db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, updated_at = excluded.updated_at`)
    .run(pid, nombre, fechaCreacion || now, now, now);
  res.json({ id: pid, nombre, fechaCreacion: fechaCreacion || now });
});

app.patch('/api/projects/:id', requireAuth, (req, res) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (userRole !== 'Admin') { res.status(403).json({ error: 'Solo Admin puede editar proyectos' }); return; }
  const { nombre } = req.body as { nombre: string };
  const now = new Date().toISOString();
  db.prepare('UPDATE projects SET nombre = ?, updated_at = ? WHERE id = ?').run(nombre, now, req.params.id);
  res.json({ ok: true });
});

app.get('/api/projects/:id/config', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM project_configs WHERE project_id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) { res.status(404).json({ error: 'Config no encontrada' }); return; }
  res.json(row);
});

app.post('/api/projects/:id/config', requireAuth, (req, res) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (userRole !== 'Admin') { res.status(403).json({ error: 'Solo Admin puede configurar proyectos' }); return; }
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  syncProjectConfigToTable(req.params.id, body, now);
  res.json({ ok: true });
});

// ── 9. Clients ────────────────────────────────────────────────────────────────

app.get('/api/clients', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const { projectId, estado, ejecutivoId } = req.query as Record<string, string>;

  let sql = 'SELECT * FROM clients WHERE 1=1';
  const params: Array<string | number | null> = [];

  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  if (userRole === 'Ventas') {
    sql += ' AND ejecutivo_id = ?'; params.push(userId);
  } else if (ejecutivoId) {
    sql += ' AND ejecutivo_id = ?'; params.push(ejecutivoId);
  }
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    ...r,
    historial: JSON.parse((r.historial as string) || '[]'),
    documents: JSON.parse((r.documents as string) || '[]'),
  })));
});

app.post('/api/clients', requireAuth, (req, res) => {
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = (body.id as string | undefined) || crypto.randomUUID();
  db.prepare(`INSERT INTO clients (id, project_id, tipo_persona, nombre, rut, nacionalidad, profesion, sueldo_range, fecha_nacimiento, email, telefono, direccion, ciudad, comuna, region, ejecutivo_id, estado, fecha_registro, representante_nombre, representante_rut, representante_nacionalidad, representante_email, representante_telefono, representante_direccion, historial, documents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, rut = excluded.rut, email = excluded.email, telefono = excluded.telefono, estado = excluded.estado, ejecutivo_id = excluded.ejecutivo_id, historial = excluded.historial, documents = excluded.documents, updated_at = excluded.updated_at`)
    .run(
      id, (body.projectId as string | undefined) || '',
      (body.tipoPersona as string | undefined) || 'Natural',
      (body.nombre as string | undefined) || '', (body.rut as string | undefined) || '',
      (body.nacionalidad as string | undefined) ?? null, (body.profesion as string | undefined) ?? null,
      (body.sueldoRange as string | undefined) ?? null, (body.fechaNacimiento as string | undefined) ?? null,
      (body.email as string | undefined) || '', (body.telefono as string | undefined) || '',
      (body.direccion as string | undefined) ?? null, (body.ciudad as string | undefined) ?? null,
      (body.comuna as string | undefined) ?? null, (body.region as string | undefined) ?? null,
      (body.ejecutivoId as string | undefined) ?? null,
      (body.estado as string | undefined) || 'Activo',
      (body.fechaRegistro as string | undefined) ?? now,
      (body.representanteNombre as string | undefined) ?? null, (body.representanteRut as string | undefined) ?? null,
      (body.representanteNacionalidad as string | undefined) ?? null, (body.representanteEmail as string | undefined) ?? null,
      (body.representanteTelefono as string | undefined) ?? null, (body.representanteDireccion as string | undefined) ?? null,
      JSON.stringify(body.historial || []), JSON.stringify(body.documents || []),
      now, now
    );
  res.json({ id, ...body });
});

app.patch('/api/clients/:id', requireAuth, (req, res) => {
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }

  db.prepare(`UPDATE clients SET tipo_persona = ?, nombre = ?, rut = ?, nacionalidad = ?, profesion = ?, sueldo_range = ?,
    fecha_nacimiento = ?, email = ?, telefono = ?, direccion = ?, ciudad = ?, comuna = ?, region = ?,
    ejecutivo_id = ?, estado = ?, representante_nombre = ?, representante_rut = ?,
    representante_nacionalidad = ?, representante_email = ?, representante_telefono = ?,
    representante_direccion = ?, historial = ?, documents = ?, updated_at = ? WHERE id = ?`)
    .run(
      (body.tipoPersona as string | undefined) ?? existing.tipo_persona,
      (body.nombre as string | undefined) ?? existing.nombre,
      (body.rut as string | undefined) ?? existing.rut,
      (body.nacionalidad as string | undefined) ?? existing.nacionalidad,
      (body.profesion as string | undefined) ?? existing.profesion,
      (body.sueldoRange as string | undefined) ?? existing.sueldo_range,
      (body.fechaNacimiento as string | undefined) ?? existing.fecha_nacimiento,
      (body.email as string | undefined) ?? existing.email,
      (body.telefono as string | undefined) ?? existing.telefono,
      (body.direccion as string | undefined) ?? existing.direccion,
      (body.ciudad as string | undefined) ?? existing.ciudad,
      (body.comuna as string | undefined) ?? existing.comuna,
      (body.region as string | undefined) ?? existing.region,
      (body.ejecutivoId as string | undefined) ?? existing.ejecutivo_id,
      (body.estado as string | undefined) ?? existing.estado,
      (body.representanteNombre as string | undefined) ?? existing.representante_nombre,
      (body.representanteRut as string | undefined) ?? existing.representante_rut,
      (body.representanteNacionalidad as string | undefined) ?? existing.representante_nacionalidad,
      (body.representanteEmail as string | undefined) ?? existing.representante_email,
      (body.representanteTelefono as string | undefined) ?? existing.representante_telefono,
      (body.representanteDireccion as string | undefined) ?? existing.representante_direccion,
      body.historial ? JSON.stringify(body.historial) : existing.historial as string,
      body.documents ? JSON.stringify(body.documents) : existing.documents as string,
      now, req.params.id
    );
  res.json({ ok: true });
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (!['Admin', 'Supervisor'].includes(userRole)) { res.status(403).json({ error: 'Sin permisos' }); return; }
  const result = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }
  res.json({ ok: true });
});

// ── 10. Units ─────────────────────────────────────────────────────────────────

app.get('/api/units', requireAuth, (req, res) => {
  const { projectId, estado, type } = req.query as Record<string, string>;
  let sql = 'SELECT * FROM units WHERE 1=1';
  const params: Array<string | number | null> = [];
  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY numero ASC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    ...r,
    bodegas: JSON.parse((r.bodegas as string) || '[]'),
    estacionamientos: JSON.parse((r.estacionamientos as string) || '[]'),
    planPagos: JSON.parse((r.plan_pagos as string) || '[]'),
    documents: JSON.parse((r.documents as string) || '[]'),
    descuentoPendiente: r.descuento_pendiente === 1,
    aplicaBonoPie: r.aplica_bono_pie === 1,
  })));
});

app.post('/api/units', requireAuth, (req, res) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (!['Admin', 'Supervisor', 'JefeSala'].includes(userRole)) { res.status(403).json({ error: 'Sin permisos' }); return; }
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = (body.id as string | undefined) || crypto.randomUUID();
  upsertUnit(body, id, now);
  res.json({ id, ...body });
});

app.patch('/api/units/:id', requireAuth, (req, res) => {
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }

  const updates: string[] = [];
  const params: Array<string | number | null> = [];

  const fieldMap: Record<string, string> = {
    estado: 'estado', precioLista: 'precio_lista', precioVenta: 'precio_venta',
    pie: 'pie', pieFormaPago: 'pie_forma_pago', pieCuotas: 'pie_cuotas',
    bonoDescuento: 'bono_descuento', reservaMonto: 'reserva_monto',
    reservaFormaPago: 'reserva_forma_pago', reservaCuotas: 'reserva_cuotas',
    creditoHipotecario: 'credito_hipotecario', tasaFinanciamiento: 'tasa_financiamiento',
    totalPagado: 'total_pagado', saldoPorPagar: 'saldo_por_pagar',
    canalVenta: 'canal_venta', intermediario: 'intermediario',
    banco: 'banco', notaria: 'notaria', repertorio: 'repertorio',
    fechaReserva: 'fecha_reserva', fechaPromesa: 'fecha_promesa',
    fechaSolicitudCredito: 'fecha_solicitud_credito', fechaAprobacionCredito: 'fecha_aprobacion_credito',
    fechaEscritura: 'fecha_escritura', fechaTerminoPago: 'fecha_termino_pago',
    fechaAlzamiento: 'fecha_alzamiento', fechaEntrega: 'fecha_entrega', fechaPago: 'fecha_pago',
    facturaNumero: 'factura_numero', facturaFecha: 'factura_fecha',
    recepcionMunicipalNumero: 'recepcion_municipal_numero', recepcionMunicipalFecha: 'recepcion_municipal_fecha',
    cbrFojas: 'cbr_fojas', cbrNumero: 'cbr_numero', cbrAno: 'cbr_ano',
    observaciones: 'observaciones', descuentoPct: 'descuento_pct',
    descuentoSolicitudId: 'descuento_solicitud_id', clienteId: 'cliente_id',
    asignadoPor: 'asignado_por', fechaAsignacion: 'fecha_asignacion',
  };

  for (const [jsKey, sqlCol] of Object.entries(fieldMap)) {
    if (jsKey in body) { updates.push(`${sqlCol} = ?`); params.push((body[jsKey] as string | number | null) ?? null); }
  }
  if ('descuentoPendiente' in body) { updates.push('descuento_pendiente = ?'); params.push(body.descuentoPendiente ? 1 : 0); }
  if ('aplicaBonoPie' in body) { updates.push('aplica_bono_pie = ?'); params.push(body.aplicaBonoPie ? 1 : 0); }
  if ('bodegas' in body) { updates.push('bodegas = ?'); params.push(JSON.stringify(body.bodegas)); }
  if ('estacionamientos' in body) { updates.push('estacionamientos = ?'); params.push(JSON.stringify(body.estacionamientos)); }
  if ('planPagos' in body) { updates.push('plan_pagos = ?'); params.push(JSON.stringify(body.planPagos)); }
  if ('documents' in body) { updates.push('documents = ?'); params.push(JSON.stringify(body.documents)); }

  if (updates.length === 0) { res.json({ ok: true }); return; }
  updates.push('updated_at = ?'); params.push(now); params.push(req.params.id);
  db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

app.patch('/api/units/:id/assign', requireAuth, (req, res) => {
  const { clienteId, asignadoPor } = req.body as { clienteId: string; asignadoPor?: string };
  const userId = (req as AuthenticatedRequest).userId;
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE units SET cliente_id = ?, asignado_por = ?, fecha_asignacion = ?, estado = 'Asignado', updated_at = ? WHERE id = ?`)
    .run(clienteId, asignadoPor || userId, now, now, req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
  res.json({ ok: true });
});

app.patch('/api/units/:id/unassign', requireAuth, (req, res) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (!['Admin', 'Supervisor', 'JefeSala'].includes(userRole)) { res.status(403).json({ error: 'Sin permisos' }); return; }
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE units SET cliente_id = NULL, asignado_por = NULL, fecha_asignacion = NULL, estado = 'Disponible', updated_at = ? WHERE id = ?`)
    .run(now, req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
  res.json({ ok: true });
});

// ── 11. Sincronización de Estado ─────────────────────────────────────────────

app.post('/api/sync', requireAuth, (req, res) => {
  const { key, value } = req.body as { key: string; value: unknown };
  if (!key) { res.status(400).json({ error: 'Key requerida' }); return; }
  const userId = (req as AuthenticatedRequest).userId;
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(`${userId}:${key}`, JSON.stringify(value), now);

  if (key === 'app_state') {
    syncAppStateToTables(value as Record<string, unknown>, now);
  } else if (key.startsWith('project_config_')) {
    const projectId = key.replace('project_config_', '');
    syncProjectConfigToTable(projectId, value as Record<string, unknown>, now);
  }

  res.json({ ok: true });
});

app.get('/api/sync/:key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (req.params.key === 'app_state') {
    const fromTables = buildAppStateFromTables();
    if (fromTables) {
      res.json({ key: 'app_state', value: fromTables, updatedAt: new Date().toISOString() });
      return;
    }
  }

  const row = db.prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .get(`${userId}:${req.params.key}`) as { value: string; updated_at: string } | undefined;
  if (!row) { res.status(404).json({ error: 'No encontrado' }); return; }
  res.json({ key: req.params.key, value: JSON.parse(row.value), updatedAt: row.updated_at });
});

// ── Arranque ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[DanaWorks Server] ✓ Escuchando en http://localhost:${PORT}`);
  console.log(`[DanaWorks Server] ✓ BD: ${path.join(__dirname, 'danacorp.db')}`);
  console.log(`[DanaWorks Server] ✓ CORS: ${FRONTEND_URL}\n`);
});
