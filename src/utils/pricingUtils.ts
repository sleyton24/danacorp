const r2 = (v: number) => Math.round(v * 100) / 100;

export function calcPrecioConDescuento(precioListaOriginal: number, dctoPct: number): number {
  return r2(precioListaOriginal * (1 - dctoPct / 100));
}

export function calcValorTotal(precioConDescuento: number, bonoPct: number): number {
  return r2(precioConDescuento / (1 - bonoPct / 100));
}

export function calcBonificacion(valorTotal: number, bonoPct: number): number {
  return r2(valorTotal * bonoPct / 100);
}

export function calcPrecioVenta(precioConDescuento: number): number {
  return precioConDescuento;
}

export interface ResumenUnidad {
  precioConDescuento: number;
  valorTotal: number;
  bonificacion: number;
  precioVenta: number;
}

export function calcResumenUnidad(params: {
  precioListaOriginal: number;
  dctoPct: number;
  aplicaBono: boolean;
  bonoPct: number;
}): ResumenUnidad {
  const { precioListaOriginal, dctoPct, aplicaBono, bonoPct } = params;
  const precioConDescuento = r2(precioListaOriginal * (1 - dctoPct / 100));
  if (aplicaBono && bonoPct > 0) {
    const valorTotal   = r2(precioConDescuento / (1 - bonoPct / 100));
    const bonificacion = r2(valorTotal * bonoPct / 100);
    return { precioConDescuento, valorTotal, bonificacion, precioVenta: precioConDescuento };
  }
  return { precioConDescuento, valorTotal: precioConDescuento, bonificacion: 0, precioVenta: precioConDescuento };
}

export interface FormaPago {
  compraSeguaUF: number;
  compraSeguaPct: number;
  creditoUF: number;
  promesaUF: number;
  cuotasUF: number;
  escrituraUF: number;
  cuotaIndividualUF: number;
  totalUF: number;
  // true si el remanente (precioVenta - crédito - compra segura) es <= 0
  error: boolean;
  // % reales sobre precioVenta (cuando aplicaBono, difieren de los % ingresados)
  promesaPctMostrado: number;
  cuotasPctMostrado: number;
  escrituraPctMostrado: number;
  compraSeguaPctMostrado: number;
  creditoPctMostrado: number;
}

export function calcFormaPago(params: {
  precioVenta: number;
  precioConDescuentoDepto: number;
  aplicaBono: boolean;
  bonoPct: number;
  creditoPct: number;
  promesaPct: number;
  cuotasPct: number;
  escrituraPct: number;
  numCuotas: number;
}): FormaPago {
  const { precioVenta, precioConDescuentoDepto, aplicaBono, bonoPct, creditoPct, promesaPct, cuotasPct, escrituraPct, numCuotas } = params;
  const compraSeguaUF = aplicaBono ? r2(precioConDescuentoDepto * bonoPct / 100) : 0;
  const compraSeguaPct = (aplicaBono && precioVenta > 0) ? r2(compraSeguaUF / precioVenta * 100) : 0;
  const creditoUF = r2(precioVenta * creditoPct / 100);
  const remanente = r2(precioVenta - creditoUF - compraSeguaUF);
  // Si el crédito + compra segura consumen todo (o más) el precio, no hay remanente
  // que distribuir: devolver ceros y marcar error en vez de valores negativos.
  const error = remanente <= 0;
  const sumPct = promesaPct + cuotasPct + escrituraPct;
  const promesaUF = (!error && sumPct > 0) ? r2(remanente * promesaPct / sumPct) : 0;
  const cuotasUF = (!error && sumPct > 0) ? r2(remanente * cuotasPct / sumPct) : 0;
  const escrituraUF = error ? 0 : r2(remanente - promesaUF - cuotasUF);
  const cuotaIndividualUF = numCuotas > 0 ? r2(cuotasUF / numCuotas) : 0;
  const totalUF = r2(promesaUF + cuotasUF + escrituraUF + creditoUF + compraSeguaUF);

  let promesaPctMostrado: number;
  let cuotasPctMostrado: number;
  let escrituraPctMostrado: number;
  let compraSeguaPctMostrado: number;
  let creditoPctMostrado: number;
  if (aplicaBono && precioVenta > 0) {
    compraSeguaPctMostrado = compraSeguaPct;
    promesaPctMostrado = r2(promesaUF / precioVenta * 100);
    cuotasPctMostrado = r2(cuotasUF / precioVenta * 100);
    creditoPctMostrado = creditoPct;
    const sumFixed = r2(promesaPctMostrado + cuotasPctMostrado + compraSeguaPctMostrado + creditoPctMostrado);
    escrituraPctMostrado = r2(100 - sumFixed);
  } else {
    promesaPctMostrado = promesaPct;
    cuotasPctMostrado = cuotasPct;
    escrituraPctMostrado = escrituraPct;
    compraSeguaPctMostrado = 0;
    creditoPctMostrado = creditoPct;
  }

  return { compraSeguaUF, compraSeguaPct, creditoUF, promesaUF, cuotasUF, escrituraUF, cuotaIndividualUF, totalUF, error, promesaPctMostrado, cuotasPctMostrado, escrituraPctMostrado, compraSeguaPctMostrado, creditoPctMostrado };
}

export function calcDescuentosInmuebles(unidades: Array<{
  nombre: string;
  valorTotal: number;
  dctoPct: number;
}>): Array<{ nombre: string; montoDescuento: number; tieneDescuento: boolean }> {
  return unidades.map(u => {
    const montoDescuento = u.dctoPct > 0 ? r2(u.valorTotal * u.dctoPct / 100) : 0;
    return { nombre: u.nombre, montoDescuento, tieneDescuento: u.dctoPct > 0 };
  });
}
