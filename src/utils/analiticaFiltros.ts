import { RealEstateUnit } from '../types';
import { IndiceVinculos, Periodo, estadoEfectivoUnidad } from './analytics';

/**
 * Piezas de cálculo para el rediseño de Resumen/Performance (docs/propuesta-analitica).
 * Viven aparte de analytics.ts porque ese módulo ya declara que no hay que tocarlo:
 * esto es filtrado/comparación de UI, no las definiciones compartidas de estado/fecha.
 *
 * Todas las funciones son puras: el "ahora" se inyecta, nada de Date.now() implícito.
 */

// ── Ventanas de período (para comparación) ────────────────────────────────────

/**
 * Rango [desde, hasta) del período dado, desplazado `offset` unidades hacia atrás.
 * offset 0 = el período actual (lo mismo que ya resuelve `enPeriodo` de analytics.ts,
 * pero como rango en vez de predicado); offset 1 = el inmediatamente anterior.
 * null cuando periodo === 'all' — no hay ventana que acotar.
 */
export function ventanaPeriodo(periodo: Periodo, offset: number, ahora: Date): [Date, Date] | null {
  if (periodo === 'all') return null;
  const y = ahora.getFullYear();
  const m = ahora.getMonth();

  if (periodo === 'month') {
    return [new Date(y, m - offset, 1), new Date(y, m - offset + 1, 1)];
  }
  if (periodo === 'quarter') {
    const q = Math.floor(m / 3);
    return [new Date(y, (q - offset) * 3, 1), new Date(y, (q - offset) * 3 + 3, 1)];
  }
  // year
  return [new Date(y - offset, 0, 1), new Date(y - offset + 1, 0, 1)];
}

export type Comparacion = 'none' | 'prev' | 'yoy';

/**
 * Ventana contra la que se compara el período actual. null si no aplica: sin comparación
 * elegida, o período 'all' (acumulado no tiene con qué contrastar por definición).
 */
export function ventanaComparacion(periodo: Periodo, comparacion: Comparacion, ahora: Date): [Date, Date] | null {
  if (comparacion === 'none' || periodo === 'all') return null;
  if (comparacion === 'prev') return ventanaPeriodo(periodo, 1, ahora);

  // yoy: la misma ventana actual, desplazada 12 meses manteniendo mes/día — no
  // ventanaPeriodo(periodo, offsetEnAnios), porque para 'month'/'quarter' un
  // desplazamiento de "1" son 3 o 1 meses, no 12.
  const actual = ventanaPeriodo(periodo, 0, ahora);
  if (!actual) return null;
  const [desde, hasta] = actual;
  return [
    new Date(desde.getFullYear() - 1, desde.getMonth(), desde.getDate()),
    new Date(hasta.getFullYear() - 1, hasta.getMonth(), hasta.getDate()),
  ];
}

/** ¿La fecha cae en la ventana [desde, hasta)? Una ventana null no filtra (todo pasa). */
export function enVentana(fecha: Date | null, ventana: [Date, Date] | null): boolean {
  if (!ventana) return true;
  if (!fecha) return false;
  return fecha >= ventana[0] && fecha < ventana[1];
}

// ── Filtrado cruzado ───────────────────────────────────────────────────────────

export interface CruceAnalitico {
  estado: string | null;
  piso: number | null;
  tipologia: string | null;
  banco: string | null;
}

export const CRUCE_VACIO: CruceAnalitico = { estado: null, piso: null, tipologia: null, banco: null };

export const hayCruce = (c: CruceAnalitico): boolean =>
  c.estado !== null || c.piso !== null || c.tipologia !== null || c.banco !== null;

/**
 * "2D + 2B". Único punto de verdad de la etiqueta de tipología, para no repetir el
 * template string en cada tabla que agrupa por dormitorios+baños.
 */
export const tipologia = (unit: RealEstateUnit): string =>
  `${unit.dormitorios ?? 0}D + ${unit.banos ?? 0}B`;

/**
 * Filtro cruzado: clic en un tramo/fila fija un valor y todos los bloques lo respetan,
 * salvo el que lo controla (`excepto`) — si no, cruzar por piso colapsaría la propia
 * tabla de pisos al 100% en la fila activa, un dato vacío.
 *
 * A diferencia del prototipo (que generaba unidades ya aplanadas a mano), acá el cruce
 * por estado se compara contra `estadoEfectivoUnidad`, NO `unit.estado` crudo: una
 * bodega/estacionamiento vinculado a un depto Escriturado tiene `estado` propio
 * 'Asignado', no 'Escriturado' — filtrar por el campo crudo la excluiría en silencio.
 * Piso y tipología solo aplican a departamentos (una bodega no tiene tipología); banco
 * aplica sobre el campo crudo de cada unidad (no se hereda del padre).
 */
export function aplicarCruce(
  units: RealEstateUnit[],
  cruce: CruceAnalitico,
  vinculos: IndiceVinculos,
  excepto?: keyof CruceAnalitico,
): RealEstateUnit[] {
  return units.filter(u => {
    if (cruce.estado !== null && excepto !== 'estado' && estadoEfectivoUnidad(u, vinculos) !== cruce.estado) {
      return false;
    }
    if (cruce.piso !== null && excepto !== 'piso' && (u.type !== 'Departamento' || u.piso !== cruce.piso)) {
      return false;
    }
    if (cruce.tipologia !== null && excepto !== 'tipologia' && (u.type !== 'Departamento' || tipologia(u) !== cruce.tipologia)) {
      return false;
    }
    if (cruce.banco !== null && excepto !== 'banco' && u.banco !== cruce.banco) {
      return false;
    }
    return true;
  });
}

// ── Delta de comparación ───────────────────────────────────────────────────────

export interface DeltaResultado {
  texto: string;
  direccion: 'up' | 'down' | 'flat' | 'nuevo';
  pct: number | null;
}

/**
 * Compara `actual` contra `previo` para mostrar al lado de una cifra. `previo` null/
 * undefined significa que no hay período de comparación — el llamador decide si mostrar
 * algo. `previo === 0`: si `actual` también es 0 no hay nada que destacar ('igual'); si
 * `actual > 0` no hay porcentaje que calcular sin dividir por cero, así que se declara
 * 'nuevo' en vez de mostrar infinito.
 */
export function delta(actual: number, previo: number | null | undefined): DeltaResultado | null {
  if (previo === null || previo === undefined) return null;
  if (previo === 0) {
    return actual === 0
      ? { texto: 'igual', direccion: 'flat', pct: null }
      : { texto: 'nuevo', direccion: 'nuevo', pct: null };
  }
  const pct = Math.round(((actual - previo) / previo) * 1000) / 10;
  if (pct === 0) return { texto: 'igual', direccion: 'flat', pct: 0 };
  const up = pct > 0;
  return { texto: `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`, direccion: up ? 'up' : 'down', pct };
}
