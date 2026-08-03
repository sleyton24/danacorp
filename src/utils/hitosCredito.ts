import { RealEstateUnit } from '../types';

/**
 * Reglas de la sección Hitos relacionadas con la forma de financiamiento y las fechas CBR.
 *
 * Viven acá y no dentro del JSX de UnitDetail por el mismo motivo que viewAccess.ts:
 * son reglas de negocio que deciden qué se guarda y qué se rechaza, y dentro del
 * componente no serían testeables sin montar todo el árbol de React.
 *
 * Todas las funciones son puras. Las fechas se comparan como strings 'YYYY-MM-DD'
 * (comparación lexicográfica, válida para ISO) en vez de construir Date: es el mismo
 * criterio que ya usa el resto del componente y evita los corrimientos de zona horaria
 * que documenta parseFechaFlexible en analytics.ts.
 */

export type FormaFinanciamiento = 'Contado' | 'Financiamiento';

/**
 * Campos del bloque de crédito que se vacían a null con Contado.
 *
 * `creditoHipotecario` queda FUERA a propósito: su columna es
 * `credito_hipotecario DOUBLE PRECISION DEFAULT 0 NOT NULL`, así que mandarle null
 * revienta la constraint. Se vacía a 0, ver CAMPOS_CREDITO_CERO.
 */
export const CAMPOS_CREDITO_NULOS = [
  'banco',
  'fechaSolicitudCredito',
  'fechaAprobacionCredito',
  'plazoCreditoAnios',
  'tasaFinanciamiento',
] as const;

/** Campos numéricos NOT NULL del bloque de crédito: se vacían a 0, no a null. */
export const CAMPOS_CREDITO_CERO = ['creditoHipotecario'] as const;

/** Todos los campos del bloque de crédito, para recorrerlos en la UI y en los tests. */
export const CAMPOS_CREDITO = [...CAMPOS_CREDITO_NULOS, ...CAMPOS_CREDITO_CERO] as const;

/**
 * ¿Aplica el bloque de crédito?
 *
 * Se oculta SOLO cuando la forma es explícitamente 'Contado'. Un valor nulo significa
 * "no declarado" — es el estado de todas las unidades anteriores a este campo, que sí
 * pueden tener banco y monto de crédito ya cargados por carga masiva. Tratarlas como
 * Contado esconderÍa datos reales, así que el default es mostrar.
 */
export function aplicaCredito(forma: string | null | undefined): boolean {
  return forma !== 'Contado';
}

/**
 * Deja en null los campos del bloque de crédito. Se aplica al guardar con Contado:
 * ninguno de esos campos aplica, así que tampoco se guardan con datos.
 *
 * Incluye fechaAprobacionCredito y tasaFinanciamiento además de los cinco campos
 * visibles: una fecha de aprobación sin solicitud, o una tasa sin crédito, es dato
 * huérfano (y la UI ya trata Aprobación como dependiente de Solicitud).
 *
 * NO toca las fechas del ciclo de venta (reserva/promesa/escritura/entrega/alzamiento)
 * ni las fechas CBR: son independientes de cómo se financie la unidad.
 */
export function limpiarCamposCredito<T extends Partial<RealEstateUnit>>(unit: T): T {
  const limpio: Record<string, unknown> = { ...unit };
  for (const campo of CAMPOS_CREDITO_NULOS) {
    // null y no undefined: undefined se omite en JSON.stringify y el PATCH no limpiaría
    // la columna en la BD (mismo motivo documentado para descuentoCliente en performSave).
    limpio[campo] = null;
  }
  for (const campo of CAMPOS_CREDITO_CERO) {
    limpio[campo] = 0;
  }
  return limpio as T;
}

/**
 * % de financiamiento a mostrar en Hitos. Es de solo lectura y espeja el "Crédito Banco"
 * de los detalles financieros: el llamador debe pasar el MISMO estado que alimenta ese
 * input (fpCreditoPct), no un valor recalculado por su cuenta.
 *
 * Devuelve null con Contado: no hay financiamiento del que declarar un porcentaje.
 */
export function porcentajeFinanciamiento(
  forma: string | null | undefined,
  creditoPct: number,
): number | null {
  if (!aplicaCredito(forma)) return null;
  return creditoPct;
}

export type CampoCBR = 'fechaIngresoCBR' | 'fechaInscripcionCBR';

/** Campo culpable + mensaje para el error inline. */
export interface ErrorCBR {
  campo: CampoCBR;
  mensaje: string;
}

/**
 * Orden de las dos fechas CBR, posteriores a la firma de Escritura.
 * Devuelve null cuando el orden es válido.
 *
 * Ambas son OPCIONALES y nunca son requisito para que el proceso de la unidad se
 * considere completo: si una queda vacía, no hay nada que validar contra ella. Solo se
 * comparan los pares efectivamente presentes.
 *
 * Rechaza (no autocorrige) y señala el campo culpable para el error inline.
 * "No puede ser anterior" admite la fecha igual.
 *
 * Devuelve un error nullable en vez de un union discriminado a propósito: tsconfig.json
 * (el del frontend) no tiene `strict`, y sin strictNullChecks el narrowing sobre un
 * discriminante booleano no es confiable en el punto de uso.
 */
export function validarOrdenCBR(f: {
  fechaEscritura?: string | null;
  fechaIngresoCBR?: string | null;
  fechaInscripcionCBR?: string | null;
}): ErrorCBR | null {
  const escritura = f.fechaEscritura || '';
  const ingreso = f.fechaIngresoCBR || '';
  const inscripcion = f.fechaInscripcionCBR || '';

  if (ingreso && escritura && ingreso < escritura) {
    return {
      campo: 'fechaIngresoCBR',
      mensaje: 'La fecha de ingreso al CBR no puede ser anterior a la Escritura.',
    };
  }
  if (inscripcion && ingreso && inscripcion < ingreso) {
    return {
      campo: 'fechaInscripcionCBR',
      mensaje: 'La fecha de inscripción CBR no puede ser anterior al ingreso al CBR.',
    };
  }
  return null;
}
