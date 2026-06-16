/**
 * bonoPieCalc.ts
 * Lógica canónica del bono pie para UF inmobiliario.
 *
 * Fórmula (tomada de Quoter.tsx → calcUnitBonoPie):
 *   precioConDescuento = precioLista × (1 − descuentoPct/100)
 *
 *   Si tieneBonoPie:
 *     precioPublicado  = precioConDescuento / (1 − bonoPct/100)
 *     bonificacion     = precioPublicado × bonoPct/100
 *     ajusteBonoMonto  = precioPublicado − precioConDescuento   (= bonificacion)
 *   Si NO:
 *     precioPublicado  = precioConDescuento
 *     bonificacion     = 0
 *     ajusteBonoMonto  = 0
 *
 *   precioVenta = precioConDescuento  (siempre igual)
 */

export interface BonoPieResult {
  precioLista: number;
  descuentoMonto: number;
  precioConDescuento: number;
  /** Diferencia que se "sube" al precio para crear el bono (0 si no aplica) */
  ajusteBonoMonto: number;
  /** Precio inflado publicado (= precioConDescuento cuando no hay bono) */
  precioPublicado: number;
  /** Monto del bono pie que se descuenta al comprador (0 si no aplica) */
  bonificacionMonto: number;
  /** Precio real que paga el comprador */
  precioVenta: number;
  bonoPct: number;
  descuentoPct: number;
  tieneBonoPie: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function calcBonoPie(
  precioLista: number,
  descuentoPct: number,
  bonoPct: number,
  tieneBonoPie: boolean,
): BonoPieResult {
  const descuentoMonto    = r2(precioLista * descuentoPct / 100);
  const precioConDescuento = r2(precioLista - descuentoMonto);

  if (tieneBonoPie && bonoPct > 0) {
    // Fórmula idéntica a Quoter.tsx calcUnitBonoPie
    const precioPublicado  = r2(precioConDescuento / (1 - bonoPct / 100));
    const bonificacionMonto = r2(precioPublicado * bonoPct / 100);
    const ajusteBonoMonto  = r2(precioPublicado - precioConDescuento);
    return {
      precioLista,
      descuentoMonto,
      precioConDescuento,
      ajusteBonoMonto,
      precioPublicado,
      bonificacionMonto,
      precioVenta: precioConDescuento,
      bonoPct,
      descuentoPct,
      tieneBonoPie: true,
    };
  }

  return {
    precioLista,
    descuentoMonto,
    precioConDescuento,
    ajusteBonoMonto: 0,
    precioPublicado: precioConDescuento,
    bonificacionMonto: 0,
    precioVenta: precioConDescuento,
    bonoPct,
    descuentoPct,
    tieneBonoPie: false,
  };
}
