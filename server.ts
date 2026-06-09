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
  const rows = db.prepare(
    'SELECT * FROM quotation_drafts WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(userId) as Array<Record<string, unknown>>;

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

// Helper: Get project discount config from app_state
function getProjectDiscountConfig(userId: string, projectId: string): {
  jefeMaxPct: number; supervisorMaxPct: number; bonoPiePct: number; vigenciaCotizacionDias: number;
} {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?')
    .get(`${userId}:project_config_${projectId}`) as { value: string } | undefined;
  if (row) {
    try {
      const cfg = JSON.parse(row.value) as { discountConfig?: { jefeMaxPct?: number; supervisorMaxPct?: number }; bonoPiePct?: number; vigenciaCotizacionDias?: number };
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

  // Get project config (try all admin users' keys to find the config)
  const adminRows = db.prepare(
    `SELECT key, value FROM app_state WHERE key LIKE '%project_config_${dr.project_id}'`
  ).all() as Array<{ key: string; value: string }>;

  let discountCfg = { jefeMaxPct: 3, supervisorMaxPct: 8 };
  if (adminRows.length > 0) {
    try {
      const cfg = JSON.parse(adminRows[0].value) as { discountConfig?: { jefeMaxPct?: number; supervisorMaxPct?: number } };
      discountCfg = {
        jefeMaxPct: cfg.discountConfig?.jefeMaxPct ?? 3,
        supervisorMaxPct: cfg.discountConfig?.supervisorMaxPct ?? 8,
      };
    } catch { /* use defaults */ }
  }

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

// ── 8. Sincronización de Estado ──────────────────────────────────────────────

app.post('/api/sync', requireAuth, (req, res) => {
  const { key, value } = req.body as { key: string; value: unknown };
  if (!key) {
    res.status(400).json({ error: 'Key requerida' });
    return;
  }
  const userId = (req as AuthenticatedRequest).userId;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(`${userId}:${key}`, JSON.stringify(value), now);

  res.json({ ok: true });
});

app.get('/api/sync/:key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const row = db.prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .get(`${userId}:${req.params.key}`) as { value: string; updated_at: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'No encontrado' });
    return;
  }
  res.json({
    key: req.params.key,
    value: JSON.parse(row.value),
    updatedAt: row.updated_at,
  });
});

// ── Arranque ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[DanaWorks Server] ✓ Escuchando en http://localhost:${PORT}`);
  console.log(`[DanaWorks Server] ✓ BD: ${path.join(__dirname, 'danacorp.db')}`);
  console.log(`[DanaWorks Server] ✓ CORS: ${FRONTEND_URL}\n`);
});
