import { describe, it, expect } from 'vitest';
import { calcFormaPagoFija, PROMESA_PCT_MIN } from '../src/utils/pricingUtils';

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
    precioConDescuentoDepto: precioVenta, // un solo depto, sin split de bodegas/estac.
    aplicaBono,
    bonoPct: 10,
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
    expect(f.compraSeguraUF).toBe(500);
    expect(f.creditoUF).toBe(4000);
    expect(f.cuotasUF).toBe(144.12);
    expect(f.escrituraUF).toBe(205.88);
    expect(f.totalUF).toBe(5000);
  });

  it('Caso 4 — descuento 10% + bono pie 10% combinados (PV 4500)', () => {
    const f = run(4500, true);
    expect(f.promesaUF).toBe(135);
    expect(f.compraSeguraUF).toBe(450);
    expect(f.creditoUF).toBe(3600);
    expect(f.cuotasUF).toBe(129.71);
    expect(f.escrituraUF).toBe(185.29);
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
    expect(f.promesaUF).toBe(250);       // 5% de 5000
    expect(f.creditoUF).toBe(4000);      // fijo
    expect(f.compraSeguraUF).toBe(500);  // fijo por config
    expect(f.cuotasUF).toBe(102.94);     // 250 × 7/17  (bajó desde 144.12)
    expect(f.escrituraUF).toBe(147.06);  // 250 − 102.94 (bajó desde 205.88)
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
    expect(base.cuotasUF / base.escrituraUF).toBeCloseTo(alta.cuotasUF / alta.escrituraUF, 4);
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
      const g = calcFormaPagoFija({ precioVenta: 5000, precioConDescuentoDepto: 5000, aplicaBono: false, bonoPct: 0, creditoPct: CREDITO_PCT, cuotasPct: c, escrituraPct: e, numCuotas: N_CUOTAS, promesaPct: 3 });
      expect(g.promesaUF + g.creditoUF + g.compraSeguraUF + g.cuotasUF + g.escrituraUF).toBe(5000);
      void f;
    }
    // Caso degenerado ambos 0: Escritura (plug) absorbe todo el remanente.
    const deg = calcFormaPagoFija({ precioVenta: 5000, precioConDescuentoDepto: 5000, aplicaBono: false, bonoPct: 0, creditoPct: 80, cuotasPct: 0, escrituraPct: 0, numCuotas: N_CUOTAS, promesaPct: 3 });
    expect(deg.cuotasUF).toBe(0);
    expect(deg.escrituraUF).toBe(850); // 5000 − 150 (3%) − 4000 (80%)
  });

  it('un peso de Cuotas enorme NO vuelve Escritura negativa (Cuotas es peso, no valor absoluto)', () => {
    for (const cuotasPct of [20, 1000, 999999]) {
      const f = calcFormaPagoFija({ precioVenta: 5000, precioConDescuentoDepto: 5000, aplicaBono: false, bonoPct: 0, creditoPct: 80, cuotasPct, escrituraPct: 1, numCuotas: N_CUOTAS, promesaPct: 3 });
      expect(f.escrituraUF).toBeGreaterThanOrEqual(0);   // nunca negativa
      expect(f.cuotasUF).toBeLessThanOrEqual(850);        // Cuotas ≤ remanente (no lo excede)
      expect(f.promesaUF + f.creditoUF + f.compraSeguraUF + f.cuotasUF + f.escrituraUF).toBe(5000);
    }
  });

  it('error=true si Promesa+Crédito+CompraSegura consumen el 100% (sin remanente)', () => {
    const f = calcFormaPagoFija({
      precioVenta: 5000, precioConDescuentoDepto: 5000, aplicaBono: false, bonoPct: 0,
      creditoPct: 98, cuotasPct: CUOTAS_PCT, escrituraPct: ESCRITURA_PCT, numCuotas: N_CUOTAS,
    });
    expect(f.error).toBe(true);          // 3% + 98% > 100%
    expect(f.cuotasUF).toBe(0);
    expect(f.escrituraUF).toBe(0);
  });
});
