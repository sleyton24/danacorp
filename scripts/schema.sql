-- Esquema PostgreSQL de DanaCorp — generado desde el esquema SQLite real.
-- Idempotente: CREATE TABLE IF NOT EXISTS. Aplicar una vez por base.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  fecha_creacion TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  jefe_max_pct DOUBLE PRECISION DEFAULT 3 NOT NULL,
  supervisor_max_pct DOUBLE PRECISION DEFAULT 8 NOT NULL,
  bono_pie_pct DOUBLE PRECISION DEFAULT 10 NOT NULL,
  vigencia_cotizacion_dias INTEGER DEFAULT 7 NOT NULL,
  reserva_clp DOUBLE PRECISION,
  nombre_inmobiliaria TEXT,
  direccion_proyecto TEXT,
  comuna_proyecto TEXT,
  ciudad_proyecto TEXT,
  cantidad_cuotas_pie INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  duracion_cotizacion_dias INTEGER DEFAULT 10
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tipo_persona TEXT DEFAULT 'Natural' NOT NULL,
  nombre TEXT NOT NULL,
  rut TEXT NOT NULL,
  nacionalidad TEXT,
  profesion TEXT,
  sueldo_range TEXT,
  fecha_nacimiento TEXT,
  email TEXT DEFAULT '' NOT NULL,
  telefono TEXT DEFAULT '' NOT NULL,
  direccion TEXT,
  ciudad TEXT,
  comuna TEXT,
  region TEXT,
  ejecutivo_id TEXT,
  estado TEXT DEFAULT 'Activo' NOT NULL,
  fecha_registro TEXT,
  representante_nombre TEXT,
  representante_rut TEXT,
  representante_nacionalidad TEXT,
  representante_email TEXT,
  representante_telefono TEXT,
  representante_direccion TEXT,
  historial TEXT DEFAULT '[]' NOT NULL,
  documents TEXT DEFAULT '[]' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT DEFAULT 'Departamento' NOT NULL,
  numero TEXT NOT NULL,
  estado TEXT DEFAULT 'Disponible' NOT NULL,
  superficie DOUBLE PRECISION,
  orientacion TEXT,
  piso INTEGER,
  dormitorios INTEGER,
  banos INTEGER,
  gasto_comun DOUBLE PRECISION,
  gastos_operacionales DOUBLE PRECISION,
  gastos_notariales DOUBLE PRECISION,
  gastos_conservador DOUBLE PRECISION,
  bodegas TEXT DEFAULT '[]' NOT NULL,
  estacionamientos TEXT DEFAULT '[]' NOT NULL,
  cliente_id TEXT,
  asignado_por TEXT,
  fecha_asignacion TEXT,
  precio_lista DOUBLE PRECISION DEFAULT 0 NOT NULL,
  precio_venta DOUBLE PRECISION DEFAULT 0 NOT NULL,
  pie DOUBLE PRECISION DEFAULT 0 NOT NULL,
  pie_forma_pago TEXT,
  pie_cuotas INTEGER,
  bono_descuento DOUBLE PRECISION DEFAULT 0 NOT NULL,
  reserva_monto DOUBLE PRECISION DEFAULT 0 NOT NULL,
  reserva_forma_pago TEXT,
  reserva_cuotas INTEGER,
  credito_hipotecario DOUBLE PRECISION DEFAULT 0 NOT NULL,
  tasa_financiamiento DOUBLE PRECISION,
  total_pagado DOUBLE PRECISION DEFAULT 0 NOT NULL,
  saldo_por_pagar DOUBLE PRECISION DEFAULT 0 NOT NULL,
  canal_venta TEXT,
  intermediario TEXT,
  banco TEXT,
  notaria TEXT,
  repertorio TEXT,
  fecha_reserva TEXT,
  fecha_promesa TEXT,
  fecha_solicitud_credito TEXT,
  fecha_aprobacion_credito TEXT,
  fecha_escritura TEXT,
  fecha_termino_pago TEXT,
  fecha_alzamiento TEXT,
  fecha_entrega TEXT,
  fecha_pago TEXT,
  factura_numero TEXT,
  factura_fecha TEXT,
  recepcion_municipal_numero TEXT,
  recepcion_municipal_fecha TEXT,
  cbr_fojas TEXT,
  cbr_numero TEXT,
  cbr_ano TEXT,
  plan_pagos TEXT DEFAULT '[]' NOT NULL,
  observaciones TEXT DEFAULT '' NOT NULL,
  documents TEXT DEFAULT '[]' NOT NULL,
  descuento_pct DOUBLE PRECISION,
  descuento_pendiente INTEGER,
  descuento_solicitud_id TEXT,
  aplica_bono_pie INTEGER,
  extras TEXT DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  cotizacion_activa_id TEXT,
  cotizacion_activa_vendedor_id TEXT,
  cotizacion_activa_expira TEXT,
  reserva_vendedor_id TEXT,
  reserva_expira TEXT,
  historial_ocupacion TEXT DEFAULT '[]',
  precio_lista_original REAL
);

CREATE TABLE IF NOT EXISTS quotation_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT NOT NULL,
  cliente_rut TEXT,
  cliente_nombre TEXT,
  data TEXT DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  estado TEXT DEFAULT 'borrador',
  fecha_generada TEXT,
  generada_por TEXT,
  cliente_id TEXT,
  pdf_path TEXT
);

-- NOTA: corregido respecto al esquema derivado de SQLite, que tenía 'user_id'
-- (deriva de un esquema viejo). El código usa 'vendedor_id' en INSERT/SELECT.
CREATE TABLE IF NOT EXISTS discount_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  unit_numero TEXT NOT NULL,
  vendedor_id TEXT NOT NULL,
  vendedor_nombre TEXT NOT NULL DEFAULT '',
  cotizacion_id TEXT,
  precio_original DOUBLE PRECISION NOT NULL,
  precio_solicitado DOUBLE PRECISION NOT NULL,
  descuento_pct DOUBLE PRECISION NOT NULL,
  descuento_monto DOUBLE PRECISION NOT NULL,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  aprobado_jefe_id TEXT,
  aprobado_jefe_at TIMESTAMPTZ,
  aprobado_supervisor_id TEXT,
  aprobado_supervisor_at TIMESTAMPTZ,
  rechazado_por_id TEXT,
  rechazado_por_at TIMESTAMPTZ,
  rechazo_motivo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  para_user_id TEXT,
  para_rol TEXT,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  tipo TEXT DEFAULT 'info' NOT NULL,
  leida INTEGER DEFAULT 0 NOT NULL,
  link_view TEXT,
  related_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  description TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_plans (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL,
  unit_numero TEXT NOT NULL,
  project_id TEXT NOT NULL,
  cliente_id TEXT,
  cliente_rut TEXT,
  cliente_nombre TEXT,
  precio_venta_final DOUBLE PRECISION DEFAULT 0 NOT NULL,
  promesa_pct DOUBLE PRECISION DEFAULT 0 NOT NULL,
  cuotas_pct DOUBLE PRECISION DEFAULT 0 NOT NULL,
  cuotas_n INTEGER DEFAULT 0 NOT NULL,
  escritura_pct DOUBLE PRECISION DEFAULT 0 NOT NULL,
  credito_pct DOUBLE PRECISION DEFAULT 0 NOT NULL,
  bono_pie_pct DOUBLE PRECISION DEFAULT 0 NOT NULL,
  aplica_bono_pie INTEGER DEFAULT 0 NOT NULL,
  descuento_pct DOUBLE PRECISION DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT '{}' NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Usuarios (antes hardcodeados en server.ts; ahora con hash bcrypt).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  company TEXT,
  assigned_project_ids JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices útiles para los filtros más comunes.
CREATE INDEX IF NOT EXISTS idx_units_project ON units(project_id);
CREATE INDEX IF NOT EXISTS idx_clients_project ON clients(project_id);
CREATE INDEX IF NOT EXISTS idx_drafts_project ON quotation_drafts(project_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON quotation_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_discount_project ON discount_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_unit ON payment_plans(unit_numero, project_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(para_user_id);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  precio_anterior REAL NOT NULL,
  precio_nuevo REAL NOT NULL,
  variacion_pct REAL NOT NULL,
  motivo TEXT,
  usuario_id TEXT NOT NULL,
  usuario_nombre TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_unit ON price_history(unit_id);
