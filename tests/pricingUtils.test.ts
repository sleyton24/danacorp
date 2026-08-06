import { describe, it, expect } from 'vitest';
import {
  calcFormaPagoFija, calcPrecioConDescuento, calcResumenUnidad,
  calcValorTotal, calcBonificacion, descuentoDesdePrecio, redistribuirPctReales,
  PROMESA_PCT_MIN, type RepartoPctReales,
} from '../src/utils/pricingUtils';

// Redondeo a 2 decimales para comparar sumas sin arrastre de punto flotante.
const r2 = (v: number) => Math.round(v * 100) / 100;

// Bloque E — test de paridad de la forma de pago FIJA.
// Inputs fijos comunes: Crédito Banco 80% (usuario), reparto Cuotas:Escritura = 7:10, 36 cuotas.
// Bono (config) = 10%. Base del depto = 5000 UF. Promesa: piso 3% (default), editable hacia arriba.
const CREDITO_PCT = 80;
const CUOTAS_PCT = 7;
const ESCRITURA_PCT = 10;
const N_CUOTAS = 36;

const run = (precioVenta: number, aplicaBono: boolean, promesaPct?: number) =>
  calcFormaPagoFija({
    precioVenta,
    // Un solo depto. Se emula la base de Unit Detail: precio de venta inflado, así que el
    // bono es el 10% del precio publicado.
    compraSeguraUF: aplicaBono ? calcBonificacion(calcValorTotal(precioVenta, 10), 10) : 0,
    creditoPct: CREDITO_PCT,
    cuotasPct: CUOTAS_PCT,
    escrituraPct: ESCRITURA_PCT,
    numCuotas: N_CUOTAS,
    promesaPct, // undefined → usa el piso 3%
  });

describe('Bloque E — calcFormaPagoFija (paridad)', () => {
  it('Promesa: piso mínimo por defecto es 3%', () => {
    expect(PROMESA_PCT_MIN).toBe(3);
    expect(run(5000, false).promesaPct).toBe(3); // sin promesaPct → default 3
  });

  // ── Casos base: Promesa en el piso 3% ──────────────────────────────────────
  it('Caso 1 — simple: sin descuento, sin bono (PV 5000)', () => {
    const f = run(5000, false);
    expect(f.promesaUF).toBe(150);
    expect(f.creditoUF).toBe(4000);
    expect(f.compraSeguraUF).toBe(0);
    expect(f.cuotasUF).toBe(350);
    expect(f.escrituraUF).toBe(500);
    expect(f.cuotaIndividualUF).toBe(9.72);
    expect(f.totalUF).toBe(5000);
    expect(f.error).toBe(false);
  });

  it('Caso 2 — con descuento 10% (PV 4500), sin bono', () => {
    const f = run(4500, false);
    expect(f.promesaUF).toBe(135);
    expect(f.creditoUF).toBe(3600);
    expect(f.compraSeguraUF).toBe(0);
    expect(f.cuotasUF).toBe(315);
    expect(f.escrituraUF).toBe(450);
    expect(f.totalUF).toBe(4500);
  });

  it('Caso 3 — con bono pie 10%, sin descuento (PV 5000)', () => {
    const f = run(5000, true);
    expect(f.promesaUF).toBe(150);
    // 10% del precio PUBLICADO (5000/0.9 = 5555.56), no 10% de la base: el bono se define
    // sobre el precio inflado. Antes daba 500, que es el bono real × (1 − bono%).
    expect(f.compraSeguraUF).toBe(555.56);
    expect(f.compraSeguraPct).toBe(11.11); // 555.56 sobre un precio de venta de 5000
    expect(f.creditoUF).toBe(4000);
    expect(f.cuotasUF).toBe(121.24);
    expect(f.escrituraUF).toBe(173.2);
    expect(f.totalUF).toBe(5000);
  });

  it('Caso 4 — descuento 10% + bono pie 10% combinados (PV 4500)', () => {
    const f = run(4500, true);
    expect(f.promesaUF).toBe(135);
    expect(f.compraSeguraUF).toBe(500);   // 10% de 4500/0.9 = 5000
    expect(f.creditoUF).toBe(3600);
    expect(f.cuotasUF).toBe(109.12);
    expect(f.escrituraUF).toBe(155.88);
    expect(f.totalUF).toBe(4500);
  });

  // ── Casos nuevos: Promesa subida manualmente por encima del piso ────────────
  it('Caso 5 — Promesa subida a 5%, sin bono (PV 5000): Crédito fijo, Cuotas+Escritura absorben', () => {
    const f = run(5000, false, 5);
    expect(f.promesaUF).toBe(250);       // 5% de 5000 (antes 150)
    expect(f.creditoUF).toBe(4000);      // NO se mueve (sigue 80%)
    expect(f.compraSeguraUF).toBe(0);    // NO se mueve
    expect(f.cuotasUF).toBe(308.82);     // 750 × 7/17  (bajó desde 350)
    expect(f.escrituraUF).toBe(441.18);  // 750 − 308.82 (bajó desde 500)
    expect(f.totalUF).toBe(5000);        // sigue 100%
  });

  it('Caso 6 — Promesa subida a 5%, con bono pie 10% (PV 5000)', () => {
    const f = run(5000, true, 5);
    expect(f.promesaUF).toBe(250);          // 5% de 5000
    expect(f.creditoUF).toBe(4000);         // fijo
    expect(f.compraSeguraUF).toBe(555.56);  // fijo por config: 10% del precio publicado
    expect(f.cuotasUF).toBe(80.06);         // 194.44 × 7/17
    expect(f.escrituraUF).toBe(114.38);     // 194.44 − 80.06
    expect(f.totalUF).toBe(5000);
  });

  it('subir Promesa +2% mueve SOLO Cuotas+Escritura (Crédito y Compra Segura intactos)', () => {
    const base = run(5000, true);        // Promesa 3%
    const alta = run(5000, true, 5);     // Promesa 5%
    // Crédito y Compra Segura no cambian
    expect(alta.creditoUF).toBe(base.creditoUF);
    expect(alta.compraSeguraUF).toBe(base.compraSeguraUF);
    // El incremento de Promesa (2% de 5000 = 100 UF) lo absorben Cuotas+Escritura
    const bajaCE = (base.cuotasUF + base.escrituraUF) - (alta.cuotasUF + alta.escrituraUF);
    expect(bajaCE).toBeCloseTo(100, 2);
    expect(alta.promesaUF - base.promesaUF).toBeCloseTo(100, 2);
    // La proporción Cuotas:Escritura se mantiene (7:10)
    // Precisión 3, no 4: sobre remanentes chicos el redondeo a 2 decimales de cada monto
    // mueve la razón en ~1e-4. La proporción se conserva, no el cociente al bit.
    expect(base.cuotasUF / base.escrituraUF).toBeCloseTo(alta.cuotasUF / alta.escrituraUF, 3);
  });

  it('todos los casos suman exactamente el 100% (UF y %)', () => {
    const combos: Array<[number, boolean, number | undefined]> = [
      [5000, false, undefined], [4500, false, undefined], [5000, true, undefined], [4500, true, undefined],
      [5000, false, 5], [5000, true, 5], [4500, true, 8],
    ];
    for (const [pv, bono, prom] of combos) {
      const f = run(pv, bono, prom);
      expect(f.totalUF).toBe(pv); // invariante duro: la suma de partes = Precio de Venta
      const sumaPct = f.promesaPct + f.creditoPct + f.compraSeguraPct + f.cuotasPct + f.escrituraPct;
      expect(sumaPct).toBeCloseTo(100, 2);
    }
  });

  it('editar Cuotas/Escritura a mano nunca rompe el 100% (Escritura es el plug)', () => {
    // Distintos pesos de Cuotas:Escritura sobre el mismo remanente → siempre suman el precio de venta.
    for (const [c, e] of [[7, 10], [20, 10], [20, 3], [0, 10], [0, 0]] as const) {
      const f = run(5000, false, 3);
      const g = calcFormaPagoFija({ precioVenta: 5000, creditoPct: CREDITO_PCT, cuotasPct: c, escrituraPct: e, numCuotas: N_CUOTAS, promesaPct: 3 });
      expect(g.promesaUF + g.creditoUF + g.compraSeguraUF + g.cuotasUF + g.escrituraUF).toBe(5000);
      void f;
    }
    // Caso degenerado ambos 0: Escritura (plug) absorbe todo el remanente.
    const deg = calcFormaPagoFija({ precioVenta: 5000, creditoPct: 80, cuotasPct: 0, escrituraPct: 0, numCuotas: N_CUOTAS, promesaPct: 3 });
    expect(deg.cuotasUF).toBe(0);
    expect(deg.escrituraUF).toBe(850); // 5000 − 150 (3%) − 4000 (80%)
  });

  it('un peso de Cuotas enorme NO vuelve Escritura negativa (Cuotas es peso, no valor absoluto)', () => {
    for (const cuotasPct of [20, 1000, 999999]) {
      const f = calcFormaPagoFija({ precioVenta: 5000, creditoPct: 80, cuotasPct, escrituraPct: 1, numCuotas: N_CUOTAS, promesaPct: 3 });
      expect(f.escrituraUF).toBeGreaterThanOrEqual(0);   // nunca negativa
      expect(f.cuotasUF).toBeLessThanOrEqual(850);        // Cuotas ≤ remanente (no lo excede)
      expect(f.promesaUF + f.creditoUF + f.compraSeguraUF + f.cuotasUF + f.escrituraUF).toBe(5000);
    }
  });

  it('error=true si Promesa+Crédito+CompraSegura consumen el 100% (sin remanente)', () => {
    const f = calcFormaPagoFija({
      precioVenta: 5000, 
      creditoPct: 98, cuotasPct: CUOTAS_PCT, escrituraPct: ESCRITURA_PCT, numCuotas: N_CUOTAS,
    });
    expect(f.error).toBe(true);          // 3% + 98% > 100%
    expect(f.cuotasUF).toBe(0);
    expect(f.escrituraUF).toBe(0);
  });
});

// ── Edición cruzada precio ↔ descuento en el cuadro financiero ─────────────────
// Regla acordada: manda el campo que el usuario tipeó a mano. Si tipea un descuento,
// el precio se recalcula; si tipea un precio, ese precio debe sobrevivir intacto al
// volver a derivarse desde el % — por eso descuentoDesdePrecio NO redondea.
describe('descuentoDesdePrecio — inversa exacta de calcPrecioConDescuento', () => {
  it('ida y vuelta: el precio tipeado se reproduce al centésimo', () => {
    const orig = 4000;
    const pct = descuentoDesdePrecio(orig, 3333.33);
    expect(calcPrecioConDescuento(orig, pct)).toBe(3333.33);
  });

  it('el porcentaje conserva su precisión (no se recorta a 2 decimales)', () => {
    const pct = descuentoDesdePrecio(4000, 3333.33);
    expect(pct).toBeCloseTo(16.66675, 6);
    // Redondearlo a 2 decimales sería justamente lo que rompe la ida y vuelta.
    expect(calcPrecioConDescuento(4000, Math.round(pct * 100) / 100)).not.toBe(3333.33);
  });

  it('descuento cero cuando el precio es el de lista', () => {
    expect(descuentoDesdePrecio(5000, 5000)).toBe(0);
  });

  it('un precio SOBRE el de lista da un porcentaje negativo (recargo permitido)', () => {
    const pct = descuentoDesdePrecio(5000, 5500);
    expect(pct).toBe(-10);
    expect(calcPrecioConDescuento(5000, pct)).toBe(5500);
  });

  it('ida y vuelta desde el % también cierra', () => {
    const precio = calcPrecioConDescuento(5000, 7.5);
    expect(descuentoDesdePrecio(5000, precio)).toBeCloseTo(7.5, 10);
  });

  it('precio de lista 0 o negativo → 0, sin dividir por cero', () => {
    expect(descuentoDesdePrecio(0, 100)).toBe(0);
    expect(descuentoDesdePrecio(-1, 100)).toBe(0);
  });

  it('con bono, el precio tipeado es el que paga el comprador y el publicado va inflado', () => {
    const orig = 5000;
    const pagaComprador = 4200;
    const pct = descuentoDesdePrecio(orig, pagaComprador);
    const r = calcResumenUnidad({ precioListaOriginal: orig, dctoPct: pct, aplicaBono: true, bonoPct: 10 });
    expect(r.precioConDescuento).toBe(pagaComprador);   // lo tipeado sobrevive
    expect(r.precioVenta).toBe(pagaComprador);
    expect(r.valorTotal).toBe(4666.67);                  // publicado = 4200 / 0.9
  });
});

// ── Componentes activables de la forma de pago ────────────────────────────────
// Cada componente (Promesa / Cuotas / Escritura) se puede apagar desde la UI. Apagada
// aporta 0 y su parte se redistribuye entre las que quedan activas. El total tiene que
// seguir cuadrando con el precio de venta en todos los casos.
describe('calcFormaPagoFija — activar y desactivar componentes', () => {
  const base = {
    precioVenta: 5000,
    creditoPct: 60,
    cuotasPct: 7,
    escrituraPct: 10,
    numCuotas: 10,
    promesaPct: 3,
  };

  it('las tres activas equivalen a no pasar los flags (compatibilidad hacia atrás)', () => {
    const conFlags = calcFormaPagoFija({ ...base, promesaActiva: true, cuotasActiva: true, escrituraActiva: true });
    expect(conFlags).toEqual(calcFormaPagoFija(base));
  });

  it('Promesa apagada: su 3% se reparte entre Cuotas y Escritura', () => {
    const on = calcFormaPagoFija(base);
    const off = calcFormaPagoFija({ ...base, promesaActiva: false });
    expect(off.promesaUF).toBe(0);
    expect(off.promesaPct).toBe(0);
    // El crédito no se mueve; todo el 3% liberado va al reparto Cuotas/Escritura.
    expect(off.creditoUF).toBe(on.creditoUF);
    expect(r2(off.cuotasUF + off.escrituraUF)).toBe(r2(on.cuotasUF + on.escrituraUF + on.promesaUF));
    expect(off.totalUF).toBe(base.precioVenta);
    expect(off.error).toBe(false);
  });

  it('Cuotas apagada: Escritura absorbe todo el remanente', () => {
    const f = calcFormaPagoFija({ ...base, cuotasActiva: false });
    expect(f.cuotasUF).toBe(0);
    expect(f.cuotaIndividualUF).toBe(0);
    expect(f.escrituraUF).toBe(r2(5000 - f.promesaUF - f.creditoUF));
    expect(f.totalUF).toBe(5000);
    expect(f.error).toBe(false);
  });

  it('Escritura apagada: Cuotas pasa a ser el plug y absorbe todo el remanente', () => {
    const f = calcFormaPagoFija({ ...base, escrituraActiva: false });
    expect(f.escrituraUF).toBe(0);
    expect(f.cuotasUF).toBe(r2(5000 - f.promesaUF - f.creditoUF));
    expect(f.cuotaIndividualUF).toBe(r2(f.cuotasUF / 10));
    expect(f.totalUF).toBe(5000);
    expect(f.error).toBe(false);
  });

  it('Promesa Y Escritura apagadas: Cuotas se lleva todo lo que no es crédito', () => {
    const f = calcFormaPagoFija({ ...base, promesaActiva: false, escrituraActiva: false });
    expect(f.promesaUF).toBe(0);
    expect(f.escrituraUF).toBe(0);
    expect(f.cuotasUF).toBe(2000); // 5000 - 60% de crédito
    expect(f.totalUF).toBe(5000);
    expect(f.error).toBe(false);
  });

  it('Cuotas Y Escritura apagadas con remanente: error, nadie puede absorberlo', () => {
    const f = calcFormaPagoFija({ ...base, cuotasActiva: false, escrituraActiva: false });
    expect(f.error).toBe(true);
    expect(f.cuotasUF).toBe(0);
    expect(f.escrituraUF).toBe(0);
  });

  it('Cuotas Y Escritura apagadas SIN remanente (crédito 100%): no es error', () => {
    const f = calcFormaPagoFija({
      ...base, creditoPct: 100, promesaActiva: false, cuotasActiva: false, escrituraActiva: false,
    });
    expect(f.error).toBe(false);
    expect(f.creditoUF).toBe(5000);
    expect(f.totalUF).toBe(5000);
  });

  it('apagar una componente NO altera la Compra Segura, que depende del bono', () => {
    const conBono = { ...base, compraSeguraUF: calcBonificacion(calcValorTotal(5000, 10), 10), creditoPct: 50 };
    const on = calcFormaPagoFija(conBono);
    const off = calcFormaPagoFija({ ...conBono, promesaActiva: false });
    expect(off.compraSeguraUF).toBe(on.compraSeguraUF);
    expect(off.totalUF).toBe(on.totalUF);
  });

  it('el total cuadra con el precio de venta en las 8 combinaciones', () => {
    for (const promesaActiva of [true, false]) {
      for (const cuotasActiva of [true, false]) {
        for (const escrituraActiva of [true, false]) {
          const f = calcFormaPagoFija({ ...base, promesaActiva, cuotasActiva, escrituraActiva });
          if (f.error) continue; // el único caso sin destino para el remanente
          expect(f.totalUF).toBe(base.precioVenta);
        }
      }
    }
  });
});

// ── Compra Segura: el badge tiene que conversar con el bono configurado ────────
// El bono pie se define como un % del precio PUBLICADO (el inflado), no del precio con
// descuento. Dos errores hacían que el badge no cuadrara con el % del proyecto:
//   1. la fórmula usaba base × bono%, que da (1 − bono%) veces el bono real;
//   2. la base era solo el depto, dejando fuera el bono de bodegas y estacionamientos
//      pese a que su precio inflado sí entra en el precio de venta.
describe('calcFormaPagoFija — Compra Segura: inflar y luego aplicar el bono', () => {
  const armar = (base: number, precioVenta: number, bonoPct: number) => calcFormaPagoFija({
    precioVenta, compraSeguraUF: calcBonificacion(calcValorTotal(base, bonoPct), bonoPct),
    creditoPct: 80, cuotasPct: 20, escrituraPct: 10, numCuotas: 12, promesaPct: 3,
  });

  it('el bono se calcula inflando primero y aplicando el % después', () => {
    for (const bonoPct of [5, 10, 15, 20]) {
      const base = 5000;
      const publicado = calcValorTotal(base, bonoPct);       // base / (1 − bono%)
      const f = armar(base, publicado, bonoPct);
      expect(f.compraSeguraUF).toBe(calcBonificacion(publicado, bonoPct)); // × bono%
      // Sobre un precio de venta YA inflado el badge da el bono configurado…
      expect(f.compraSeguraPct).toBeCloseTo(bonoPct, 2);
    }
  });

  it('sobre un precio de venta SIN inflar el badge NO da el bono configurado, y está bien', () => {
    // Es el caso del cotizador: precioVenta = suma de precios con descuento, sin inflar.
    // El bono sigue siendo 10% del precio publicado, que sobre esa base pesa 11,11%.
    const base = 5000;
    const f = armar(base, base, 10);
    expect(f.compraSeguraUF).toBe(555.56);
    expect(f.compraSeguraPct).toBe(11.11);
    expect(f.compraSeguraPct).not.toBe(10);
  });

  it('coincide con el bono canónico de bonoPieCalc para la misma unidad', () => {
    const r = calcResumenUnidad({ precioListaOriginal: 5000, dctoPct: 0, bonoPct: 10, aplicaBono: true });
    const f = armar(r.precioConDescuento, r.valorTotal, 10);
    expect(f.compraSeguraUF).toBe(r.bonificacion);
  });

  it('depto + bodega con bono: la base suma las dos y el badge sigue dando el bono configurado', () => {
    const depto  = calcResumenUnidad({ precioListaOriginal: 5000, dctoPct: 0, bonoPct: 10, aplicaBono: true });
    const bodega = calcResumenUnidad({ precioListaOriginal: 200,  dctoPct: 0, bonoPct: 10, aplicaBono: true });
    const precioVenta = r2(depto.valorTotal + bodega.valorTotal);
    const f = armar(r2(depto.precioConDescuento + bodega.precioConDescuento), precioVenta, 10);
    // Contar solo el depto daba 500 UF en vez de 577,78. El 10% acá es exacto solo porque
    // el precio de venta de este caso va inflado y TODAS las unidades tienen bono.
    expect(f.compraSeguraUF).toBe(577.78);
    expect(f.compraSeguraPct).toBeCloseTo(10, 2);
    expect(f.totalUF).toBe(precioVenta);
  });

  it('los porcentajes mostrados suman exactamente 100, sin el 99,99 de antes', () => {
    const depto  = calcResumenUnidad({ precioListaOriginal: 5000, dctoPct: 0, bonoPct: 10, aplicaBono: true });
    const bodega = calcResumenUnidad({ precioListaOriginal: 200,  dctoPct: 0, bonoPct: 10, aplicaBono: true });
    const f = armar(r2(depto.precioConDescuento + bodega.precioConDescuento), r2(depto.valorTotal + bodega.valorTotal), 10);
    expect(r2(f.promesaPct + f.cuotasPct + f.escrituraPct + f.compraSeguraPct + f.creditoPct)).toBe(100);
  });

  it('sin bono no hay Compra Segura y los porcentajes igual suman 100', () => {
    const f = calcFormaPagoFija({
      precioVenta: 5000, 
      creditoPct: 80, cuotasPct: 20, escrituraPct: 10, numCuotas: 12, promesaPct: 3,
    });
    expect(f.compraSeguraUF).toBe(0);
    expect(f.compraSeguraPct).toBe(0);
    expect(r2(f.promesaPct + f.cuotasPct + f.escrituraPct + f.compraSeguraPct + f.creditoPct)).toBe(100);
  });
});

// ── Reparto en porcentajes reales (sin bono pie) ──────────────────────────────
// Sin Compra Segura los campos SON los porcentajes reales y tienen que sumar 100 junto
// con el Crédito. Al editar uno, los otros dos se recalculan; al apagar una componente,
// las que quedan se reparten de nuevo lo disponible.
describe('redistribuirPctReales', () => {
  const armar = (o: Partial<Parameters<typeof redistribuirPctReales>[0]> = {}) => redistribuirPctReales({
    actual: { promesaPct: 3, cuotasPct: 20, escrituraPct: 10 },
    promesaActiva: true, cuotasActiva: true, escrituraActiva: true,
    creditoPct: 80,
    ...o,
  });
  const suma = (r: RepartoPctReales) => r2(r.promesaPct + r.cuotasPct + r.escrituraPct);

  it('normaliza los pesos a porcentajes reales que cierran con el crédito', () => {
    const r = armar();
    expect(suma(r)).toBe(20);            // 100 − 80 de crédito
    expect(r.promesaPct).toBe(3);        // conserva su piso
    // Los 17 restantes se reparten 20:10 entre Cuotas y Escritura.
    expect(r.cuotasPct).toBe(11.33);
    expect(r.escrituraPct).toBe(5.67);
  });

  it('apagar Promesa reparte su parte entre Cuotas y Escritura', () => {
    const r = armar({ promesaActiva: false });
    expect(r.promesaPct).toBe(0);
    expect(suma(r)).toBe(20);
    expect(r.cuotasPct).toBe(13.33);
    expect(r.escrituraPct).toBe(6.67);
  });

  it('apagar Escritura deja a Cuotas con todo lo que no es Promesa', () => {
    const r = armar({ escrituraActiva: false });
    expect(r.escrituraPct).toBe(0);
    expect(r.promesaPct).toBe(3);
    expect(r.cuotasPct).toBe(17);
    expect(suma(r)).toBe(20);
  });

  it('editar Promesa a mano recalcula las OTRAS DOS en proporción', () => {
    const r = armar({ actual: { promesaPct: 5, cuotasPct: 11.33, escrituraPct: 5.67 }, fijada: 'promesa' });
    expect(r.promesaPct).toBe(5);
    expect(suma(r)).toBe(20);
    // 15 repartidos 11.33:5.67 → se conserva la proporción previa.
    expect(r.cuotasPct).toBe(10);
    expect(r.escrituraPct).toBe(5);
  });

  it('editar Cuotas a mano deja el resto a Escritura y respeta el piso de Promesa', () => {
    const r = armar({ actual: { promesaPct: 3, cuotasPct: 15, escrituraPct: 5.67 }, fijada: 'cuotas' });
    expect(r.cuotasPct).toBe(15);
    expect(r.promesaPct).toBe(3);        // el piso no se toca
    expect(r.escrituraPct).toBe(2);
    expect(suma(r)).toBe(20);
  });

  it('un valor manual mayor a lo disponible se recorta dejando el piso de la Promesa', () => {
    const r = armar({ actual: { promesaPct: 3, cuotasPct: 99, escrituraPct: 5.67 }, fijada: 'cuotas' });
    expect(r.cuotasPct).toBe(17);        // 20 disponible − 3 del piso
    expect(r.promesaPct).toBe(3);
    expect(r.escrituraPct).toBe(0);
    expect(suma(r)).toBe(20);
  });

  it('la Promesa nunca baja de su piso al redistribuir', () => {
    const r = armar({ actual: { promesaPct: 0.5, cuotasPct: 20, escrituraPct: 10 } });
    expect(r.promesaPct).toBe(PROMESA_PCT_MIN);
    expect(suma(r)).toBe(20);
  });

  it('si el crédito no deja espacio para el piso, la Promesa toma lo que haya', () => {
    const r = armar({ creditoPct: 98 });
    expect(r.promesaPct).toBe(2);        // solo quedan 2 puntos
    expect(suma(r)).toBe(2);
  });

  it('todas en cero se reparten en partes iguales, no quedan en cero', () => {
    const r = armar({ actual: { promesaPct: 0, cuotasPct: 0, escrituraPct: 0 } });
    expect(suma(r)).toBe(20);
    // 20/3 a cada una. El piso de la Promesa es un mínimo, no un objetivo: queda por encima.
    expect(r.promesaPct).toBe(6.67);
    expect(r.promesaPct).toBeGreaterThanOrEqual(PROMESA_PCT_MIN);
    expect(r.cuotasPct).toBe(6.67);
  });

  it('crédito al 100% deja las tres en cero', () => {
    const r = armar({ creditoPct: 100 });
    expect(r).toEqual({ promesaPct: 0, cuotasPct: 0, escrituraPct: 0 });
  });

  it('el reparto cierra exacto en las 8 combinaciones de activas', () => {
    for (const promesaActiva of [true, false]) {
      for (const cuotasActiva of [true, false]) {
        for (const escrituraActiva of [true, false]) {
          const r = armar({ promesaActiva, cuotasActiva, escrituraActiva });
          const esperado = (promesaActiva || cuotasActiva || escrituraActiva) ? 20 : 0;
          expect(suma(r)).toBe(esperado);
        }
      }
    }
  });

  // La UI corre esta función en un useEffect que depende de los mismos valores que escribe.
  // Si no fuera idempotente, ese efecto entraría en bucle infinito.
  it('es idempotente: aplicarla dos veces da el mismo resultado', () => {
    const casos: Array<Partial<Parameters<typeof redistribuirPctReales>[0]>> = [
      {}, { promesaActiva: false }, { escrituraActiva: false }, { cuotasActiva: false },
      { creditoPct: 0 }, { creditoPct: 98 }, { creditoPct: 100 },
      { actual: { promesaPct: 0, cuotasPct: 0, escrituraPct: 0 } },
      { actual: { promesaPct: 3, cuotasPct: 15, escrituraPct: 2 }, fijada: 'cuotas' },
    ];
    for (const caso of casos) {
      const uno = armar(caso);
      const dos = redistribuirPctReales({
        actual: uno,
        promesaActiva: caso.promesaActiva ?? true,
        cuotasActiva: caso.cuotasActiva ?? true,
        escrituraActiva: caso.escrituraActiva ?? true,
        creditoPct: caso.creditoPct ?? 80,
      });
      expect(dos).toEqual(uno);
    }
  });

  it('el resultado alimenta a calcFormaPagoFija sin que los % cambien', () => {
    // Invariante clave: si el estado guarda porcentajes reales coherentes, el reparto por
    // pesos de calcFormaPagoFija devuelve exactamente esos mismos porcentajes.
    const r = armar();
    const f = calcFormaPagoFija({
      precioVenta: 5000,
      creditoPct: 80, cuotasPct: r.cuotasPct, escrituraPct: r.escrituraPct,
      numCuotas: 12, promesaPct: r.promesaPct,
    });
    expect(f.promesaPct).toBeCloseTo(r.promesaPct, 2);
    expect(f.cuotasPct).toBeCloseTo(r.cuotasPct, 2);
    expect(f.escrituraPct).toBeCloseTo(r.escrituraPct, 2);
    expect(f.totalUF).toBe(5000);
  });
});
