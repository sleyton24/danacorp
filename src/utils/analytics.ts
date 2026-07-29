import { RealEstateUnit, PaymentItem, Client } from '../types';

/**
 * Definiciones compartidas entre Resumen (SummaryDashboard) y Performance
 * (SalesPerformanceView). Antes cada vista reimplementaba "contar unidades por estado y
 * sumar precioVenta" por su cuenta, y el literal ['Reservado','Promesado','Escriturado']
 * estaba duplicado cuatro veces. Cualquier métrica que las dos vistas deban responder
 * igual vive acá.
 *
 * Todas las funciones son puras: sin fetch, sin Date.now() implícito (el "ahora" se
 * inyecta), sin estado. Los tests viven en tests/analytics.test.ts.
 */

// ── Alcances de estado ────────────────────────────────────────────────────────
// Deliberadamente NO existe un booleano `esVendido`. Distintos bloques necesitan
// conjuntos distintos y colapsarlos en uno solo es lo que hacía que las dos vistas
// dijeran cosas diferentes. Cada sitio de uso elige un alcance y lo nombra.

/** Venta cerrada de verdad. Es el único alcance que cuenta como avance del proyecto. */
export const ESTADOS_ESCRITURADO = ['Escriturado'] as const;
/** Comprometido: hay promesa firmada o escritura. Las promesas se pueden resciliar. */
export const ESTADOS_COMPROMETIDO = ['Promesado', 'Escriturado'] as const;
/** Tomado: la unidad no está ofertable, incluida la reserva (revocable). */
export const ESTADOS_TOMADO = ['Reservado', 'Promesado', 'Escriturado'] as const;

export const esEscriturado = (estado: string): boolean =>
  (ESTADOS_ESCRITURADO as readonly string[]).includes(estado);
export const esComprometido = (estado: string): boolean =>
  (ESTADOS_COMPROMETIDO as readonly string[]).includes(estado);
export const estaTomado = (estado: string): boolean =>
  (ESTADOS_TOMADO as readonly string[]).includes(estado);

/**
 * Roles que pueden tener unidades atribuidas. Antes estaba hardcodeado como
 * `role === 'Ventas' || role === 'JefeSala'` en dos lugares de Performance, así que un
 * Supervisor o Admin que cerrara una venta no aparecía en ningún ranking.
 */
export const ROLES_VENDEDORES = ['Ventas', 'JefeSala', 'Supervisor', 'Admin'] as const;
export const esRolVendedor = (role: string): boolean =>
  (ROLES_VENDEDORES as readonly string[]).includes(role);

// ── Sumas y conteos ───────────────────────────────────────────────────────────

/**
 * Suma de precioVenta en UF sobre TODOS los tipos de unidad — departamentos, bodegas y
 * estacionamientos. Resumen sumaba solo departamentos y Performance sumaba todo, que era
 * una de las razones por las que las dos vistas no coincidían.
 */
export const sumarUF = (units: RealEstateUnit[]): number =>
  units.reduce((total, u) => {
    const v = Number(u.precioVenta);
    return total + (Number.isFinite(v) ? v : 0);
  }, 0);

export interface ConteoEstados {
  disponible: number;
  reservado: number;
  promesado: number;
  escriturado: number;
  /** promesado + escriturado */
  comprometido: number;
  /** reservado + promesado + escriturado */
  tomado: number;
  total: number;
}

/** Los tres tramos en una sola pasada, en vez de un filter por tramo. */
export function contarPorEstado(units: RealEstateUnit[]): ConteoEstados {
  const c: ConteoEstados = {
    disponible: 0, reservado: 0, promesado: 0, escriturado: 0,
    comprometido: 0, tomado: 0, total: 0,
  };
  for (const u of units) {
    c.total++;
    switch (u.estado) {
      case 'Disponible': c.disponible++; break;
      case 'Reservado': c.reservado++; c.tomado++; break;
      case 'Promesado': c.promesado++; c.comprometido++; c.tomado++; break;
      case 'Escriturado': c.escriturado++; c.comprometido++; c.tomado++; break;
      // 'Libre Asignación' y 'Asignado' son estados de bodegas/estacionamientos: no
      // tienen tramo propio, su estado real se resuelve con estadoEfectivoUnidad.
      default: break;
    }
  }
  return c;
}

// ── Montos de cuotas ──────────────────────────────────────────────────────────

/**
 * Convierte un monto escrito por un usuario a número, o null si no se puede.
 * Tolera el formato chileno ("1.234,5"), símbolos de moneda y espacios.
 *
 * NOTA: la causa raíz de este saneamiento es que PaymentItem.amount es `string`
 * (types.ts) y el input de PaymentTable es libre, así que un valor pegado desde Excel
 * llegaba a Number() y producía NaN, que envenenaba el total completo de Recaudado.
 * Cambiar el tipo a number toca el editor de cronogramas y es otro alcance.
 */
export function parsearMonto(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;

  // Deja solo dígitos, separadores y signo.
  let s = valor.trim().replace(/[^\d,.-]/g, '');
  if (s === '' || s === '-' || s === '.' || s === ',') return null;

  const tienePunto = s.includes('.');
  const tieneComa = s.includes(',');

  if (tienePunto && tieneComa) {
    // "1.234,5" → el punto es separador de miles y la coma es decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (tieneComa) {
    // "1234,5" → coma decimal.
    s = s.replace(',', '.');
  } else if (tienePunto) {
    // Ambiguo: "1.234" son mil doscientos treinta y cuatro en formato chileno, pero
    // "12.5" es un decimal. Solo tratamos el punto como miles si el patrón es
    // exactamente grupos de 3 dígitos.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Suma las cuotas en estado 'Pagado' de un plan de pagos, descartando los montos que no
 * parsean en vez de propagar NaN. Un solo valor corrupto no debe romper el total.
 */
export function sumarPagado(planPagos: PaymentItem[] | null | undefined): number {
  if (!Array.isArray(planPagos)) return 0;
  let total = 0;
  for (const p of planPagos) {
    if (!p || p.status !== 'Pagado') continue;
    const monto = parsearMonto(p.amount);
    if (monto !== null) total += monto;
  }
  return total;
}

// ── Fechas ────────────────────────────────────────────────────────────────────

/**
 * Parser tolerante. `clients.fecha_registro` guarda DOS formatos según cómo entró el
 * registro: la UI escribe "27-07-2026" (toLocaleDateString('es-CL')) y el backend escribe
 * ISO (new Date().toISOString()). El parser anterior asumía DD-MM-YYYY y con una fecha ISO
 * devolvía Invalid Date en silencio.
 *
 * Devuelve null cuando realmente no se puede parsear — nunca una fecha inventada.
 */
export function parseFechaFlexible(s: string | null | undefined): Date | null {
  if (typeof s !== 'string') return null;
  const txt = s.trim();
  if (txt === '') return null;

  // ISO solo-fecha: se construye en hora LOCAL a propósito. `new Date('2026-07-01')`
  // se interpreta como medianoche UTC y en Chile cae el 30 de junio, corriendo el
  // registro al mes anterior en las agrupaciones mensuales.
  const isoFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt);
  if (isoFecha) {
    return fechaLocalValida(Number(isoFecha[1]), Number(isoFecha[2]), Number(isoFecha[3]));
  }

  // ISO completo con hora: es un instante, se respeta su zona.
  if (/^\d{4}-\d{2}-\d{2}T/.test(txt)) {
    const d = new Date(txt);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD-MM-YYYY o DD/MM/YYYY.
  const partes = txt.split(/[-/]/);
  if (partes.length === 3) {
    const [dd, mm, yyyy] = partes.map(p => Number(p));
    if ([dd, mm, yyyy].every(n => Number.isInteger(n))) {
      return fechaLocalValida(yyyy, mm, dd);
    }
  }

  return null;
}

/** Construye una fecha local y rechaza componentes fuera de rango (32-13-2026). */
function fechaLocalValida(anio: number, mes: number, dia: number): Date | null {
  if (anio < 1900 || anio > 2200 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(anio, mes - 1, dia);
  if (isNaN(d.getTime())) return null;
  // Rechaza el rollover de JS: 31-02 se convertiría en 03-03.
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

/** Clave YYYY-MM en hora local, para agrupaciones mensuales. */
export function bucketMes(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}`;
}

export type Periodo = 'all' | 'year' | 'quarter' | 'month';

/**
 * ¿La fecha cae en el período, relativo a `ahora`? Una fecha null queda FUERA de
 * cualquier período acotado — antes se colaba dentro de todos.
 */
export function enPeriodo(fecha: Date | null, periodo: Periodo, ahora: Date): boolean {
  if (periodo === 'all') return true;
  if (!fecha) return false;
  if (fecha.getFullYear() !== ahora.getFullYear()) return false;
  if (periodo === 'year') return true;
  if (periodo === 'quarter') return Math.floor(fecha.getMonth() / 3) === Math.floor(ahora.getMonth() / 3);
  return fecha.getMonth() === ahora.getMonth();
}

// ── Vínculos bodega/estacionamiento → departamento ────────────────────────────

/**
 * Índice de unidades vinculadas a su departamento padre. Clave `${tipo}:${numero}`.
 *
 * El tipo forma parte de la clave porque la versión anterior buscaba el número en
 * `estacionamientos` y en `bodegas` a la vez: una bodega "12" y un estacionamiento "12"
 * resolvían al mismo padre, así que una de las dos heredaba el estado del departamento
 * equivocado.
 *
 * Guarda el departamento completo (no solo su estado) para que también se pueda heredar
 * la fecha del hito — sin eso, al filtrar por período las bodegas y estacionamientos
 * quedarían fuera siempre, porque no tienen fecha propia.
 */
export type IndiceVinculos = Map<string, RealEstateUnit>;

const claveVinculo = (tipo: string, numero: string) => `${tipo}:${String(numero).trim()}`;

export function crearIndiceVinculos(deptos: RealEstateUnit[]): IndiceVinculos {
  const indice: IndiceVinculos = new Map();
  for (const depto of deptos) {
    for (const numero of depto.bodegas || []) {
      const k = claveVinculo('Bodega', numero);
      // Si dos departamentos declaran la misma bodega, gana el primero. Es un dato
      // inconsistente en origen; acá no se adivina.
      if (!indice.has(k)) indice.set(k, depto);
    }
    for (const numero of depto.estacionamientos || []) {
      const k = claveVinculo('Estacionamiento', numero);
      if (!indice.has(k)) indice.set(k, depto);
    }
  }
  return indice;
}

/** El departamento al que está vinculada la unidad, si lo hay. */
export function departamentoPadre(
  unit: RealEstateUnit,
  vinculos: IndiceVinculos | RealEstateUnit[],
): RealEstateUnit | undefined {
  if (unit.type === 'Departamento') return undefined;
  const indice = Array.isArray(vinculos) ? crearIndiceVinculos(vinculos) : vinculos;
  return indice.get(claveVinculo(unit.type, unit.numero));
}

/**
 * Estado comercial real de una unidad. Los departamentos usan su propio estado; las
 * bodegas y estacionamientos heredan el del departamento al que están vinculados, porque
 * nacen como 'Libre Asignación' y pasan a 'Asignado' — estados que no entran en ningún
 * alcance y hacían que sus métricas fueran 0 de forma permanente.
 *
 * Pasar el índice ya construido (crearIndiceVinculos) para no reconstruirlo por unidad.
 */
export function estadoEfectivoUnidad(
  unit: RealEstateUnit,
  vinculos: IndiceVinculos | RealEstateUnit[],
): string {
  if (unit.type === 'Departamento') return unit.estado;
  return departamentoPadre(unit, vinculos)?.estado ?? 'Disponible';
}

/**
 * Fecha del hito que corresponde al estado efectivo: escritura para lo escriturado,
 * promesa para lo prometido, reserva para lo reservado. Las bodegas y estacionamientos
 * heredan la del departamento padre. Una unidad disponible no tiene hito: devuelve null,
 * y por lo tanto queda fuera de cualquier período acotado.
 */
export function fechaHitoUnidad(
  unit: RealEstateUnit,
  vinculos: IndiceVinculos | RealEstateUnit[],
): Date | null {
  const fuente = unit.type === 'Departamento' ? unit : (departamentoPadre(unit, vinculos) ?? unit);
  const estado = unit.type === 'Departamento' ? unit.estado : estadoEfectivoUnidad(unit, vinculos);
  if (esEscriturado(estado)) return parseFechaFlexible(fuente.fechaEscritura);
  if (estado === 'Promesado') return parseFechaFlexible(fuente.fechaPromesa);
  if (estado === 'Reservado') return parseFechaFlexible(fuente.fechaReserva);
  return null;
}

// ── Atribución de la venta ────────────────────────────────────────────────────

/**
 * Quién vendió la unidad. La atribución vive en la unidad, no en el cliente: pasar por
 * `cliente.ejecutivoId` hacía que reasignar un cliente moviera retroactivamente todo su
 * histórico de UF al nuevo ejecutivo.
 *
 * Orden: ejecutivoId de la unidad → reservaVendedorId → (compatibilidad con datos
 * viejos) ejecutivoId del cliente.
 */
export function vendedorAtribuidoId(
  unit: RealEstateUnit,
  cliente?: Client | null,
): string | undefined {
  if (unit.ejecutivoId) return unit.ejecutivoId;
  // 'system' es el centinela que usa el backend cuando reserva sin ejecutivo conocido
  // (server.ts: `cliente?.ejecutivo_id || 'system'`). No es un vendedor: se ignora para
  // que la unidad pueda caer al fallback en vez de atribuirse a un usuario inexistente.
  if (unit.reservaVendedorId && unit.reservaVendedorId !== 'system') return unit.reservaVendedorId;
  // Fallback de compatibilidad: unidades cargadas antes de que existiera
  // units.ejecutivo_id. No usar para datos nuevos.
  return cliente?.ejecutivoId ?? undefined;
}
