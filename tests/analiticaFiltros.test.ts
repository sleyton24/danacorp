import { describe, it, expect } from 'vitest';
import {
  ventanaPeriodo, ventanaComparacion, enVentana,
  aplicarCruce, hayCruce, tipologia, CRUCE_VACIO, type CruceAnalitico,
  delta,
} from '../src/utils/analiticaFiltros';
import { crearIndiceVinculos } from '../src/utils/analytics';
import { RealEstateUnit } from '../src/types';

// Rediseño Resumen/Performance — funciones puras de filtrado cruzado y comparación de
// períodos. El foco está en los bordes que el propio prototipo documentó haber tenido
// que corregir (rollover de calendario, denominador que se filtra por error).

const unidad = (over: Partial<RealEstateUnit> = {}): RealEstateUnit => ({
  id: over.id ?? 'u1',
  projectId: 'p1',
  numero: over.numero ?? '101',
  type: over.type ?? 'Departamento',
  estado: over.estado ?? 'Disponible',
  bodegas: over.bodegas ?? [],
  estacionamientos: over.estacionamientos ?? [],
  precioLista: over.precioLista ?? 1000,
  precioVenta: over.precioVenta ?? 1000,
  pie: 0, bonoDescuento: 0, reservaMonto: 0, creditoHipotecario: 0,
  totalPagado: 0, saldoPorPagar: 0, planPagos: over.planPagos ?? [], observaciones: '',
  ...over,
});

describe('ventanaPeriodo', () => {
  it('mes: [1ro del mes, 1ro del mes siguiente)', () => {
    const [desde, hasta] = ventanaPeriodo('month', 0, new Date(2026, 6, 15))!;
    expect(desde).toEqual(new Date(2026, 6, 1));
    expect(hasta).toEqual(new Date(2026, 7, 1));
  });

  it('trimestre con offset que cruza el año: Q1 2026 con offset 1 da Q4 2025, no Q0 2026', () => {
    const [desde, hasta] = ventanaPeriodo('quarter', 1, new Date(2026, 0, 15))!;
    expect(desde).toEqual(new Date(2025, 9, 1));  // 1 oct 2025
    expect(hasta).toEqual(new Date(2026, 0, 1));  // 1 ene 2026
  });

  it('año con offset', () => {
    const [desde, hasta] = ventanaPeriodo('year', 1, new Date(2026, 5, 1))!;
    expect(desde).toEqual(new Date(2025, 0, 1));
    expect(hasta).toEqual(new Date(2026, 0, 1));
  });

  it("'all' no tiene ventana", () => {
    expect(ventanaPeriodo('all', 0, new Date(2026, 0, 1))).toBeNull();
  });
});

describe('ventanaComparacion', () => {
  it("'none' o periodo 'all' -> sin comparación", () => {
    expect(ventanaComparacion('month', 'none', new Date(2026, 0, 1))).toBeNull();
    expect(ventanaComparacion('all', 'prev', new Date(2026, 0, 1))).toBeNull();
  });

  it("'prev' es la ventana con offset 1", () => {
    const ahora = new Date(2026, 6, 15);
    expect(ventanaComparacion('month', 'prev', ahora)).toEqual(ventanaPeriodo('month', 1, ahora));
  });

  it("'yoy' respeta 29 de febrero en año bisiesto (no rebota a marzo)", () => {
    // 2028 es bisiesto; el trimestre Q1 2028 incluye el 29-feb. yoy debe caer en 2027,
    // que NO es bisiesto — new Date(2027, 1, 29) rebota a 1-mar si no se maneja bien,
    // pero acá se desplaza el rango [desde,hasta) completo, no un día suelto, así que
    // el límite superior (1-abr) sigue siendo válido en cualquier año.
    const ahora = new Date(2028, 1, 29);
    const yoy = ventanaComparacion('quarter', 'yoy', ahora)!;
    expect(yoy[0]).toEqual(new Date(2027, 0, 1));
    expect(yoy[1]).toEqual(new Date(2027, 3, 1));
  });
});

describe('enVentana', () => {
  const v: [Date, Date] = [new Date(2026, 0, 1), new Date(2026, 1, 1)];
  it('ventana null no filtra nada', () => {
    expect(enVentana(new Date(2020, 0, 1), null)).toBe(true);
    expect(enVentana(null, null)).toBe(true);
  });
  it('fecha null queda fuera de una ventana acotada', () => {
    expect(enVentana(null, v)).toBe(false);
  });
  it('límite inferior inclusive, superior exclusivo', () => {
    expect(enVentana(new Date(2026, 0, 1), v)).toBe(true);
    expect(enVentana(new Date(2026, 0, 31), v)).toBe(true);
    expect(enVentana(new Date(2026, 1, 1), v)).toBe(false);
  });
});

describe('aplicarCruce', () => {
  const depto1 = unidad({ id: 'd1', numero: '101', type: 'Departamento', estado: 'Escriturado', piso: 1, dormitorios: 2, banos: 2, banco: 'BCI', bodegas: ['B1'] });
  const depto2 = unidad({ id: 'd2', numero: '201', type: 'Departamento', estado: 'Disponible', piso: 2, dormitorios: 3, banos: 2, banco: undefined });
  const bodega1 = unidad({ id: 'bod1', numero: 'B1', type: 'Bodega', estado: 'Libre Asignación', piso: undefined, banco: undefined });
  const units = [depto1, depto2, bodega1];
  const vinculos = crearIndiceVinculos([depto1, depto2]);

  it('cruce por estado usa el estado EFECTIVO, no el crudo: la bodega vinculada a un Escriturado entra', () => {
    const out = aplicarCruce(units, { ...CRUCE_VACIO, estado: 'Escriturado' }, vinculos);
    expect(out.map(u => u.id).sort()).toEqual(['bod1', 'd1']);
  });

  it('cruce por piso solo aplica a departamentos; la bodega (sin piso) queda fuera', () => {
    const out = aplicarCruce(units, { ...CRUCE_VACIO, piso: 1 }, vinculos);
    expect(out.map(u => u.id)).toEqual(['d1']);
  });

  it('cruce por tipología solo aplica a departamentos', () => {
    const out = aplicarCruce(units, { ...CRUCE_VACIO, tipologia: tipologia(depto2) }, vinculos);
    expect(out.map(u => u.id)).toEqual(['d2']);
  });

  it('cruce por banco no se hereda al padre: la bodega no tiene banco propio y queda fuera aunque su depto sí', () => {
    const out = aplicarCruce(units, { ...CRUCE_VACIO, banco: 'BCI' }, vinculos);
    expect(out.map(u => u.id)).toEqual(['d1']);
  });

  it('`excepto` excluye esa clave del propio filtro — el bloque no se autoaplica su cruce', () => {
    const cruce: CruceAnalitico = { ...CRUCE_VACIO, piso: 1 };
    const conExcepto = aplicarCruce(units, cruce, vinculos, 'piso');
    // Sin excluirse, el denominador de "piso" quedaría reducido a solo depto1 (100% en
    // esa fila) — con `excepto: 'piso'` el filtro de piso no se aplica, solo el resto.
    expect(conExcepto.map(u => u.id).sort()).toEqual(['bod1', 'd1', 'd2']);
  });

  it('sin cruce activo, aplicarCruce no filtra nada (denominador real, regla central de la propuesta)', () => {
    expect(hayCruce(CRUCE_VACIO)).toBe(false);
    const out = aplicarCruce(units, CRUCE_VACIO, vinculos);
    expect(out).toHaveLength(3);
  });
});

describe('tipologia', () => {
  it('formatea dormitorios + baños', () => {
    expect(tipologia(unidad({ dormitorios: 2, banos: 1 }))).toBe('2D + 1B');
  });
  it('unidades sin dormitorios/baños declarados no rompen (0D + 0B)', () => {
    expect(tipologia(unidad({ dormitorios: undefined, banos: undefined }))).toBe('0D + 0B');
  });
});

describe('delta', () => {
  it('sin período de comparación -> null', () => {
    expect(delta(100, null)).toBeNull();
    expect(delta(100, undefined)).toBeNull();
  });
  it('previo=0, actual=0 -> igual (no "nuevo": no hubo nada antes ni ahora)', () => {
    expect(delta(0, 0)).toEqual({ texto: 'igual', direccion: 'flat', pct: null });
  });
  it('previo=0, actual>0 -> nuevo (evita dividir por cero)', () => {
    expect(delta(50, 0)).toEqual({ texto: 'nuevo', direccion: 'nuevo', pct: null });
  });
  it('sube', () => {
    const d = delta(150, 100);
    expect(d?.direccion).toBe('up');
    expect(d?.pct).toBe(50);
  });
  it('baja', () => {
    const d = delta(80, 100);
    expect(d?.direccion).toBe('down');
    expect(d?.pct).toBe(-20);
  });
  it('igual valor -> igual', () => {
    expect(delta(100, 100)).toEqual({ texto: 'igual', direccion: 'flat', pct: 0 });
  });
});
