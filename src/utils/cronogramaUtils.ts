// ── Cronograma de pagos: fechas de cuota + ordenamiento manual ─────────────────
//
// Lógica PURA, sin dependencias de React/DB, para poder testearla aislada.
// Las fechas son strings "YYYY-MM-DD" (formato de <input type="date">). Comparar
// esos strings lexicográficamente equivale a compararlos cronológicamente, así que
// no usamos Date (evita sorpresas de zona horaria) salvo para el cálculo de días.
//
// HISTORIA — por qué ya no hay automatismos de fecha:
// Este módulo tenía dos: `insertarFilaOrdenada` (metía la cuota nueva en su lugar
// cronológico) y `recalcularCronograma` (al editar una fecha, cascadeaba +1 mes a
// TODAS las filas de abajo). Ambos se eliminaron a pedido del usuario: movían filas
// que nadie tocó y hacían imposible fijar una fecha suelta. Hoy editar una fecha
// afecta SOLO a esa fila, y el orden lo decide el usuario haciendo click en el
// encabezado "Vencimiento" (ordenarPorVencimiento, que sí reescribe el orden real).

// La identidad de una fila es `uid` (estable, sintético). El label editable por el
// usuario (`id` en PaymentItem) es decorativo y NUNCA se usa para identidad aquí,
// porque puede duplicarse. `uid` es el único campo que esta lógica exige.
export interface CronogramaRow {
  uid: string;
  date: string; // "YYYY-MM-DD"
}

function esBisiesto(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function diasEnMes(y: number, m: number): number {
  // m en 1..12
  return [31, esBisiesto(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// Compara dos fechas "YYYY-MM-DD". Retorna <0 si a<b, 0 si iguales, >0 si a>b.
function cmpFecha(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ── Ordenamiento por encabezado ────────────────────────────────────────────────
// El usuario hace click en "Vencimiento" y el orden alterna asc/desc. NO es un
// orden de presentación: reescribe el array real, que es lo que se persiste.
// Estable ante fechas iguales (Array.sort lo es en todos los motores modernos),
// así que dos cuotas del mismo día conservan su orden relativo previo.
export type OrdenVencimiento = 'asc' | 'desc';

export function ordenarPorVencimiento<T extends CronogramaRow>(
  filas: T[],
  orden: OrdenVencimiento,
): T[] {
  const signo = orden === 'asc' ? 1 : -1;
  return filas.slice().sort((a, b) => signo * cmpFecha(a.date, b.date));
}

// ── Día de pago ────────────────────────────────────────────────────────────────
// El usuario declara un día del mes (1..31) y TODAS las filas que genera el
// cronograma caen en ese día. Dos ajustes, en este orden:
//
//   1. CLAMP a fin de mes: si el día no existe en ese mes (31 en febrero), se usa
//      el último día válido — 28 o 29 según año bisiesto.
//   2. FIN DE SEMANA → viernes anterior. Excepción: si retroceder cruzaría al mes
//      anterior (ej. día 1 que cae domingo), se avanza al lunes siguiente. Sin esa
//      excepción una cuota se saldría de su mes y podría quedar ANTES que la
//      anterior, rompiendo la secuencia mensual.

export const DIA_PAGO_DEFAULT = 1;

/** Recorta cualquier entrada a un día de pago válido (1..31). */
export function normalizarDiaPago(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return DIA_PAGO_DEFAULT;
  return Math.min(31, Math.max(1, n));
}

/**
 * Fecha de la cuota `offsetMeses` meses después de (anio, mes), en el día de pago
 * indicado y ya ajustada a día hábil.
 * @param mes 1..12
 */
export function fechaCuota(
  anio: number,
  mes: number,
  offsetMeses: number,
  diaPago: number,
): string {
  const total = (mes - 1) + offsetMeses;
  const y = anio + Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  const d = Math.min(normalizarDiaPago(diaPago), diasEnMes(y, m));
  return ajustarDiaHabil(iso(y, m, d));
}

/**
 * Fin de semana → viernes anterior; si eso cambia de mes, lunes siguiente.
 * Los días hábiles se devuelven intactos. No considera feriados: la app no tiene
 * calendario de feriados y el usuario siempre puede editar la fecha a mano.
 */
export function ajustarDiaHabil(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  // getUTCDay sobre una fecha UTC pura: 0 = domingo, 6 = sábado. Usar UTC evita
  // que la zona horaria local corra el día (Chile está en UTC-3/-4).
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow !== 0 && dow !== 6) return fecha;

  const retroceso = dow === 6 ? 1 : 2; // sábado → -1, domingo → -2
  if (d - retroceso >= 1) return iso(y, m, d - retroceso);

  // Retroceder saldría del mes: avanzar al lunes. Sábado → +2, domingo → +1.
  const avance = dow === 6 ? 2 : 1;
  const dLunes = d + avance;
  // Un día 1 o 2 nunca desborda el mes al avanzar, pero el clamp lo deja explícito.
  return iso(y, m, Math.min(dLunes, diasEnMes(y, m)));
}
