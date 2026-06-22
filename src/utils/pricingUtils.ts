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
