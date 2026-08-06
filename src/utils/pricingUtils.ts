const r2 = (v: number) => Math.round(v * 100) / 100;

export function calcPrecioConDescuento(precioListaOriginal: number, dctoPct: number): number {
  return r2(precioListaOriginal * (1 - dctoPct / 100));
}

/**
 * Inversa de calcPrecioConDescuento: dado el precio al que se quiere cerrar la venta,
 * devuelve el % de descuento que lo produce.
 *
 * NO redondea a propósito. La regla acordada es que manda el campo que el usuario tipeó
 * a mano: si tipeó el precio, ese precio debe sobrevivir intacto al recalcularse desde el
 * %, y un % redondeado a 2 decimales no lo reproduce (lista 4.000 y precio 3.333,33 dan
 * 16,666…%, que redondeado devuelve 3.333,20). El % se guarda con toda su precisión —
 * las columnas descuento_pct y descuento_cliente son DOUBLE PRECISION — y se MUESTRA
 * con 2 decimales.
 *
 * Un precio mayor al de lista devuelve un porcentaje negativo: es un recargo, que la app
 * permite y no pasa por el flujo de aprobación de descuentos.
 */
export function descuentoDesdePrecio(precioListaOriginal: number, precioObjetivo: number): number {
  if (!(precioListaOriginal > 0)) return 0;
  // (orig - precio) / orig, no 1 - precio/orig: la resta primero evita el arrastre de
  // punto flotante que hacía que un recargo de 5.000 → 5.500 diera -10.000000000000009.
  return ((precioListaOriginal - precioObjetivo) / precioListaOriginal) * 100;
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

/**
 * @deprecated SIN LLAMADORES. Quedó de la época de la redistribución dinámica y su
 * `compraSeguaUF` usa la fórmula vieja del bono (base × bono%, que da (1 − bono%) veces
 * el bono real). NO reutilizar: para cualquier cálculo nuevo va calcFormaPagoFija.
 */
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

// ── Bloque E: Forma de pago FIJA (reemplaza la redistribución dinámica) ──────────
// Promesa = piso mínimo 3% (default), editable manualmente hacia arriba, sin tope.
// Crédito Banco y Compra Segura quedan fijos (usuario / config de bono). Solo Cuotas y
// Escritura absorben, entre ambos y en proporción a los % ingresados, el remanente para
// cuadrar el 100%. NO reemplaza a calcFormaPago: esa se conserva para cotizaciones/planes
// ya generados.
// El piso de 3% se valida en la UI con "rechazar + error inline" (patrón max_cuotas de
// Bloque B): la función es pura y calcula con el % que reciba. PROMESA_PCT_MIN es el
// default del parámetro y el valor que la UI usa como mínimo aceptable.
export const PROMESA_PCT_MIN = 3;

export interface FormaPagoFija {
  promesaUF: number;
  creditoUF: number;
  compraSeguraUF: number;
  cuotasUF: number;
  escrituraUF: number;
  cuotaIndividualUF: number;
  totalUF: number;
  // % reales sobre precioVenta (para mostrar en la UI; ya no hay % "recalculado dinámico")
  promesaPct: number;
  creditoPct: number;
  compraSeguraPct: number;
  cuotasPct: number;
  escrituraPct: number;
  // true si Promesa(3%) + Crédito + Compra Segura consumen el 100% o más: no hay
  // remanente para Cuotas/Escritura → se devuelven en 0 y el usuario debe bajar el Crédito.
  // También true si queda remanente pero se desactivaron TODAS las componentes que podrían
  // absorberlo (Cuotas y Escritura): el plan no cuadra al 100% y no hay dónde ponerlo.
  error: boolean;
}

export function calcFormaPagoFija(params: {
  precioVenta: number;              // Precio de Venta final (con descuento y bono ya aplicados)
  /**
   * MONTO del bono pie, ya calculado por quien llama. 0 (o se omite) si no aplica.
   *
   * Deliberadamente NO se deriva acá a partir de una base y un %: cada pantalla usa una
   * base distinta para `precioVenta` y el bono tiene que quedar expresado en los MISMOS
   * términos, o la línea deja de cuadrar con el total.
   *   · Unit Detail pasa un precioVenta INFLADO (suma de valorTotal), así que su bono es
   *     bono% del precio publicado: calcBonificacion(calcValorTotal(base, bono%), bono%).
   *   · El cotizador pasa un precioVenta SIN INFLAR (suma de unitFinalPrice), así que su
   *     bono es bono% de esa misma base: base × bono%.
   * Cuando esta función deducía el bono sola, una de las dos quedaba siempre descuadrada.
   *
   * En ambos casos la base debe cubrir TODAS las unidades con bono activo (depto, bodegas
   * y estacionamientos), no solo el depto.
   */
  compraSeguraUF?: number;
  creditoPct: number;               // fijo, ingresado por el usuario
  cuotasPct: number;                // proporción para repartir el remanente
  escrituraPct: number;             // proporción para repartir el remanente
  numCuotas: number;
  promesaPct?: number;              // piso 3% (default); editable hacia arriba en la UI
  // ── Componentes activables ────────────────────────────────────────────────
  // El usuario prende y apaga cada componente con un selector en la UI. Una componente
  // apagada aporta 0 y su parte se redistribuye entre las que siguen activas: p.ej. si el
  // cliente no paga la Promesa al contado, ese 3% pasa a repartirse entre Cuotas y
  // Escritura. Default true en las tres → los llamadores que no las pasan (cotizaciones y
  // planes ya generados) mantienen exactamente el comportamiento anterior.
  promesaActiva?: boolean;
  cuotasActiva?: boolean;
  escrituraActiva?: boolean;
}): FormaPagoFija {
  const { precioVenta, creditoPct, cuotasPct, escrituraPct, numCuotas } = params;
  const promesaActiva   = params.promesaActiva ?? true;
  const cuotasActiva    = params.cuotasActiva ?? true;
  const escrituraActiva = params.escrituraActiva ?? true;
  const promesaPct = promesaActiva ? (params.promesaPct ?? PROMESA_PCT_MIN) : 0;

  const promesaUF = r2(precioVenta * promesaPct / 100);
  const compraSeguraUF = r2(params.compraSeguraUF ?? 0);
  const creditoUF = r2(precioVenta * creditoPct / 100);

  // Lo que queda para repartir entre Cuotas y Escritura.
  const remanente = r2(precioVenta - promesaUF - creditoUF - compraSeguraUF);
  // Con Cuotas y Escritura apagadas nadie puede absorber el remanente: el plan no cuadra.
  // No es error si el remanente ya es 0 (p.ej. Crédito 100%): ahí no hay nada que repartir.
  const sinDestino = !cuotasActiva && !escrituraActiva && remanente > 0;
  const error = remanente < 0 || sinDestino;

  let cuotasUF = 0;
  let escrituraUF = 0;
  if (!error) {
    if (cuotasActiva && escrituraActiva) {
      const sumCE = cuotasPct + escrituraPct;
      cuotasUF = sumCE > 0 ? r2(remanente * cuotasPct / sumCE) : 0;
      // Escritura toma el residuo exacto → el total cuadra al centésimo con precioVenta.
      escrituraUF = r2(remanente - cuotasUF);
    } else if (cuotasActiva) {
      // Única activa: pasa a ser el plug y se lleva todo el remanente.
      cuotasUF = remanente;
    } else if (escrituraActiva) {
      escrituraUF = remanente;
    }
  }
  const cuotaIndividualUF = numCuotas > 0 ? r2(cuotasUF / numCuotas) : 0;

  const totalUF = r2(promesaUF + cuotasUF + escrituraUF + creditoUF + compraSeguraUF);

  const pct = (uf: number) => (precioVenta > 0 ? r2(uf / precioVenta * 100) : 0);
  const promesaPctReal     = pct(promesaUF);
  const creditoPctReal     = pct(creditoUF);
  const compraSeguraPctReal = pct(compraSeguraUF);
  let cuotasPctReal        = pct(cuotasUF);
  let escrituraPctReal     = pct(escrituraUF);

  // Los montos cuadran exacto con precioVenta, pero redondear cada porcentaje a 2 decimales
  // por separado deja un residuo: la UI mostraba un TOTAL de 99,99% con los cinco valores
  // correctos. La componente que ya absorbe el residuo en UF (Escritura, o Cuotas si
  // Escritura está apagada) absorbe también el de los porcentajes. Solo si su monto es > 0:
  // si no, se estaría inventando un 0,01% sobre una línea de 0,00 UF.
  if (!error && precioVenta > 0) {
    const plugEsEscritura = escrituraActiva && escrituraUF > 0;
    const plugEsCuotas    = !plugEsEscritura && cuotasActiva && cuotasUF > 0;
    if (plugEsEscritura) {
      escrituraPctReal = r2(100 - promesaPctReal - creditoPctReal - compraSeguraPctReal - cuotasPctReal);
    } else if (plugEsCuotas) {
      cuotasPctReal = r2(100 - promesaPctReal - creditoPctReal - compraSeguraPctReal - escrituraPctReal);
    }
  }

  return {
    promesaUF, creditoUF, compraSeguraUF, cuotasUF, escrituraUF, cuotaIndividualUF, totalUF,
    promesaPct: promesaPctReal,
    creditoPct: creditoPctReal,
    compraSeguraPct: compraSeguraPctReal,
    cuotasPct: cuotasPctReal,
    escrituraPct: escrituraPctReal,
    error,
  };
}

// ── Reparto en porcentajes REALES (sin bono pie) ───────────────────────────────
//
// Con bono pie, la Compra Segura se lleva una tajada fija del precio de venta, así que
// Cuotas y Escritura no pueden ser porcentajes reales: son PESOS que reparten lo que sobra,
// y el % verdadero se muestra aparte en el badge dorado.
//
// Sin bono esa tajada no existe, y entonces Promesa + Cuotas + Escritura + Crédito SON los
// porcentajes reales y tienen que sumar 100 exacto. Ahí el badge sobra, y a cambio los
// campos tienen que mantenerse coherentes solos: al editar uno, los otros dos se recalculan
// en proporción a lo que tenían; al apagar o prender una componente, las activas se
// reparten de nuevo el total disponible.
export interface RepartoPctReales {
  promesaPct: number;
  cuotasPct: number;
  escrituraPct: number;
}

type ClaveComponente = 'promesa' | 'cuotas' | 'escritura';

/**
 * Devuelve el reparto coherente de Promesa / Cuotas / Escritura en porcentajes reales.
 *
 * - `disponible` = 100 − Crédito Banco. Las tres activas siempre suman exactamente eso.
 * - Las componentes apagadas quedan en 0 y no participan del reparto.
 * - `fijada` es la que el usuario acaba de escribir a mano: se respeta su valor (recortado
 *   a lo que haya disponible) y las otras activas absorben el resto en proporción a lo que
 *   tenían. Sin `fijada` se reparte todo proporcionalmente (toggle o cambio de Crédito).
 * - La Promesa conserva su piso de 3% mientras esté activa; si no cabe en lo disponible,
 *   se usa lo disponible.
 * - El residuo del redondeo a 2 decimales se lo lleva Escritura (o Cuotas si Escritura está
 *   apagada), igual que en calcFormaPagoFija, para que la suma cierre al centésimo.
 */
export function redistribuirPctReales(params: {
  actual: RepartoPctReales;
  promesaActiva: boolean;
  cuotasActiva: boolean;
  escrituraActiva: boolean;
  creditoPct: number;
  fijada?: ClaveComponente;
}): RepartoPctReales {
  const { actual, promesaActiva, cuotasActiva, escrituraActiva, creditoPct, fijada } = params;

  const activa: Record<ClaveComponente, boolean> = {
    promesa: promesaActiva, cuotas: cuotasActiva, escritura: escrituraActiva,
  };
  const valor: Record<ClaveComponente, number> = {
    promesa: promesaActiva ? Math.max(0, actual.promesaPct) : 0,
    cuotas: cuotasActiva ? Math.max(0, actual.cuotasPct) : 0,
    escritura: escrituraActiva ? Math.max(0, actual.escrituraPct) : 0,
  };

  const disponible = r2(Math.max(0, 100 - creditoPct));
  const out: Record<ClaveComponente, number> = { promesa: 0, cuotas: 0, escritura: 0 };
  const activas = (['promesa', 'cuotas', 'escritura'] as ClaveComponente[]).filter(k => activa[k]);
  if (activas.length === 0 || disponible <= 0) return { promesaPct: 0, cuotasPct: 0, escrituraPct: 0 };

  // El piso de la Promesa no puede exceder lo que hay para repartir.
  const piso = activa.promesa ? Math.min(PROMESA_PCT_MIN, disponible) : 0;

  const repartir = (claves: ClaveComponente[], total: number) => {
    if (claves.length === 0 || total <= 0) { claves.forEach(k => { out[k] = 0; }); return; }
    const suma = claves.reduce((s, k) => s + valor[k], 0);
    const parte: Record<string, number> = {};
    // Sin referencia previa (todas en 0) se reparte en partes iguales, no cero.
    claves.forEach(k => { parte[k] = suma > 0 ? total * valor[k] / suma : total / claves.length; });

    if (claves.includes('promesa') && parte.promesa < piso) {
      const falta = piso - parte.promesa;
      parte.promesa = piso;
      const otras = claves.filter(k => k !== 'promesa');
      const sumaOtras = otras.reduce((s, k) => s + parte[k], 0);
      otras.forEach(k => { parte[k] = sumaOtras > 0 ? Math.max(0, parte[k] - falta * parte[k] / sumaOtras) : 0; });
    }

    claves.forEach(k => { out[k] = r2(parte[k]); });
    // Residuo del redondeo al plug, para que el reparto cierre exacto.
    const plug = claves.includes('escritura') ? 'escritura' : claves.includes('cuotas') ? 'cuotas' : claves[0];
    out[plug] = r2(out[plug] + (total - claves.reduce((s, k) => s + out[k], 0)));
  };

  if (fijada && activa[fijada]) {
    // Al fijar Cuotas o Escritura hay que dejar libre el piso de la Promesa si sigue activa.
    const reservaPiso = fijada !== 'promesa' && activa.promesa ? piso : 0;
    const maximo = r2(Math.max(0, disponible - reservaPiso));
    const minimo = fijada === 'promesa' ? piso : 0;
    const v = r2(Math.min(Math.max(valor[fijada], minimo), maximo));
    out[fijada] = v;
    repartir(activas.filter(k => k !== fijada), r2(disponible - v));
  } else {
    repartir(activas, disponible);
  }

  return { promesaPct: out.promesa, cuotasPct: out.cuotas, escrituraPct: out.escritura };
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
