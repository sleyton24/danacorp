import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import 'dotenv/config';
import { db, withTx, ping, pool } from './db';
import { extractTransactionData } from './ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ¿El módulo se ejecuta directamente (prod/dev) o se importa (tests)? Cuando se
// importa para testear, NO se debe bindear el puerto ni arrancar los crons.
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error('[FATAL] JWT_SECRET no está definido en .env');
    console.error('Agregar JWT_SECRET=<valor-secreto-32-chars-min> al archivo .env');
    process.exit(1);
  }
  return s;
})();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';
// Carpeta de uploads: configurable para apuntarla a un volumen persistente en el VPS
// (fuera del árbol de deploy) e incluirla en el backup.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

// ── Middleware ──────────────────────────────────────────────────────────────
// helmet: cabeceras de seguridad (CSP se desactiva porque el frontend se sirve aparte;
// el reverse proxy / Vite manejan la app). En prod conviene afinar CSP.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: en producción solo FRONTEND_URL; en dev se permiten los puertos locales de Vite.
const corsOrigins = IS_PROD ? [FRONTEND_URL] : [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'];
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Rate limit para el login: frena fuerza bruta (10 intentos / 15 min por IP).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intenta más tarde.' },
});

// ── Base de datos ─────────────────────────────────────────────────────────────
// El esquema vive en scripts/schema.sql y se aplica con `npm run migrate` (o ensureSchema).
// db, withTx, ping y pool se importan desde ./db (adaptador PostgreSQL).

// ── Helper: upsert unit row ───────────────────────────────────────────────────
async function upsertUnit(u: Record<string, unknown>, stableId: string, now: string) {
  await db.prepare(`INSERT INTO units (id, project_id, type, numero, estado, superficie, orientacion, piso, dormitorios, banos, gasto_comun, gastos_operacionales, gastos_notariales, gastos_conservador, bodegas, estacionamientos, cliente_id, asignado_por, fecha_asignacion, precio_lista, precio_venta, pie, pie_forma_pago, pie_cuotas, bono_descuento, reserva_monto, reserva_forma_pago, reserva_cuotas, credito_hipotecario, tasa_financiamiento, total_pagado, saldo_por_pagar, canal_venta, intermediario, banco, notaria, repertorio, fecha_reserva, fecha_promesa, fecha_solicitud_credito, fecha_aprobacion_credito, fecha_escritura, fecha_termino_pago, fecha_alzamiento, fecha_entrega, fecha_pago, factura_numero, factura_fecha, recepcion_municipal_numero, recepcion_municipal_fecha, cbr_fojas, cbr_numero, cbr_ano, plan_pagos, observaciones, documents, descuento_pct, descuento_pendiente, descuento_solicitud_id, aplica_bono_pie, extras, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

async function syncProjectConfigToTable(projectId: string, cfg: Record<string, unknown>, now: string) {
  try {
    const dc = cfg.discountConfig as Record<string, unknown> | undefined;
    const cfgId = `cfg_${projectId}`;
    await db.prepare(`INSERT INTO project_configs (id, project_id, jefe_max_pct, supervisor_max_pct, bono_pie_pct, vigencia_cotizacion_dias, reserva_clp, nombre_inmobiliaria, direccion_proyecto, comuna_proyecto, ciudad_proyecto, cantidad_cuotas_pie, created_at, updated_at)
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

async function syncAppStateToTables(state: Record<string, unknown>, now: string) {
  try {
    const projects = (state.projects as Array<Record<string, unknown>>) || [];
    const clients = (state.clients as Array<Record<string, unknown>>) || [];
    const units = (state.units as Array<Record<string, unknown>>) || [];

    for (const p of projects) {
      await db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, updated_at = excluded.updated_at`
      ).run(p.id as string, (p.nombre as string | undefined) || '', (p.fechaCreacion as string | undefined) || now, now, now);
    }

    for (const c of clients) {
      await db.prepare(`INSERT INTO clients (id, project_id, tipo_persona, nombre, rut, nacionalidad, profesion, sueldo_range, fecha_nacimiento, email, telefono, direccion, ciudad, comuna, region, ejecutivo_id, estado, fecha_registro, representante_nombre, representante_rut, representante_nacionalidad, representante_email, representante_telefono, representante_direccion, historial, documents, created_at, updated_at)
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
    const mappingRow = await db.prepare("SELECT value FROM app_state WHERE key = 'unit_id_mapping'").get() as { value: string } | undefined;
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
      await db.prepare("INSERT INTO app_state (key, value) VALUES ('unit_id_mapping', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(unitIdMapping));
    }
  } catch (err) {
    console.error('[syncAppStateToTables] Error:', err);
  }
}

async function buildAppStateFromTables(): Promise<Record<string, unknown> | null> {
  const projects = await db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  if (projects.length === 0) return null;

  const clients = await db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  const units = await db.prepare('SELECT * FROM units ORDER BY numero ASC').all() as Array<Record<string, unknown>>;
  const configs = await db.prepare('SELECT * FROM project_configs').all() as Array<Record<string, unknown>>;
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

async function migrateFromAppState() {
  const flagRow = await db.prepare("SELECT value FROM app_state WHERE key = 'migration_v1_complete'").get() as { value: string } | undefined;
  if (flagRow?.value === 'true') {
    console.log('[Migration] v1 already complete, skipping.');
    return;
  }

  const stateRow = await db.prepare("SELECT value FROM app_state WHERE key = 'u1:app_state'").get() as { value: string } | undefined;
  if (!stateRow) {
    console.log('[Migration] No u1:app_state blob found, marking v1 complete.');
    await db.prepare("INSERT INTO app_state (key, value) VALUES ('migration_v1_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
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
    await db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(pid, (p.nombre as string | undefined) || '', (p.fechaCreacion as string | undefined) || now, now, now);

    const cfgRow = await db.prepare("SELECT value FROM app_state WHERE key = ?").get(`u1:project_config_${pid}`) as { value: string } | undefined;
    if (cfgRow) {
      try { syncProjectConfigToTable(pid, JSON.parse(cfgRow.value) as Record<string, unknown>, now); } catch { /* */ }
    }
  }

  for (const c of clients) {
    await db.prepare(`INSERT INTO clients (id, project_id, tipo_persona, nombre, rut, nacionalidad, profesion, sueldo_range, fecha_nacimiento, email, telefono, direccion, ciudad, comuna, region, ejecutivo_id, estado, fecha_registro, representante_nombre, representante_rut, representante_nacionalidad, representante_email, representante_telefono, representante_direccion, historial, documents, created_at, updated_at)
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
  const mappingRow = await db.prepare("SELECT value FROM app_state WHERE key = 'unit_id_mapping'").get() as { value: string } | undefined;
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
    await db.prepare("INSERT INTO app_state (key, value) VALUES ('unit_id_mapping', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(unitIdMapping));
  }

  await db.prepare("INSERT INTO app_state (key, value) VALUES ('migration_v1_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
  console.log(`[Migration] ✓ v1 complete: ${projects.length} projects, ${clients.length} clients, ${units.length} units`);
}
// migrateFromAppState/ensureProjectConfigs/migrateReservas se ejecutan en init() (abajo, solo isMain).

async function ensureProjectConfigs() {
  const orphans = await db.prepare(`
    SELECT p.id FROM projects p
    LEFT JOIN project_configs pc ON pc.project_id = p.id
    WHERE pc.id IS NULL
  `).all() as Array<{ id: string }>;
  for (const p of orphans) {
    await db.prepare(`
      INSERT INTO project_configs (
        id, project_id, jefe_max_pct, supervisor_max_pct,
        bono_pie_pct, vigencia_cotizacion_dias, reserva_clp,
        nombre_inmobiliaria, direccion_proyecto, comuna_proyecto,
        ciudad_proyecto, cantidad_cuotas_pie
      ) VALUES (?, ?, 3, 8, 10, 7, 300000, '', '', '', '', 36)
      ON CONFLICT (id) DO NOTHING
    `).run('cfg_' + p.id, p.id);
  }
  if (orphans.length > 0) {
    console.log(`[ensureProjectConfigs] Created default config for ${orphans.length} project(s)`);
  }
}


async function migrateReservas() {
  const sinReserva = await db.prepare(`
    SELECT u.id, u.project_id, u.cliente_id, u.type, u.numero
    FROM units u
    WHERE u.estado = 'Reservado'
    AND u.reserva_vendedor_id IS NULL
  `).all() as Array<{ id: string; project_id: string; cliente_id: string | null; type: string; numero: string }>;

  for (const unit of sinReserva) {
    const config = await db.prepare(
      'SELECT duracion_cotizacion_dias FROM project_configs WHERE project_id = ?'
    ).get(unit.project_id) as { duracion_cotizacion_dias?: number } | undefined;
    const dias = config?.duracion_cotizacion_dias ?? 15;
    const expira = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();

    const cliente = unit.cliente_id ? await db.prepare(
      'SELECT ejecutivo_id FROM clients WHERE id = ?'
    ).get(unit.cliente_id) as { ejecutivo_id?: string } | undefined : undefined;

    await db.prepare(`
      UPDATE units SET reserva_vendedor_id = ?, reserva_expira = ? WHERE id = ?
    `).run(cliente?.ejecutivo_id || 'system', expira, unit.id);
  }

  if (sinReserva.length > 0) {
    console.log(`[Migración] ${sinReserva.length} reservas pre-existentes migradas`);
  }
}

async function checkReservasVencidas() {
  try {
    const nowDate = new Date();
    const nowISO = nowDate.toISOString();
    const in24h = new Date(nowDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Pre-expiry alerts: reservations expiring in next 24h, not already alerted
    const expiringSoon = await db.prepare(`
      SELECT id, numero, type, reserva_vendedor_id, reserva_expira
      FROM units
      WHERE reserva_expira IS NOT NULL
        AND reserva_expira > ?
        AND reserva_expira <= ?
        AND estado = 'Reservado'
        AND NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE related_id = units.id AND titulo = 'Reserva próxima a vencer'
        )
    `).all(nowISO, in24h) as Array<{ id: string; numero: string; type: string; reserva_vendedor_id: string | null; reserva_expira: string }>;

    for (const u of expiringSoon) {
      const fechaStr = new Date(u.reserva_expira).toLocaleDateString('es-CL');
      if (u.reserva_vendedor_id) {
        createNotification({ paraUserId: u.reserva_vendedor_id, titulo: 'Reserva próxima a vencer', mensaje: `La reserva de ${u.type} ${u.numero} vence el ${fechaStr}`, tipo: 'warning', linkView: 'inventory', relatedId: u.id });
      }
      createNotification({ paraRol: 'JefeSala', titulo: 'Reserva próxima a vencer', mensaje: `${u.type} ${u.numero} vence reserva el ${fechaStr}`, tipo: 'warning', linkView: 'inventory', relatedId: u.id });
    }

    // Auto-release expired reservations
    const expired = await db.prepare(`
      SELECT id, numero, type, cliente_id, reserva_vendedor_id, historial_ocupacion
      FROM units
      WHERE reserva_expira IS NOT NULL AND reserva_expira < ? AND estado = 'Reservado'
    `).all(nowISO) as Array<{ id: string; numero: string; type: string; cliente_id: string | null; reserva_vendedor_id: string | null; historial_ocupacion: string }>;

    for (const u of expired) {
      type HistEntry = { fechaFin?: string; [k: string]: unknown };
      const hist = (() => { try { return JSON.parse(u.historial_ocupacion || '[]') as HistEntry[]; } catch { return [] as HistEntry[]; } })();
      const updHist = hist.map((h, idx) => idx === hist.length - 1 && !h.fechaFin ? { ...h, fechaFin: nowISO, motivo: 'Vencimiento' } : h);
      await db.prepare(`UPDATE units SET estado = 'Disponible', cliente_id = NULL, asignado_por = NULL, fecha_asignacion = NULL, reserva_vendedor_id = NULL, reserva_expira = NULL, historial_ocupacion = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(updHist), nowISO, u.id);
      if (u.cliente_id) {
        await db.prepare(`UPDATE clients SET estado = 'Prospecto' WHERE id = ?`).run(u.cliente_id);
      }
      if (u.reserva_vendedor_id) {
        createNotification({ paraUserId: u.reserva_vendedor_id, titulo: 'Reserva vencida', mensaje: `La reserva de ${u.type} ${u.numero} ha vencido y fue liberada automáticamente`, tipo: 'error', linkView: 'inventory', relatedId: u.id });
      }
      createNotification({ paraRol: 'JefeSala', titulo: 'Reserva vencida', mensaje: `${u.type} ${u.numero} fue liberada por vencimiento`, tipo: 'warning', linkView: 'inventory', relatedId: u.id });
    }
    if (expired.length > 0) {
      console.log(`[checkReservasVencidas] Liberadas ${expired.length} reserva(s) vencida(s)`);
    }
  } catch (err) {
    console.error('[checkReservasVencidas]', err);
  }
  checkFollowUpAlerts();
}

async function checkFollowUpAlerts() {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const items = await db.prepare(`
      SELECT qd.id, qd.user_id, qd.cliente_nombre, u.type, u.numero
      FROM quotation_drafts qd
      JOIN units u ON u.numero = (
        SELECT json_extract(value, '$.numero')
        FROM json_each(json_extract(qd.data, '$.selectedUnits'))
        LIMIT 1
      ) AND u.project_id = qd.project_id
      WHERE qd.estado = 'generada'
        AND qd.fecha_generada < ?
        AND qd.fecha_generada > ?
        AND u.estado = 'Disponible'
        AND NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE related_id = qd.id
            AND titulo = 'Seguimiento cotización'
        )
    `).all(threeDaysAgo, fourDaysAgo) as Array<{ id: string; user_id: string; cliente_nombre: string; type: string; numero: string }>;
    for (const item of items) {
      createNotification({
        paraUserId: item.user_id,
        titulo: 'Seguimiento cotización',
        mensaje: `¿Cómo te ha ido con la cotización de ${item.type} ${item.numero} para ${item.cliente_nombre || 'sin cliente'}?`,
        tipo: 'info',
        relatedId: item.id,
      });
    }
    if (items.length > 0) {
      console.log(`[checkFollowUpAlerts] Enviadas ${items.length} alerta(s) de seguimiento`);
    }
  } catch (err) {
    console.error('[checkFollowUpAlerts]', err);
  }
}

// El cron y las migraciones de arranque corren en init() (abajo), solo cuando isMain.

// ── UF Cache ────────────────────────────────────────────────────────────────
let ufCache: { value: number; fecha: string; cachedAt: number } | null = null;
const UF_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// ── Usuarios (en tabla `users`, con hash bcrypt; seed en scripts/seed-users.ts) ─
type AppUser = { id: string; name: string; email: string; role: string; company: string; assignedProjectIds: string[] };

// Busca un usuario por id en la BD (reemplaza el viejo USERS.find). assigned_project_ids
// es JSONB y pg lo devuelve ya parseado como array.
async function getUserById(id: string): Promise<AppUser | undefined> {
  const r = await db.prepare(
    'SELECT id, name, email, role, company, assigned_project_ids FROM users WHERE id = ?'
  ).get(id) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  return {
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    role: r.role as string,
    company: (r.company as string) ?? '',
    assignedProjectIds: (r.assigned_project_ids as string[]) ?? [],
  };
}

type AuthenticatedRequest = express.Request & { userId: string; userRole: string };

// ── Auth Middleware ─────────────────────────────────────────────────────────
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string; role: string };
    (req as AuthenticatedRequest).userId = payload.userId;
    (req as AuthenticatedRequest).userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const requireRole = (...roles: string[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const userRole = (req as AuthenticatedRequest).userRole;
  if (!userRole || !roles.includes(userRole)) {
    res.status(403).json({ error: `Rol ${userRole ?? 'desconocido'} no tiene permiso para esta acción` });
    return;
  }
  next();
};

// Los errores de los handlers async los captura `express-async-errors` (importado
// arriba) y los enruta al middleware de errores global definido al final del archivo.

// Protected uploads route (auth required, path traversal prevented)
app.use('/uploads', requireAuth, (req: express.Request, res: express.Response) => {
  const uploadsDir = path.resolve(UPLOADS_DIR);
  const filePath = path.resolve(path.join(uploadsDir, req.path));
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    res.status(403).json({ error: 'Acceso denegado' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Archivo no encontrado' });
    return;
  }
  res.sendFile(filePath);
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── 0. GET /api/health ────────────────────────────────────────────────────────
// Para el reverse proxy / process manager: 200 si PostgreSQL responde, 503 si no.
app.get('/api/health', async (_req, res) => {
  try {
    await ping();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'db-unavailable' });
  }
});

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

// ── 1b. POST /api/ai/extract-transaction ──────────────────────────────────────
// La extracción con Gemini corre en el backend (la API key nunca llega al navegador).
app.post('/api/ai/extract-transaction', requireAuth, async (req, res) => {
  const { base64Image } = req.body as { base64Image?: string };
  if (!base64Image) { res.status(400).json({ error: 'base64Image requerido' }); return; }
  try {
    const data = await extractTransactionData(base64Image);
    res.json(data);
  } catch (err) {
    console.error('[ai extract]', err);
    res.status(502).json({ error: 'No se pudo extraer datos con IA' });
  }
});

// ── 2. POST /api/auth/login ──────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const row = await db.prepare(
    'SELECT id, name, email, role, company, assigned_project_ids, password_hash FROM users WHERE email = ?'
  ).get(email) as Record<string, unknown> | undefined;
  if (!row || !(await bcrypt.compare(password || '', row.password_hash as string))) {
    res.status(401).json({ error: 'Credenciales incorrectas' });
    return;
  }
  const user: AppUser = {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: row.role as string,
    company: (row.company as string) ?? '',
    assignedProjectIds: (row.assigned_project_ids as string[]) ?? [],
  };
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });
  createAuditLog(user.id, user.name, user.role, 'Login', 'Auth', user.id, `Login exitoso desde ${req.ip || 'IP desconocida'}`);
  res.json({ token, user });
});

// ── 3. GET /api/me ───────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const user = await getUserById(userId);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }
  res.json({ user });
});

// ── 4. Borradores de Cotización ──────────────────────────────────────────────

app.post('/api/quotation-drafts', requireAuth, async (req, res) => {
  const { id, projectId, clienteRut, clienteNombre, clienteId, ...rest } = req.body as Record<string, unknown>;
  const userId = (req as AuthenticatedRequest).userId;
  const draftId = (id as string) || crypto.randomUUID();
  const now = new Date().toISOString();
  const data = JSON.stringify({ projectId, clienteRut, clienteNombre, clienteId, ...rest });

  await db.prepare(`
    INSERT INTO quotation_drafts (id, project_id, user_id, cliente_rut, cliente_nombre, cliente_id, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data           = excluded.data,
      cliente_rut    = excluded.cliente_rut,
      cliente_nombre = excluded.cliente_nombre,
      cliente_id     = excluded.cliente_id,
      updated_at     = excluded.updated_at
  `).run(draftId, (projectId as string) || null, userId, (clienteRut as string) || null, (clienteNombre as string) || null, (clienteId as string) || null, data, now, now);

  res.json({ id: draftId, projectId, clienteRut, clienteNombre, clienteId, updatedAt: now });
});

app.get('/api/quotation-drafts', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const { unitNumero, projectId: qProjectId } = req.query as { unitNumero?: string; projectId?: string };

  let rows: Array<Record<string, unknown>>;

  if (unitNumero && qProjectId) {
    rows = await db.prepare(
      `SELECT * FROM quotation_drafts
       WHERE estado = 'generada'
         AND project_id = ?
         AND (
           data LIKE '%"numero":"' || ? || '",%'
           OR data LIKE '%"numero":"' || ? || '"}%'
         )
       ORDER BY updated_at DESC`
    ).all(qProjectId, unitNumero, unitNumero) as Array<Record<string, unknown>>;
  } else if (userRole === 'Admin' || userRole === 'Supervisor') {
    rows = await db.prepare(
      'SELECT * FROM quotation_drafts ORDER BY updated_at DESC'
    ).all() as Array<Record<string, unknown>>;
  } else if (userRole === 'JefeSala') {
    const jefe = await getUserById(userId);
    const projectIds = (jefe?.assignedProjectIds ?? []) as readonly string[];
    if (projectIds.length === 0) {
      rows = await db.prepare(
        'SELECT * FROM quotation_drafts WHERE user_id = ? ORDER BY updated_at DESC'
      ).all(userId) as Array<Record<string, unknown>>;
    } else {
      const placeholders = projectIds.map(() => '?').join(',');
      rows = await db.prepare(
        `SELECT * FROM quotation_drafts WHERE project_id IN (${placeholders}) ORDER BY updated_at DESC`
      ).all(...(projectIds as string[])) as Array<Record<string, unknown>>;
    }
  } else {
    rows = await db.prepare(
      'SELECT * FROM quotation_drafts WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId) as Array<Record<string, unknown>>;
  }

  res.json(rows.map(r => ({
    ...r,
    data: JSON.parse((r.data as string) || '{}'),
  })));
});

app.delete('/api/quotation-drafts/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const result = await db.prepare(
    'DELETE FROM quotation_drafts WHERE id = ? AND user_id = ?'
  ).run(req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Borrador no encontrado o sin permisos' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/quotation-drafts/:id/generate', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  const { vendedorId } = req.body as { vendedorId?: string };
  const now = new Date().toISOString();

  try {
    const draft = await withTx(async (tx) => {
      const d = await tx.prepare(
        `SELECT id, project_id, cliente_id, cliente_nombre, cliente_rut, data FROM quotation_drafts WHERE id = ? AND user_id = ?`
      ).get(id, userId) as { id: string; project_id: string; cliente_id: string; cliente_nombre: string; cliente_rut: string; data: string } | undefined;

      if (!d) throw new Error('DRAFT_NOT_FOUND');

      const data = (() => {
        try { return JSON.parse(d.data || '{}') as { selectedUnits?: Array<{ id: string; numero: string; precioLista: number }>; adjustments?: Array<{ key: string; value: Record<string, unknown> }>; adjustDrafts?: Record<string, { type: '%' | 'UF'; rawValue: string; applied: boolean }> }; }
        catch { return {}; }
      })();

      await tx.prepare(
        `UPDATE quotation_drafts SET estado = 'generada', fecha_generada = ?, generada_por = ? WHERE id = ?`
      ).run(now, vendedorId ?? userId, id);

      const paymentConfig = (data.adjustments ?? []).find(a => a.key === 'paymentConfig')?.value as Record<string, unknown> | undefined;

      if (paymentConfig?.includePaymentPlan) {
        const promesaPct   = parseFloat(String(paymentConfig.promesaPct   ?? 0));
        const cuotasPct    = parseFloat(String(paymentConfig.cuotasPct    ?? 0));
        const escrituraPct = parseFloat(String(paymentConfig.escrituraPct ?? 0));
        const cuotasN      = parseInt(String(paymentConfig.nCuotasNew     ?? 0), 10);
        const bonoPiePct   = parseFloat(String(paymentConfig.bonoPct      ?? 0));
        const creditoPct   = Math.max(0, 100 - promesaPct - cuotasPct - escrituraPct);
        const bonoPieUnits: string[] = Array.isArray(paymentConfig.bonoPieUnits) ? (paymentConfig.bonoPieUnits as string[]) : [];

        // id es un UUID nuevo en cada iteración: no hay conflicto, basta INSERT (antes INSERT OR REPLACE).
        const insertPlan = tx.prepare(`
          INSERT INTO payment_plans
            (id, quotation_id, unit_numero, project_id, cliente_id, cliente_rut, cliente_nombre,
             precio_venta_final, promesa_pct, cuotas_pct, cuotas_n, escritura_pct, credito_pct,
             bono_pie_pct, aplica_bono_pie, descuento_pct, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const unit of (data.selectedUnits ?? [])) {
          const adj = data.adjustDrafts?.[unit.id];
          let descuentoPct = 0;
          if (adj?.applied) {
            if (adj.type === '%') descuentoPct = parseFloat(adj.rawValue) || 0;
            else if (adj.type === 'UF' && unit.precioLista > 0) {
              descuentoPct = (parseFloat(adj.rawValue) / unit.precioLista) * 100;
            }
          }
          await insertPlan.run(
            crypto.randomUUID(), d.id, unit.numero, d.project_id,
            d.cliente_id || null, d.cliente_rut || null, d.cliente_nombre || null,
            unit.precioLista * (1 - descuentoPct / 100),
            promesaPct, cuotasPct, cuotasN, escrituraPct, creditoPct,
            bonoPiePct, bonoPieUnits.includes(unit.id) ? 1 : 0, descuentoPct, now
          );
        }
      }

      return d;
    });

    const genUser = await getUserById(userId);
    createAuditLog(userId, genUser?.name || '', genUser?.role || '', 'Cotización generada', 'Quotation', id,
      `Cotización generada para ${draft.cliente_nombre || 'sin cliente'}`);
    // Notify JefeSala about new quotation
    const firstUnit = ((() => { try { return JSON.parse(draft.data || '{}'); } catch { return {}; } })() as { selectedUnits?: Array<{ type?: string; numero?: string }> }).selectedUnits?.[0];
    createNotification({
      paraRol: 'JefeSala',
      titulo: 'Nueva cotización generada',
      mensaje: `${genUser?.name || 'Vendedor'} cotizó ${firstUnit?.type || 'unidad'} ${firstUnit?.numero || ''} para ${draft.cliente_nombre || 'sin cliente'}`,
      tipo: 'info',
      linkView: 'inventory',
      relatedId: id,
    });
    res.json({ ok: true, fechaGenerada: now });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    if (msg === 'DRAFT_NOT_FOUND') { res.status(404).json({ error: 'Borrador no encontrado o sin permisos' }); return; }
    console.error('[generate quotation]', err);
    res.status(500).json({ error: 'Error al generar la cotización' });
  }
});

app.get('/api/payment-plans', requireAuth, async (req, res) => {
  const { unitNumero, projectId, clienteRut } = req.query as Record<string, string>;
  if (!unitNumero || !projectId) {
    res.status(400).json({ error: 'unitNumero y projectId son requeridos' });
    return;
  }
  const conditions: string[] = ['unit_numero = ?', 'project_id = ?'];
  const params: string[] = [unitNumero, projectId];
  if (clienteRut) {
    conditions.push('cliente_rut = ?');
    params.push(clienteRut);
  }
  const rows = await db.prepare(
    `SELECT id, quotation_id, unit_numero, project_id, cliente_id, cliente_rut, cliente_nombre,
            precio_venta_final, promesa_pct, cuotas_pct, cuotas_n, escritura_pct, credito_pct,
            bono_pie_pct, aplica_bono_pie, descuento_pct, created_at
     FROM payment_plans WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
  ).all(...params) as Array<Record<string, unknown>>;

  res.json(rows.map(r => ({
    id:               r.id,
    quotationId:      r.quotation_id,
    unitNumero:       r.unit_numero,
    projectId:        r.project_id,
    clienteId:        r.cliente_id,
    clienteRut:       r.cliente_rut,
    clienteNombre:    r.cliente_nombre,
    precioVentaFinal: r.precio_venta_final,
    promesaPct:       r.promesa_pct,
    cuotasPct:        r.cuotas_pct,
    cuotasN:          r.cuotas_n,
    escrituraPct:     r.escritura_pct,
    creditoPct:       r.credito_pct,
    bonoPiePct:       r.bono_pie_pct,
    aplicaBonoPie:    Boolean(r.aplica_bono_pie),
    descuentoPct:     r.descuento_pct,
    createdAt:        r.created_at,
  })));
});

// Stub para compatibilidad con Quoter.tsx
app.get('/api/quotation-drafts/:id/check-approvals', requireAuth, async (_req, res) => {
  res.json({ pending: [], rejected: [] });
});

// ── Helper: Notification factory ─────────────────────────────────────────────
async function createNotification(opts: {
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
  try {
    await db.prepare(`
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
  } catch (err) { console.error('[createNotification]', err); /* no romper la operación principal */ }
  return id;
}

// Helper: Audit log automático — silencioso, no rompe la operación principal
async function createAuditLog(
  userId: string,
  userName: string,
  userRole: string,
  action: string,
  entityType: string,
  entityId: string,
  description: string,
  ipAddress?: string
) {
  try {
    await db.prepare(`
      INSERT INTO audit_logs (id, user_id, user_name, user_role, action, entity_type, entity_id, description, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, userName, userRole, action, entityType, entityId, description, ipAddress || null);
  } catch { /* silencioso — no romper la operación principal */ }
}

// Helper: Get project discount config — real table first, fall back to app_state blob
async function getProjectDiscountConfig(projectId: string): Promise<{
  jefeMaxPct: number; supervisorMaxPct: number; bonoPiePct: number; vigenciaCotizacionDias: number; duracionReservaDias: number;
}> {
  const cfgRow = await db.prepare('SELECT * FROM project_configs WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
  if (cfgRow) {
    return {
      jefeMaxPct: (cfgRow.jefe_max_pct as number | undefined) ?? 3,
      supervisorMaxPct: (cfgRow.supervisor_max_pct as number | undefined) ?? 8,
      bonoPiePct: (cfgRow.bono_pie_pct as number | undefined) ?? 10,
      vigenciaCotizacionDias: (cfgRow.vigencia_cotizacion_dias as number | undefined) ?? 7,
      duracionReservaDias: (cfgRow.duracion_cotizacion_dias as number | undefined) ?? 15,
    };
  }
  // Fall back to app_state blob
  const adminRows = await db.prepare(`SELECT key, value FROM app_state WHERE key LIKE '%project_config_${projectId}'`)
    .all() as Array<{ key: string; value: string }>;
  if (adminRows.length > 0) {
    try {
      const cfg = JSON.parse(adminRows[0].value) as { discountConfig?: { jefeMaxPct?: number; supervisorMaxPct?: number }; bonoPiePct?: number; vigenciaCotizacionDias?: number };
      return {
        jefeMaxPct: cfg.discountConfig?.jefeMaxPct ?? 3,
        supervisorMaxPct: cfg.discountConfig?.supervisorMaxPct ?? 8,
        bonoPiePct: cfg.bonoPiePct ?? 10,
        vigenciaCotizacionDias: cfg.vigenciaCotizacionDias ?? 7,
        duracionReservaDias: 15,
      };
    } catch { /* fall through */ }
  }
  return { jefeMaxPct: 3, supervisorMaxPct: 8, bonoPiePct: 10, vigenciaCotizacionDias: 7, duracionReservaDias: 15 };
}

// ── 5. Solicitudes de Descuento ──────────────────────────────────────────────

// Create discount request
app.post('/api/discount-requests', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const { projectId, unitId, unitNumero, precioSolicitado, cotizacionId } = req.body as Record<string, unknown>;
  const userId = (req as AuthenticatedRequest).userId;
  const user = await getUserById(userId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const unit = await db.prepare('SELECT precio_lista FROM units WHERE id = ?').get(unitId as string) as { precio_lista: number } | undefined;
  if (!unit) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }

  const precioOriginal = unit.precio_lista;
  const precioSol = precioSolicitado as number;
  const descuentoPct = Math.round(((precioOriginal - precioSol) / precioOriginal) * 10000) / 100;
  const descuentoMonto = Math.round((precioOriginal - precioSol) * 100) / 100;

  const config = await getProjectDiscountConfig(projectId as string);
  if (descuentoPct > config.supervisorMaxPct) {
    res.status(403).json({ error: `Descuento ${descuentoPct}% supera el límite permitido (${config.supervisorMaxPct}%)` });
    return;
  }

  await db.prepare(`
    INSERT INTO discount_requests
      (id, project_id, unit_id, unit_numero, vendedor_id, vendedor_nombre,
       cotizacion_id, precio_original, precio_solicitado, descuento_pct,
       descuento_monto, estado, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
  `).run(id, projectId as string, unitId as string, unitNumero as string, userId, user?.name || '',
         (cotizacionId as string) || null,
         precioOriginal, precioSol, descuentoPct, descuentoMonto, now, now);

  // Notify JefeSala
  createNotification({
    paraRol: 'JefeSala',
    titulo: 'Nueva solicitud de descuento',
    mensaje: `${user?.name || 'Vendedor'} solicita ${descuentoPct.toFixed(1)}% descuento en unidad ${unitNumero}`,
    tipo: 'warning',
    linkView: 'approvals',
    relatedId: id,
  });

  res.json({ id, estado: 'Pendiente', projectId, unitId, createdAt: now });
});

// Get pending requests (filtered by role)
app.get('/api/discount-requests/pending', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;

  let rows: unknown[];
  if (userRole === 'Admin') {
    rows = await db.prepare(
      `SELECT * FROM discount_requests WHERE estado NOT IN ('Cancelado') ORDER BY created_at DESC`
    ).all();
  } else if (userRole === 'JefeSala') {
    rows = await db.prepare(
      `SELECT * FROM discount_requests WHERE estado = 'Pendiente' ORDER BY created_at DESC`
    ).all();
  } else if (userRole === 'Supervisor') {
    rows = await db.prepare(
      `SELECT * FROM discount_requests WHERE estado = 'AprobadoJefe' ORDER BY created_at DESC`
    ).all();
  } else {
    // Ventas: only own requests
    rows = await db.prepare(
      `SELECT * FROM discount_requests WHERE vendedor_id = ? ORDER BY created_at DESC`
    ).all(userId);
  }

  res.json(rows);
});

// Get single discount request
app.get('/api/discount-requests/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'No encontrado' }); return; }
  res.json(row);
});

// Approve discount request
app.post('/api/discount-requests/:id/approve', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor'), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const { motivo } = req.body as { motivo?: string };
  const now = new Date().toISOString();

  const dr = await db.prepare('SELECT * FROM discount_requests WHERE id = ?')
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!dr) { res.status(404).json({ error: 'Solicitud no encontrada' }); return; }

  // IDOR: JefeSala/Supervisor solo aprueban en proyectos asignados (Admin: todos).
  if (userRole !== 'Admin') {
    const approver = await getUserById(userId);
    if (!approver || !approver.assignedProjectIds.includes(dr.project_id as string)) {
      res.status(403).json({ error: 'No tienes permiso sobre este proyecto' });
      return;
    }
  }

  const fullCfg = await getProjectDiscountConfig(dr.project_id as string);
  const discountCfg = { jefeMaxPct: fullCfg.jefeMaxPct, supervisorMaxPct: fullCfg.supervisorMaxPct };

  const descuentoPct = dr.descuento_pct as number;
  let newEstado = '';

  if (userRole === 'Admin') {
    newEstado = 'Aprobado';
    await db.prepare(`
      UPDATE discount_requests SET estado = 'Aprobado',
        aprobado_supervisor_id = ?, aprobado_supervisor_at = ?, updated_at = ?
      WHERE id = ?
    `).run(userId, now, now, req.params.id);

  } else if (userRole === 'JefeSala') {
    if (descuentoPct <= discountCfg.jefeMaxPct) {
      // Banda 1: JefeSala aprueba directamente
      newEstado = 'Aprobado';
      await db.prepare(`
        UPDATE discount_requests SET estado = 'Aprobado',
          aprobado_jefe_id = ?, aprobado_jefe_at = ?, updated_at = ?
        WHERE id = ?
      `).run(userId, now, now, req.params.id);
    } else if (descuentoPct <= discountCfg.supervisorMaxPct) {
      // Banda 2: pasa a Supervisor
      newEstado = 'AprobadoJefe';
      await db.prepare(`
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
    await db.prepare(`
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

  if (newEstado) {
    const userName = (await getUserById(userId))?.name || '';
    createAuditLog(userId, userName, userRole, `Aprobación descuento (${newEstado})`, 'Discount', req.params.id,
      `Descuento ${(dr.descuento_pct as number).toFixed(1)}% en unidad ${dr.unit_numero} → ${newEstado}`);
  }
  const updated = await db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(req.params.id);
  res.json({ ok: true, estado: newEstado || dr.estado, dr: updated });
});

// Reject discount request
app.post('/api/discount-requests/:id/reject', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor'), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const { motivo } = req.body as { motivo?: string };
  const now = new Date().toISOString();

  const dr = await db.prepare('SELECT * FROM discount_requests WHERE id = ?')
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!dr) { res.status(404).json({ error: 'No encontrado' }); return; }

  // IDOR: JefeSala/Supervisor solo rechazan en proyectos asignados (Admin: todos).
  if (userRole !== 'Admin') {
    const approver = await getUserById(userId);
    if (!approver || !approver.assignedProjectIds.includes(dr.project_id as string)) {
      res.status(403).json({ error: 'No tienes permiso sobre este proyecto' });
      return;
    }
  }

  await db.prepare(`
    UPDATE discount_requests SET estado = 'Rechazado',
      rechazado_por_id = ?, rechazado_por_at = ?, rechazo_motivo = ?, updated_at = ?
    WHERE id = ?
  `).run(userId, now, motivo || '', now, req.params.id);

  const userName = (await getUserById(userId))?.name || '';
  createAuditLog(userId, userName, userRole, 'Rechazo descuento', 'Discount', req.params.id,
    `Rechazado por ${userName}: ${motivo || 'sin motivo'}`);

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
app.post('/api/discount-requests/:id/cancel', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE discount_requests SET estado = 'Cancelado', updated_at = ? WHERE id = ? AND vendedor_id = ?`
  ).run(now, req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'No encontrado o sin permisos' }); return;
  }
  res.json({ ok: true });
});

// ── 5b. Notificaciones ────────────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;

  const rows = await db.prepare(`
    SELECT * FROM notifications
    WHERE (para_user_id = ? OR para_rol = ? OR para_rol = 'All')
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId, userRole);

  res.json(rows);
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  await db.prepare('UPDATE notifications SET leida = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  await db.prepare(`
    UPDATE notifications SET leida = 1
    WHERE para_user_id = ? OR para_rol = ? OR para_rol = 'All'
  `).run(userId, userRole);
  res.json({ ok: true });
});

// ── 5c. Audit Logs ───────────────────────────────────────────────────────────

app.post('/api/audit-logs', requireAuth, async (req, res) => {
  const { action, entityType, entityId, description } = req.body as Record<string, string>;
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const user = await getUserById(userId);
  const id = crypto.randomUUID();
  const ip = req.ip || req.socket.remoteAddress || null;
  await db.prepare(`
    INSERT INTO audit_logs (id, user_id, user_name, user_role, action, entity_type, entity_id, description, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, user?.name || '', userRole, action || '', entityType || null, entityId || null, description || null, ip);
  res.json({ ok: true, id });
});

app.get('/api/audit-logs', requireAuth, requireRole('Admin', 'Supervisor'), async (req, res) => {
  const { entityType, entityId, userId: filterUserId, limit = '100' } = req.query as Record<string, string>;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params: Array<string | number | null> = [];
  if (entityType) { sql += ' AND entity_type = ?'; params.push(entityType); }
  if (entityId) { sql += ' AND entity_id = ?'; params.push(entityId); }
  if (filterUserId) { sql += ' AND user_id = ?'; params.push(filterUserId); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit) || 100);
  res.json(await db.prepare(sql).all(...params));
});

// ── 6. Documentos de Cotización ──────────────────────────────────────────────

const UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const UPLOAD_ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.xls'];

app.post('/api/quotations/documents', requireAuth, async (req, res) => {
  const { client_rut, client_name, project_name, file_name, created_by } =
    req.query as Record<string, string>;

  // El nombre se sanea (evita path traversal) y la extensión se valida contra una allowlist.
  const safeFileName = (file_name || `doc_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(safeFileName).toLowerCase();
  if (!UPLOAD_ALLOWED_EXT.includes(ext)) {
    res.status(415).json({ error: `Tipo de archivo no permitido (${ext || 'sin extensión'})` });
    return;
  }

  const dateFolder = new Date().toISOString().split('T')[0];
  const uploadDir = path.join(UPLOADS_DIR, 'quotations', dateFolder);
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, safeFileName);

  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > UPLOAD_MAX_BYTES) {
      aborted = true;
      res.status(413).json({ error: 'Archivo demasiado grande (máx 15 MB)' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
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
  req.on('error', () => { if (!aborted) res.status(500).json({ error: 'Error al recibir archivo' }); });
});

// ── 7. Email (stub) ──────────────────────────────────────────────────────────
app.post('/api/quotations/send-email', requireAuth, async (req, res) => {
  const { to, clientName, projectName, fileName } = req.body as Record<string, string>;
  // TODO: configurar SMTP con Nodemailer
  // import nodemailer from 'nodemailer';
  // const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, ... });
  console.log(`[EMAIL STUB] Para: ${to} | Cliente: ${clientName} | Proyecto: ${projectName} | Archivo: ${fileName}`);
  res.json({ ok: true, message: 'Email en cola (SMTP no configurado)' });
});

// ── 8. Projects ──────────────────────────────────────────────────────────────

app.get('/api/projects', requireAuth, async (_req, res) => {
  const rows = await db.prepare(`
    SELECT p.*, pc.jefe_max_pct, pc.supervisor_max_pct, pc.bono_pie_pct,
      pc.vigencia_cotizacion_dias, pc.reserva_clp, pc.nombre_inmobiliaria,
      pc.direccion_proyecto, pc.comuna_proyecto, pc.ciudad_proyecto, pc.cantidad_cuotas_pie
    FROM projects p
    LEFT JOIN project_configs pc ON pc.project_id = p.id
    ORDER BY p.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    id: r.id,
    nombre: r.nombre,
    fechaCreacion: r.fecha_creacion,
    ...(r.jefe_max_pct != null ? {
      discountConfig: {
        jefeMaxPct: r.jefe_max_pct,
        supervisorMaxPct: r.supervisor_max_pct,
        bonoPiePct: r.bono_pie_pct,
        vigenciaCotizacionDias: r.vigencia_cotizacion_dias,
      }
    } : {}),
  })));
});

app.post('/api/projects', requireAuth, requireRole('Admin'), async (req, res) => {
  const recentProjects = await db.prepare(
    `SELECT COUNT(*) as cnt FROM projects WHERE created_at > now() - interval '60 seconds'`
  ).get() as { cnt: number };
  if (recentProjects.cnt >= 3) {
    return res.status(429).json({ error: 'Demasiadas creaciones de proyecto. Espera un momento.' });
  }

  const { id, nombre, fechaCreacion } = req.body as Record<string, string>;
  const now = new Date().toISOString();
  const pid = id || crypto.randomUUID();
  await db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, updated_at = excluded.updated_at`)
    .run(pid, nombre, fechaCreacion || now, now, now);
  await db.prepare(`
    INSERT INTO project_configs (
      id, project_id, jefe_max_pct, supervisor_max_pct,
      bono_pie_pct, vigencia_cotizacion_dias, reserva_clp,
      nombre_inmobiliaria, direccion_proyecto, comuna_proyecto,
      ciudad_proyecto, cantidad_cuotas_pie
    ) VALUES (?, ?, 3, 8, 10, 7, 300000, '', '', '', '', 36)
    ON CONFLICT (id) DO NOTHING
  `).run('cfg_' + pid, pid);
  res.json({ id: pid, nombre, fechaCreacion: fechaCreacion || now });
});

app.patch('/api/projects/:id', requireAuth, requireRole('Admin'), async (req, res) => {
  const { nombre } = req.body as { nombre: string };
  const now = new Date().toISOString();
  await db.prepare('UPDATE projects SET nombre = ?, updated_at = ? WHERE id = ?').run(nombre, now, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/projects/:id', requireAuth, requireRole('Admin'), async (req, res) => {
  const { id } = req.params;
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;

  const project = await db.prepare('SELECT id, nombre FROM projects WHERE id = ?').get(id) as { id: string; nombre: string } | undefined;
  if (!project) { res.status(404).json({ error: 'Proyecto no encontrado' }); return; }

  await withTx(async (tx) => {
    await tx.prepare('DELETE FROM payment_plans WHERE project_id = ?').run(id);
    await tx.prepare(`DELETE FROM notifications WHERE related_id IN (SELECT id FROM discount_requests WHERE project_id = ?)`).run(id);
    await tx.prepare('DELETE FROM discount_requests WHERE project_id = ?').run(id);
    await tx.prepare('DELETE FROM quotation_drafts WHERE project_id = ?').run(id);
    await tx.prepare('DELETE FROM units WHERE project_id = ?').run(id);
    await tx.prepare('DELETE FROM clients WHERE project_id = ?').run(id);
    await tx.prepare('DELETE FROM project_configs WHERE project_id = ?').run(id);
    await tx.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  const userName = (await getUserById(userId))?.name || '';
  createAuditLog(userId, userName, userRole, 'Eliminar proyecto', 'Project', id, `Proyecto "${project.nombre}" eliminado con cascada`);

  res.json({ ok: true });
});

app.get('/api/projects/:id/config', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM project_configs WHERE project_id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) { res.status(404).json({ error: 'Config no encontrada' }); return; }
  res.json({
    projectId: row.project_id,
    bonoPiePct: row.bono_pie_pct,
    discountConfig: {
      jefeMaxPct: row.jefe_max_pct,
      supervisorMaxPct: row.supervisor_max_pct,
      bonoPiePct: row.bono_pie_pct,
      vigenciaCotizacionDias: row.vigencia_cotizacion_dias,
    },
    reservaCLP: row.reserva_clp,
    direccionProyecto: row.direccion_proyecto,
    comunaProyecto: row.comuna_proyecto,
    ciudadProyecto: row.ciudad_proyecto,
    nombreInmobiliaria: row.nombre_inmobiliaria,
    cantidadCuotasPie: row.cantidad_cuotas_pie,
    duracionReservaDias: row.duracion_cotizacion_dias,
  });
});

app.post('/api/projects/:id/config', requireAuth, requireRole('Admin', 'Supervisor'), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  syncProjectConfigToTable(req.params.id, body, now);
  if (body.duracionReservaDias != null) {
    await db.prepare('UPDATE project_configs SET duracion_cotizacion_dias = ? WHERE project_id = ?')
      .run(body.duracionReservaDias as number, req.params.id);
  }
  res.json({ ok: true });
});

// ── 9. Clients ────────────────────────────────────────────────────────────────

app.get('/api/clients', requireAuth, async (req, res) => {
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

  const rows = await db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    tipoPersona: r.tipo_persona,
    nombre: r.nombre,
    rut: r.rut,
    nacionalidad: r.nacionalidad,
    profesion: r.profesion,
    sueldoRange: r.sueldo_range,
    fechaNacimiento: r.fecha_nacimiento,
    email: r.email,
    telefono: r.telefono,
    direccion: r.direccion,
    ciudad: r.ciudad,
    comuna: r.comuna,
    region: r.region,
    ejecutivoId: r.ejecutivo_id,
    estado: r.estado,
    fechaRegistro: r.fecha_registro,
    historial: JSON.parse((r.historial as string) || '[]'),
    documents: JSON.parse((r.documents as string) || '[]'),
    representanteNombre: r.representante_nombre,
    representanteRut: r.representante_rut,
    representanteNacionalidad: r.representante_nacionalidad,
    representanteEmail: r.representante_email,
    representanteTelefono: r.representante_telefono,
    representanteDireccion: r.representante_direccion,
  })));
});

app.post('/api/clients', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = (body.id as string | undefined) || crypto.randomUUID();
  await db.prepare(`INSERT INTO clients (id, project_id, tipo_persona, nombre, rut, nacionalidad, profesion, sueldo_range, fecha_nacimiento, email, telefono, direccion, ciudad, comuna, region, ejecutivo_id, estado, fecha_registro, representante_nombre, representante_rut, representante_nacionalidad, representante_email, representante_telefono, representante_direccion, historial, documents, created_at, updated_at)
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

app.patch('/api/clients/:id', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as Record<string, string | null> | undefined;
  if (!existing) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }
  // IDOR: un rol Ventas solo puede editar clientes de los que es ejecutivo.
  if (userRole === 'Ventas' && existing.ejecutivo_id !== userId) {
    res.status(403).json({ error: 'No puedes editar clientes de otro ejecutivo' });
    return;
  }

  await db.prepare(`UPDATE clients SET tipo_persona = ?, nombre = ?, rut = ?, nacionalidad = ?, profesion = ?, sueldo_range = ?,
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

// GET /api/clients/:id/quotations — ACCIÓN 1: cotizaciones generadas del cliente
app.get('/api/clients/:id/quotations', requireAuth, async (req, res) => {
  const client = await db.prepare('SELECT id, rut, nombre FROM clients WHERE id = ?').get(req.params.id) as { id: string; rut: string; nombre: string } | undefined;
  if (!client) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }

  const rows = await db.prepare(`
    SELECT * FROM quotation_drafts
    WHERE estado = 'generada'
      AND (
        (cliente_rut IS NOT NULL AND cliente_rut = ?)
        OR (cliente_nombre IS NOT NULL AND cliente_nombre = ?)
        OR (cliente_id IS NOT NULL AND cliente_id = ?)
      )
    ORDER BY fecha_generada DESC
  `).all(client.rut || '', client.nombre || '', client.id) as Array<Record<string, unknown>>;

  const result = rows.map(r => {
    let parsedData: Record<string, unknown> = {};
    try { parsedData = JSON.parse((r.data as string) || '{}'); } catch { /* datos corruptos, usar vacío */ }

    const selectedUnits = parsedData.selectedUnits as Array<Record<string, unknown>> | undefined;
    const unitsResumen = selectedUnits
      ? selectedUnits.map(u => ({ id: u.id, numero: u.numero, type: u.type }))
      : [];

    return {
      id: r.id,
      projectId: r.project_id,
      clienteRut: r.cliente_rut,
      clienteNombre: r.cliente_nombre,
      clienteId: r.cliente_id,
      fechaGenerada: r.fecha_generada,
      generadaPor: r.generada_por,
      selectedUnits: unitsResumen,
      data: parsedData,
    };
  });

  res.json(result);
});

app.post('/api/clients/bulk-import', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const { clients: clientList, projectId } = req.body as { clients: Array<Record<string, unknown>>; projectId: string };

  if (!Array.isArray(clientList) || clientList.length === 0) {
    res.status(400).json({ error: 'Lista de clientes vacía' });
    return;
  }

  const results = { success: 0, errors: [] as string[] };
  const now = new Date().toISOString();

  // Import best-effort por fila: cada INSERT es independiente (sin transacción única)
  // para preservar el "continúa ante error". En PostgreSQL un error dentro de una
  // transacción la aborta entera, por eso NO se envuelve en withTx.
  // ON CONFLICT (id) DO NOTHING ignora duplicados (antes INSERT OR IGNORE).
  for (let idx = 0; idx < clientList.length; idx++) {
    const c = clientList[idx];
    try {
      if (!c.nombre || !(c.nombre as string).trim()) {
        results.errors.push(`Fila ${idx + 2}: nombre requerido`);
        continue;
      }
      const id = (c.id as string | undefined) || crypto.randomUUID();
      await db.prepare(`
        INSERT INTO clients (
          id, project_id, tipo_persona, nombre, rut,
          email, telefono, direccion, ciudad, comuna,
          region, profesion, sueldo_range, fecha_nacimiento,
          nacionalidad, representante_nombre, representante_rut,
          estado, fecha_registro, historial, documents, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT (id) DO NOTHING
      `).run(
        id, (projectId || c.projectId) as string,
        (c.tipoPersona as string | undefined) || 'Natural',
        (c.nombre as string).trim(),
        (c.rut as string | undefined) || '',
        (c.email as string | undefined) || '',
        (c.telefono as string | undefined) || '',
        (c.direccion as string | undefined) || null,
        (c.ciudad as string | undefined) || null,
        (c.comuna as string | undefined) || null,
        (c.region as string | undefined) || null,
        (c.profesion as string | undefined) || null,
        (c.sueldoRange as string | undefined) || null,
        (c.fechaNacimiento as string | undefined) || null,
        (c.nacionalidad as string | undefined) || 'Chilena',
        (c.representanteNombre as string | undefined) || null,
        (c.representanteRut as string | undefined) || null,
        (c.estado as string | undefined) || 'Prospecto',
        now,
        JSON.stringify(c.historial || []),
        JSON.stringify(c.documents || []),
        now, now
      );
      results.success++;
    } catch (err) {
      results.errors.push(`Fila ${idx + 2}: ${(err as Error).message}`);
    }
  }
  res.json(results);
});

app.delete('/api/clients/:id', requireAuth, requireRole('Admin', 'Supervisor'), async (req, res) => {
  const result = await db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }
  res.json({ ok: true });
});

// ── 10. Units ─────────────────────────────────────────────────────────────────

app.get('/api/units', requireAuth, async (req, res) => {
  const { projectId, estado, type } = req.query as Record<string, string>;
  const userRole = (req as AuthenticatedRequest).userRole;
  const userId = (req as AuthenticatedRequest).userId;

  let rows: Array<Record<string, unknown>>;
  if (userRole === 'Ventas') {
    let ventasSql = `SELECT u.* FROM units u WHERE (u.estado IN ('Disponible', 'Libre Asignación') OR u.cliente_id IN (SELECT id FROM clients WHERE ejecutivo_id = ?))`;
    const ventasParams: Array<string | number | null> = [userId];
    if (projectId) { ventasSql += ' AND u.project_id = ?'; ventasParams.push(projectId); }
    if (estado) { ventasSql += ' AND u.estado = ?'; ventasParams.push(estado); }
    if (type) { ventasSql += ' AND u.type = ?'; ventasParams.push(type); }
    ventasSql += ' ORDER BY u.numero ASC';
    rows = await db.prepare(ventasSql).all(...ventasParams) as Array<Record<string, unknown>>;
  } else {
    let sql = 'SELECT * FROM units WHERE 1=1';
    const params: Array<string | number | null> = [];
    if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
    if (estado) { sql += ' AND estado = ?'; params.push(estado); }
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY numero ASC';
    rows = await db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }
  res.json(rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    numero: r.numero,
    type: r.type,
    estado: r.estado,
    superficie: r.superficie,
    orientacion: r.orientacion,
    piso: r.piso,
    dormitorios: r.dormitorios,
    banos: r.banos,
    gastoComun: r.gasto_comun,
    gastosOperacionales: r.gastos_operacionales,
    gastosNotariales: r.gastos_notariales,
    gastosConservador: r.gastos_conservador,
    bodegas: JSON.parse((r.bodegas as string) || '[]'),
    estacionamientos: JSON.parse((r.estacionamientos as string) || '[]'),
    clienteId: r.cliente_id,
    asignadoPor: r.asignado_por,
    fechaAsignacion: r.fecha_asignacion,
    precioLista: r.precio_lista,
    precioVenta: r.precio_venta,
    pie: r.pie,
    pieFormaPago: r.pie_forma_pago,
    pieCuotas: r.pie_cuotas,
    bonoDescuento: r.bono_descuento,
    reservaMonto: r.reserva_monto,
    reservaFormaPago: r.reserva_forma_pago,
    reservaCuotas: r.reserva_cuotas,
    creditoHipotecario: r.credito_hipotecario,
    tasaFinanciamiento: r.tasa_financiamiento,
    totalPagado: r.total_pagado,
    saldoPorPagar: r.saldo_por_pagar,
    canalVenta: r.canal_venta,
    intermediario: r.intermediario,
    banco: r.banco,
    notaria: r.notaria,
    repertorio: r.repertorio,
    fechaReserva: r.fecha_reserva,
    fechaPromesa: r.fecha_promesa,
    fechaSolicitudCredito: r.fecha_solicitud_credito,
    fechaAprobacionCredito: r.fecha_aprobacion_credito,
    fechaEscritura: r.fecha_escritura,
    fechaTerminoPago: r.fecha_termino_pago,
    fechaAlzamiento: r.fecha_alzamiento,
    fechaEntrega: r.fecha_entrega,
    fechaPago: r.fecha_pago,
    facturaNumero: r.factura_numero,
    facturaFecha: r.factura_fecha,
    recepcionMunicipalNumero: r.recepcion_municipal_numero,
    recepcionMunicipalFecha: r.recepcion_municipal_fecha,
    cbrFojas: r.cbr_fojas,
    cbrNumero: r.cbr_numero,
    cbrAno: r.cbr_ano,
    planPagos: JSON.parse((r.plan_pagos as string) || '[]'),
    observaciones: (r.observaciones as string) || '',
    documents: JSON.parse((r.documents as string) || '[]'),
    descuentoPct: r.descuento_pct,
    descuentoPendiente: r.descuento_pendiente === 1,
    descuentoSolicitudId: r.descuento_solicitud_id,
    aplicaBonoPie: r.aplica_bono_pie === 1,
    reservaVendedorId: r.reserva_vendedor_id,
    reservaExpira: r.reserva_expira,
    historialOcupacion: (() => { try { return JSON.parse((r.historial_ocupacion as string) || '[]'); } catch { return []; } })(),
  })));
});

app.post('/api/units', requireAuth, requireRole('Admin'), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = (body.id as string | undefined) || crypto.randomUUID();
  upsertUnit(body, id, now);
  res.json({ id, ...body });
});

app.patch('/api/units/:id', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const userName = (await getUserById(userId))?.name || '';
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }

  if (userRole === 'Ventas') {
    if (body.estado === 'Escriturado') {
      res.status(403).json({ error: 'Ventas no puede marcar una unidad como Escriturada' });
      return;
    }
    if ('precioLista' in body && body.precioLista !== existing.precio_lista) {
      res.status(403).json({ error: 'Ventas no puede modificar el precio de lista' });
      return;
    }
  }

  // Restrict resciliación (Promesado → Disponible) to Admin/Supervisor
  if ('estado' in body && body.estado === 'Disponible' && existing.estado === 'Promesado') {
    if (!['Admin', 'Supervisor'].includes(userRole)) {
      res.status(403).json({ error: 'Solo Admin o Supervisor pueden resciliar una unidad Promesada' });
      return;
    }
  }

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
  await db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  // Notify JefeSala when estado changes (Paso 11)
  if ('estado' in body && body.estado !== existing.estado) {
    createNotification({
      paraRol: 'JefeSala',
      titulo: 'Cambio de estado en unidad',
      mensaje: `${existing.type as string} ${existing.numero as string} cambió a ${body.estado as string}`,
      tipo: 'info',
      linkView: 'inventory',
    });
  }

  // Handle resciliación: Promesado → Disponible (close historial, unlink client)
  if ('estado' in body && body.estado === 'Disponible' && existing.estado === 'Promesado') {
    type HistEntry = { fechaFin?: string; [k: string]: unknown };
    const hist = (() => { try { return JSON.parse((existing.historial_ocupacion as string) || '[]') as HistEntry[]; } catch { return [] as HistEntry[]; } })();
    const updHist = hist.map((h, idx) => idx === hist.length - 1 && !h.fechaFin ? { ...h, fechaFin: now, motivo: 'Resciliación' } : h);
    await db.prepare(`UPDATE units SET historial_ocupacion = ?, cliente_id = NULL, asignado_por = NULL, fecha_asignacion = NULL, reserva_vendedor_id = NULL, reserva_expira = NULL, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(updHist), now, req.params.id);
    createAuditLog(userId, userName, userRole, 'Resciliación', 'Unit', req.params.id, `Unidad ${existing.type as string} ${existing.numero as string} resciliada por ${userName}`);
    createNotification({ paraRol: 'JefeSala', titulo: 'Resciliación registrada', mensaje: `${existing.type as string} ${existing.numero as string} fue resciliada por ${userName}`, tipo: 'warning', linkView: 'inventory', relatedId: req.params.id });
  }

  // Notify JefeSala when a planPagos item is marked Pagado (Paso 11)
  if ('planPagos' in body && Array.isArray(body.planPagos)) {
    type PlanItem = { id: string; status: string };
    const prevPlan = (() => { try { return JSON.parse((existing.plan_pagos as string) || '[]') as PlanItem[]; } catch { return [] as PlanItem[]; } })();
    const newPlan = body.planPagos as PlanItem[];
    const newlyPaid = newPlan.filter(item => item.status === 'Pagado' && prevPlan.find(p => p.id === item.id)?.status !== 'Pagado');
    if (newlyPaid.length > 0) {
      createNotification({ paraRol: 'JefeSala', titulo: 'Pago registrado', mensaje: `Se registró ${newlyPaid.length} pago(s) en ${existing.type as string} ${existing.numero as string}`, tipo: 'success', linkView: 'inventory', relatedId: req.params.id });
    }
  }

  res.json({ ok: true });
});

app.patch('/api/units/:id/assign', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const body = req.body as { clienteId: string; asignadoPor?: string; fechaAsignacion?: string; fechaReserva?: string };
  const { id } = req.params;
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const userName = (await getUserById(userId))?.name || '';
  const now = new Date().toISOString();

  try {
    const { numero, type } = await withTx(async (tx) => {
      const unit = await tx.prepare(
        'SELECT id, estado, cliente_id, project_id, numero, type, historial_ocupacion FROM units WHERE id = ?'
      ).get(id) as { id: string; estado: string; cliente_id: string | null; project_id: string; numero: string; type: string; historial_ocupacion: string } | undefined;

      if (!unit) throw new Error('UNIT_NOT_FOUND');

      const isAvailable = ['Disponible', 'Libre Asignación'].includes(unit.estado);
      const isSameClient = unit.cliente_id === body.clienteId;
      const canReassign = ['Admin', 'JefeSala', 'Supervisor'].includes(userRole);

      if (!isAvailable && !isSameClient && !(canReassign && unit.estado === 'Reservado')) {
        throw new Error(`UNIT_NOT_AVAILABLE:${unit.estado}`);
      }

      // Get client info for historial
      const cliente = await tx.prepare('SELECT id, nombre, rut FROM clients WHERE id = ?').get(body.clienteId) as { id: string; nombre: string; rut?: string } | undefined;
      const clienteNombre = cliente?.nombre || '';
      const clienteRut = cliente?.rut || '';

      // Calculate reservation expiry
      const config = await getProjectDiscountConfig(unit.project_id);
      const expira = new Date(new Date(now).getTime() + config.duracionReservaDias * 24 * 60 * 60 * 1000).toISOString();

      // Build historial
      type HistEntry = { fechaFin?: string; [k: string]: unknown };
      const hist = (() => { try { return JSON.parse(unit.historial_ocupacion || '[]') as HistEntry[]; } catch { return [] as HistEntry[]; } })();
      if (unit.cliente_id && unit.cliente_id !== body.clienteId) {
        const lastIdx = hist.length - 1;
        if (lastIdx >= 0 && !hist[lastIdx].fechaFin) {
          hist[lastIdx] = { ...hist[lastIdx], fechaFin: now, motivo: 'Reasignación' };
        }
      }
      hist.push({ tipo: 'Reserva', clienteId: body.clienteId, clienteNombre, clienteRut, vendedorId: userId, vendedorNombre: userName, fechaInicio: now });

      await tx.prepare(`
        UPDATE units SET
          cliente_id = ?,
          asignado_por = ?,
          fecha_asignacion = ?,
          fecha_reserva = COALESCE(fecha_reserva, ?),
          estado = 'Reservado',
          reserva_vendedor_id = ?,
          reserva_expira = ?,
          historial_ocupacion = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(body.clienteId, body.asignadoPor ?? userId, body.fechaAsignacion ?? now, body.fechaReserva ?? now, userId, expira, JSON.stringify(hist), id);

      return { numero: unit.numero, type: unit.type };
    });
    createAuditLog(userId, userName, userRole, 'Asignación', 'Unit', id, `Unidad asignada a cliente ${body.clienteId}`);
    createNotification({ paraRol: 'JefeSala', titulo: 'Unidad reservada', mensaje: `${userName} reservó ${type} ${numero}`, tipo: 'info', linkView: 'inventory', relatedId: id });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    if (msg === 'UNIT_NOT_FOUND') { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
    if (msg?.startsWith('UNIT_NOT_AVAILABLE')) {
      const estado = msg.split(':')[1];
      res.status(409).json({ error: `La unidad ya no está disponible (estado: ${estado})`, code: 'UNIT_NOT_AVAILABLE' });
      return;
    }
    throw err;
  }
});

app.patch('/api/units/:id/unassign', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor', 'Ventas'), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const userName = (await getUserById(userId))?.name || '';
  const now = new Date().toISOString();
  // Al desistir/desasignar también se limpian los datos de reserva (fecha, vendedor, expiración),
  // si no la fecha de reserva quedaba pegada (bug reportado).
  const result = await db.prepare(`UPDATE units SET cliente_id = NULL, asignado_por = NULL, fecha_asignacion = NULL, fecha_reserva = NULL, reserva_vendedor_id = NULL, reserva_expira = NULL, estado = 'Disponible', updated_at = ? WHERE id = ?`)
    .run(now, req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
  createAuditLog(userId, userName, userRole, 'Desasignación', 'Unit', req.params.id, 'Cliente desasignado de la unidad');
  res.json({ ok: true });
});

app.post('/api/units/:id/liberar', requireAuth, requireRole('Admin', 'JefeSala', 'Supervisor'), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const userRole = (req as AuthenticatedRequest).userRole;
  const userName = (await getUserById(userId))?.name || '';
  const now = new Date().toISOString();

  const unit = await db.prepare('SELECT id, estado, numero, type, cliente_id, reserva_vendedor_id, historial_ocupacion FROM units WHERE id = ?')
    .get(req.params.id) as { id: string; estado: string; numero: string; type: string; cliente_id: string | null; reserva_vendedor_id: string | null; historial_ocupacion: string } | undefined;
  if (!unit) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
  if (unit.estado !== 'Reservado') { res.status(400).json({ error: 'La unidad no está en estado Reservado' }); return; }

  type HistEntry = { fechaFin?: string; [k: string]: unknown };
  const hist = (() => { try { return JSON.parse(unit.historial_ocupacion || '[]') as HistEntry[]; } catch { return [] as HistEntry[]; } })();
  const updHist = hist.map((h, idx) => idx === hist.length - 1 && !h.fechaFin ? { ...h, fechaFin: now, motivo: 'Liberación manual' } : h);

  await db.prepare(`
    UPDATE units SET
      estado = 'Disponible',
      cliente_id = NULL,
      asignado_por = NULL,
      fecha_asignacion = NULL,
      fecha_reserva = NULL,
      reserva_vendedor_id = NULL,
      reserva_expira = NULL,
      historial_ocupacion = ?,
      updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(updHist), now, req.params.id);

  if (unit.cliente_id) {
    await db.prepare(`UPDATE clients SET estado = 'Prospecto' WHERE id = ?`).run(unit.cliente_id);
  }

  createAuditLog(userId, userName, userRole, 'Liberación reserva', 'Unit', req.params.id,
    `Reserva liberada manualmente en ${unit.type} ${unit.numero} por ${userName}`);

  if (unit.reserva_vendedor_id) {
    createNotification({ paraUserId: unit.reserva_vendedor_id, titulo: 'Reserva liberada', mensaje: `${unit.type} ${unit.numero} fue liberada por ${userName}`, tipo: 'warning', linkView: 'inventory', relatedId: req.params.id });
  }
  createNotification({ paraRol: 'JefeSala', titulo: 'Reserva liberada manualmente', mensaje: `${unit.type} ${unit.numero} fue liberada por ${userName}`, tipo: 'info', linkView: 'inventory', relatedId: req.params.id });

  res.json({ ok: true });
});

// ── 11. Sincronización de Estado ─────────────────────────────────────────────

app.post('/api/sync', requireAuth, async (req, res) => {
  const { key, value } = req.body as { key: string; value: unknown };
  if (!key) { res.status(400).json({ error: 'Key requerida' }); return; }
  const userId = (req as AuthenticatedRequest).userId;
  const now = new Date().toISOString();

  await db.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
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

// Restringido a Admin: este sync expone el estado completo (todos los proyectos).
// El frontend no lo usa; se mantiene solo para administración/depuración.
app.get('/api/sync/:key', requireAuth, requireRole('Admin'), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (req.params.key === 'app_state') {
    const fromTables = await buildAppStateFromTables();
    if (fromTables) {
      res.json({ key: 'app_state', value: fromTables, updatedAt: new Date().toISOString() });
      return;
    }
  }

  const row = await db.prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .get(`${userId}:${req.params.key}`) as { value: string; updated_at: string } | undefined;
  if (!row) { res.status(404).json({ error: 'No encontrado' }); return; }
  res.json({ key: req.params.key, value: JSON.parse(row.value), updatedAt: row.updated_at });
});

// ── Manejo global de errores ──────────────────────────────────────────────────
// 404 JSON para rutas /api no encontradas (en vez del HTML por defecto de Express).
app.use('/api', (_req: express.Request, res: express.Response) => {
  if (res.headersSent) return;
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ── Servir el frontend (producción) ───────────────────────────────────────────
// Si existe el build (dist/), Express sirve los estáticos y hace fallback SPA a
// index.html, same-origin (elimina CORS y simplifica el proxy, que solo termina TLS).
// En dev, Vite sirve el frontend y dist/ no existe, así que este bloque no aplica.
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// Error handler global (4 argumentos). Captura lo que propaga asyncHandler y
// cualquier throw síncrono. Responde 500 genérico SIN filtrar el stack al cliente.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR no controlado]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Red de seguridad a nivel de proceso: evita que una promesa rechazada o una
// excepción no capturada que se escape de los handlers tumbe el servidor.
// NOTA: cuando exista el process manager (systemd Restart=always, Fase 3), conviene
// que uncaughtException haga un cierre ordenado + exit(1) en vez de seguir vivo.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ── Arranque ─────────────────────────────────────────────────────────────────
// Solo arranca cuando se ejecuta directamente; al importarlo (tests) se exporta `app`.
// init() verifica la conexión, corre migraciones idempotentes y recién ahí escucha.
if (isMain) {
  void (async () => {
    try {
      await ping();
      await migrateFromAppState();
      await ensureProjectConfigs();
      await migrateReservas();
      await checkReservasVencidas();
      setInterval(() => { void checkReservasVencidas(); }, 60 * 60 * 1000);
      const server = app.listen(PORT, () => {
        console.log(`\n[DanaWorks Server] ✓ Escuchando en http://localhost:${PORT}`);
        console.log(`[DanaWorks Server] ✓ BD: PostgreSQL/${process.env.PGDATABASE || 'danacorp'}`);
        console.log(`[DanaWorks Server] ✓ CORS: ${FRONTEND_URL}\n`);
      });

      // Graceful shutdown: deja de aceptar conexiones, cierra el pool y sale.
      const shutdown = (sig: string) => {
        console.log(`\n[${sig}] cerrando ordenadamente...`);
        server.close(() => { void pool.end().then(() => process.exit(0)); });
        setTimeout(() => process.exit(1), 10000).unref(); // tope si algo cuelga
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (err) {
      console.error('[FATAL] Error de arranque (¿PostgreSQL accesible? ¿esquema aplicado?):', err);
      process.exit(1);
    }
  })();
}

export { app };
