// ── Cronograma de pagos: cascada de fechas + reordenamiento (Bloque C) ─────────
//
// Lógica PURA, sin dependencias de React/DB, para poder testearla aislada.
// Las fechas son strings "YYYY-MM-DD" (formato de <input type="date">). Comparar
// esos strings lexicográficamente equivale a compararlos cronológicamente, así que
// no usamos Date (evita sorpresas de zona horaria) salvo para el cálculo de días.

export interface CronogramaRow {
  id: string;
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

// Suma EXACTAMENTE un mes a una fecha "YYYY-MM-DD".
// Caso de borde: si el día no existe en el mes siguiente (ej. 31 de enero → febrero),
// usa el último día válido de ese mes (28/29 feb según año bisiesto).
export function sumarUnMes(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  let ny = y;
  let nm = m + 1;
  if (nm > 12) { nm = 1; ny = y + 1; }
  const nd = Math.min(d, diasEnMes(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

// ── C.1 — Insertar fila nueva en su posición cronológica ───────────────────────
// La fila nueva se ubica según su fecha (más antigua que todas = primera; más
// reciente que todas = última). NO dispara cascada: ninguna otra fila cambia.
// Entre fechas iguales, la nueva se inserta después de las existentes (estable).
export function insertarFilaOrdenada<T extends CronogramaRow>(filas: T[], nuevaFila: T): T[] {
  const resultado = filas.slice();
  let i = 0;
  while (i < resultado.length && cmpFecha(resultado[i].date, nuevaFila.date) <= 0) i++;
  resultado.splice(i, 0, nuevaFila);
  return resultado;
}

// ── C.2 — Editar la fecha de una fila existente ────────────────────────────────
// Asume que `filas` ya viene ordenado cronológicamente (invariante que mantiene C.1).
//
// Caso 1 — la nueva fecha NO saca a la fila de su posición (sigue coherente entre la
//   fila anterior y la siguiente): se aplica CASCADA. Cada fila que sigue hacia abajo
//   (sin importar tipo de pago ni si está pagada) toma la fecha de la fila inmediata
//   anterior + 1 mes, en cadena. Las filas de arriba nunca se tocan.
//
// Caso 2 — la nueva fecha SÍ saca a la fila de su posición: NO hay cascada. Solo esa
//   fila se reubica a su posición cronológica correcta, conservando la fecha exacta
//   ingresada. Ninguna otra fila cambia de fecha.
export function recalcularCronograma<T extends CronogramaRow>(
  filas: T[],
  filaEditadaId: string,
  nuevaFecha: string,
): T[] {
  const i = filas.findIndex(f => f.id === filaEditadaId);
  if (i === -1) return filas.slice(); // id inexistente: no-op defensivo

  const prev = i > 0 ? filas[i - 1] : undefined;
  const next = i < filas.length - 1 ? filas[i + 1] : undefined;

  const coherente =
    (prev === undefined || cmpFecha(nuevaFecha, prev.date) >= 0) &&
    (next === undefined || cmpFecha(nuevaFecha, next.date) <= 0);

  if (coherente) {
    // Caso 1 — cascada hacia abajo.
    const resultado = filas.map(f => ({ ...f }));
    resultado[i] = { ...resultado[i], date: nuevaFecha };
    for (let j = i + 1; j < resultado.length; j++) {
      resultado[j] = { ...resultado[j], date: sumarUnMes(resultado[j - 1].date) };
    }
    return resultado;
  }

  // Caso 2 — reubicación sin cascada.
  const editada = { ...filas[i], date: nuevaFecha };
  const resto = filas.filter((_, idx) => idx !== i).map(f => ({ ...f }));
  return insertarFilaOrdenada(resto, editada);
}
