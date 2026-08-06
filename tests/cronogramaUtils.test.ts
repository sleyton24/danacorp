import { describe, it, expect } from 'vitest';
import {
  ordenarPorVencimiento,
  fechaCuota,
  ajustarDiaHabil,
  normalizarDiaPago,
  DIA_PAGO_DEFAULT,
  type CronogramaRow,
} from '../src/utils/cronogramaUtils';

// Helper: fila mínima identificada por uid. Algunos tests usan un tipo enriquecido
// (id/label, status) para verificar que la identidad es por uid y no por el label
// editable, que puede estar duplicado.
const row = (uid: string, date: string): CronogramaRow => ({ uid, date });
const fechas = (filas: CronogramaRow[]) => filas.map(f => `${f.uid}:${f.date}`);

describe('ordenarPorVencimiento — el usuario ordena, nada se mueve solo', () => {
  const base = [row('A', '2024-03-15'), row('B', '2024-01-15'), row('C', '2024-02-15')];

  it('ordena ascendente', () => {
    expect(fechas(ordenarPorVencimiento(base, 'asc')))
      .toEqual(['B:2024-01-15', 'C:2024-02-15', 'A:2024-03-15']);
  });

  it('ordena descendente', () => {
    expect(fechas(ordenarPorVencimiento(base, 'desc')))
      .toEqual(['A:2024-03-15', 'C:2024-02-15', 'B:2024-01-15']);
  });

  it('no cambia ninguna FECHA, solo el orden de las filas', () => {
    const out = ordenarPorVencimiento(base, 'asc');
    expect([...out].map(f => f.date).sort()).toEqual([...base].map(f => f.date).sort());
  });

  it('es estable entre fechas iguales: conserva el orden relativo previo', () => {
    const empatadas = [row('X', '2024-01-10'), row('Y', '2024-01-10'), row('Z', '2024-01-05')];
    expect(fechas(ordenarPorVencimiento(empatadas, 'asc')))
      .toEqual(['Z:2024-01-05', 'X:2024-01-10', 'Y:2024-01-10']);
  });

  it('no muta el arreglo de entrada', () => {
    const copia = JSON.parse(JSON.stringify(base));
    ordenarPorVencimiento(base, 'desc');
    expect(base).toEqual(copia);
  });

  it('identifica por uid aunque el label esté duplicado', () => {
    type Rica = CronogramaRow & { id: string; status: string };
    const filas: Rica[] = [
      { uid: 'u1', id: 'Cuota 1', date: '2024-03-01', status: 'Pendiente' },
      { uid: 'u2', id: 'Cuota 1', date: '2024-01-01', status: 'Pagado' }, // label duplicado a propósito
    ];
    expect(ordenarPorVencimiento(filas, 'asc').map(f => f.uid)).toEqual(['u2', 'u1']);
  });
});

describe('normalizarDiaPago', () => {
  it('acepta días válidos', () => {
    expect(normalizarDiaPago(5)).toBe(5);
    expect(normalizarDiaPago('31')).toBe(31);
  });
  it('recorta fuera de rango', () => {
    expect(normalizarDiaPago(0)).toBe(1);
    expect(normalizarDiaPago(-4)).toBe(1);
    expect(normalizarDiaPago(99)).toBe(31);
  });
  it('cae en el default con basura', () => {
    expect(normalizarDiaPago('')).toBe(DIA_PAGO_DEFAULT);
    expect(normalizarDiaPago('abc')).toBe(DIA_PAGO_DEFAULT);
    expect(normalizarDiaPago(undefined)).toBe(DIA_PAGO_DEFAULT);
  });
  it('trunca decimales', () => {
    expect(normalizarDiaPago(5.9)).toBe(5);
  });
});

describe('ajustarDiaHabil — fin de semana al viernes anterior', () => {
  it('deja intacto un día hábil', () => {
    expect(ajustarDiaHabil('2024-01-10')).toBe('2024-01-10'); // miércoles
  });
  it('sábado → viernes anterior', () => {
    expect(ajustarDiaHabil('2024-01-13')).toBe('2024-01-12'); // sáb → vie
  });
  it('domingo → viernes anterior', () => {
    expect(ajustarDiaHabil('2024-01-14')).toBe('2024-01-12'); // dom → vie
  });

  // La excepción que evita romper la secuencia mensual: retroceder desde los primeros
  // días del mes saldría al mes ANTERIOR y la cuota podría quedar antes que la previa.
  it('domingo 1 → lunes 2, NO al viernes del mes anterior', () => {
    expect(ajustarDiaHabil('2024-09-01')).toBe('2024-09-02'); // dom 1 sep → lun 2 sep
  });
  it('sábado 1 → lunes 3, NO al viernes del mes anterior', () => {
    expect(ajustarDiaHabil('2024-06-01')).toBe('2024-06-03'); // sáb 1 jun → lun 3 jun
  });
  it('domingo 2 → viernes 30 del mes anterior NO ocurre: se va al lunes 3', () => {
    expect(ajustarDiaHabil('2025-03-02')).toBe('2025-03-03'); // dom 2 mar → lun 3 mar
  });
});

describe('fechaCuota — día de pago fijo con clamp de fin de mes', () => {
  it('mantiene el día al avanzar de mes', () => {
    expect(fechaCuota(2024, 1, 1, 15)).toBe('2024-02-15');
    expect(fechaCuota(2024, 1, 2, 15)).toBe('2024-03-15');
  });

  it('día 31 en un mes de 30 toma el 30', () => {
    expect(fechaCuota(2024, 3, 1, 31)).toBe('2024-04-30'); // abril
  });

  it('día 31 en febrero bisiesto toma el 29', () => {
    expect(fechaCuota(2024, 1, 1, 31)).toBe('2024-02-29');
  });

  it('día 31 en febrero NO bisiesto toma el 28', () => {
    expect(fechaCuota(2023, 1, 1, 31)).toBe('2023-02-28');
  });

  it('rollover de año', () => {
    expect(fechaCuota(2024, 12, 1, 10)).toBe('2025-01-10');
  });

  it('offset largo cruza varios años', () => {
    expect(fechaCuota(2024, 1, 25, 10)).toBe('2026-02-10');
  });

  it('recorta un día de pago inválido en vez de producir una fecha rota', () => {
    expect(fechaCuota(2024, 1, 1, 0)).toBe('2024-02-01');
    expect(fechaCuota(2024, 1, 1, 99)).toBe('2024-02-29');
  });

  it('aplica el ajuste de fin de semana sobre el día ya recortado', () => {
    // 31 ago 2024 es sábado → viernes 30.
    expect(fechaCuota(2024, 7, 1, 31)).toBe('2024-08-30');
  });

  it('la secuencia mensual queda siempre creciente, incluso con día 1 y fines de semana', () => {
    // Sep 2024 empieza domingo: la excepción del lunes evita que se salga del mes.
    const seq = [0, 1, 2, 3, 4, 5].map(i => fechaCuota(2024, 8, i, 1));
    const ordenada = [...seq].sort();
    expect(seq).toEqual(ordenada);
    expect(new Set(seq).size).toBe(seq.length);
  });

  it('la secuencia con día 31 también queda creciente (clamp por mes)', () => {
    const seq = Array.from({ length: 14 }, (_, i) => fechaCuota(2024, 1, i, 31));
    expect(seq).toEqual([...seq].sort());
  });
});
