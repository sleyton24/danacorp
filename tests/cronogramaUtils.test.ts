import { describe, it, expect } from 'vitest';
import {
  recalcularCronograma,
  insertarFilaOrdenada,
  sumarUnMes,
  type CronogramaRow,
} from '../src/utils/cronogramaUtils';

// Helper: fila mínima. Algunos tests usan un tipo enriquecido (status/tipo) para
// verificar que la cascada ignora esos campos y solo cambia `date`.
const row = (id: string, date: string): CronogramaRow => ({ id, date });
const fechas = (filas: CronogramaRow[]) => filas.map(f => `${f.id}:${f.date}`);

describe('sumarUnMes — borde fin de mes / año bisiesto', () => {
  it('suma un mes normal', () => {
    expect(sumarUnMes('2024-01-15')).toBe('2024-02-15');
  });
  it('31 de enero en año bisiesto → 29 de febrero', () => {
    expect(sumarUnMes('2024-01-31')).toBe('2024-02-29');
  });
  it('31 de enero en año NO bisiesto → 28 de febrero', () => {
    expect(sumarUnMes('2023-01-31')).toBe('2023-02-28');
  });
  it('30 de enero bisiesto → 29 de febrero (día clamped)', () => {
    expect(sumarUnMes('2024-01-30')).toBe('2024-02-29');
  });
  it('diciembre → enero del año siguiente (rollover de año)', () => {
    expect(sumarUnMes('2024-12-31')).toBe('2025-01-31');
  });
  it('31 de marzo → 30 de abril (abril tiene 30)', () => {
    expect(sumarUnMes('2024-03-31')).toBe('2024-04-30');
  });
});

describe('C.2 Caso 1 — cascada simple', () => {
  it('editar fila del medio (coherente) encadena +1 mes hacia abajo; arriba intacto', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-15'), row('C', '2024-03-15')];
    const out = recalcularCronograma(filas, 'B', '2024-02-20');
    expect(fechas(out)).toEqual(['A:2024-01-15', 'B:2024-02-20', 'C:2024-03-20']);
  });

  it('editar la primera fila (coherente) cascada a todas las de abajo', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-15'), row('C', '2024-03-15')];
    const out = recalcularCronograma(filas, 'A', '2024-01-10');
    expect(fechas(out)).toEqual(['A:2024-01-10', 'B:2024-02-10', 'C:2024-03-10']);
  });

  it('no muta el arreglo de entrada', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-15')];
    const copia = JSON.parse(JSON.stringify(filas));
    recalcularCronograma(filas, 'A', '2024-01-20');
    expect(filas).toEqual(copia);
  });

  it('la cascada ignora tipo de pago y estado "Pagado" (solo cambia date)', () => {
    type Rica = CronogramaRow & { tipo: string; status: string };
    const filas: Rica[] = [
      { id: 'Promesa', date: '2024-01-15', tipo: 'Promesa', status: 'Pagado' },
      { id: 'Cuota 1', date: '2024-02-15', tipo: 'Cuotas', status: 'Pagado' },
      { id: 'Escritura', date: '2024-03-15', tipo: 'Escritura', status: 'Pendiente' },
    ];
    const out = recalcularCronograma(filas, 'Promesa', '2024-01-31');
    expect(out.map(f => `${f.id}:${f.date}:${f.status}`)).toEqual([
      'Promesa:2024-01-31:Pagado',
      'Cuota 1:2024-02-29:Pagado',      // pagada igual se recalcula
      'Escritura:2024-03-29:Pendiente',
    ]);
  });
});

describe('C.2 Caso 1 — cascada con borde fin de mes / bisiesto', () => {
  it('cascada arrastra el clamp de fin de mes en cadena', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-20'), row('C', '2024-03-25')];
    // A→31 ene (coherente: <= B 02-20). Cascada: 01-31 → 02-29 → 03-29.
    const out = recalcularCronograma(filas, 'A', '2024-01-31');
    expect(fechas(out)).toEqual(['A:2024-01-31', 'B:2024-02-29', 'C:2024-03-29']);
  });
});

describe('C.2 Caso 2 — reordenamiento (sin cascada)', () => {
  it('reordenamiento simple: fila del medio se mueve hacia abajo; demás fechas intactas', () => {
    const filas = [
      row('A', '2024-01-15'), row('B', '2024-02-15'),
      row('C', '2024-03-15'), row('D', '2024-04-15'),
    ];
    const out = recalcularCronograma(filas, 'B', '2024-03-20');
    expect(fechas(out)).toEqual(['A:2024-01-15', 'C:2024-03-15', 'B:2024-03-20', 'D:2024-04-15']);
  });

  it('reordenamiento al principio: la última se mueve al inicio', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-15'), row('C', '2024-03-15')];
    const out = recalcularCronograma(filas, 'C', '2024-01-01');
    expect(fechas(out)).toEqual(['C:2024-01-01', 'A:2024-01-15', 'B:2024-02-15']);
  });

  it('reordenamiento al final: la primera se mueve al final', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-15'), row('C', '2024-03-15')];
    const out = recalcularCronograma(filas, 'A', '2024-04-01');
    expect(fechas(out)).toEqual(['B:2024-02-15', 'C:2024-03-15', 'A:2024-04-01']);
  });

  it('no muta el arreglo de entrada', () => {
    const filas = [row('A', '2024-01-15'), row('B', '2024-02-15'), row('C', '2024-03-15')];
    const copia = JSON.parse(JSON.stringify(filas));
    recalcularCronograma(filas, 'A', '2024-04-01');
    expect(filas).toEqual(copia);
  });
});

describe('C.1 — inserción de fila nueva en su posición cronológica', () => {
  const base = [row('A', '2024-01-15'), row('B', '2024-03-15')];

  it('inserción al inicio (más antigua que todas)', () => {
    const out = insertarFilaOrdenada(base, row('N', '2024-01-01'));
    expect(fechas(out)).toEqual(['N:2024-01-01', 'A:2024-01-15', 'B:2024-03-15']);
  });

  it('inserción en el medio', () => {
    const out = insertarFilaOrdenada(base, row('N', '2024-02-15'));
    expect(fechas(out)).toEqual(['A:2024-01-15', 'N:2024-02-15', 'B:2024-03-15']);
  });

  it('inserción al final (más reciente que todas)', () => {
    const out = insertarFilaOrdenada(base, row('N', '2024-05-01'));
    expect(fechas(out)).toEqual(['A:2024-01-15', 'B:2024-03-15', 'N:2024-05-01']);
  });

  it('no dispara cascada: ninguna fila existente cambia de fecha', () => {
    const out = insertarFilaOrdenada(base, row('N', '2024-02-15'));
    expect(out.filter(f => f.id !== 'N')).toEqual(base);
  });
});
