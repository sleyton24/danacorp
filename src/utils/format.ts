// ── Formato canónico de números de dinero y descuento ──────────────────────────
//
// REGLA (transversal a toda la app): todo número que represente un PRECIO, un MONTO
// en UF o un DESCUENTO se muestra SIEMPRE con 2 decimales. Sin excepciones por
// pantalla: el mismo precio no puede leerse "4.565,0" en una vista y "4.565,00" en
// otra. Antes de este módulo había cinco formateadores distintos (0, 1 y 2 decimales)
// copiados en cada componente; ahora todos entran por acá.
//
// Fuera de la regla, a propósito:
//   - CLP: los pesos no tienen decimales (formatCLP).
//   - Superficies en m², conteos y % de avance de obra: no son precio ni descuento.

/** Precio o monto en UF: miles con punto, 2 decimales con coma. Ej: 4.565,00 */
export const formatUF = (val: number): string =>
  (val ?? 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Porcentaje de descuento o de forma de pago, 2 decimales. Ej: 16,67 */
export const formatPct = (val: number): string =>
  (val ?? 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Pesos chilenos: sin decimales. */
export const formatCLP = (val: number): string =>
  (val ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });

/** Redondeo a 2 decimales para el DATO (no solo la vista). */
export const r2 = (v: number): number => Math.round(v * 100) / 100;
