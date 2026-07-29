import { describe, it, expect } from 'vitest';
import {
  esEscriturado, esComprometido, estaTomado, esRolVendedor,
  sumarUF, contarPorEstado,
  parsearMonto, sumarPagado,
  parseFechaFlexible, bucketMes, enPeriodo,
  crearIndiceVinculos, estadoEfectivoUnidad, fechaHitoUnidad, departamentoPadre,
  vendedorAtribuidoId,
} from '../src/utils/analytics';
import { RealEstateUnit, PaymentItem, Client } from '../src/types';

// Fase 1 — tests del módulo compartido de analítica. Son funciones puras; el foco está en
// los bordes que hoy producen números falsos en las vistas, no en el camino feliz.

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

const cuota = (amount: unknown, status: PaymentItem['status'] = 'Pagado'): PaymentItem =>
  ({ uid: 'x', id: 'Cuota', date: '', amount: amount as string, status });

// ── Alcances ─────────────────────────────────────────────────────────────────
describe('alcances de estado', () => {
  it('escriturado es el más estrecho: solo Escriturado', () => {
    expect(esEscriturado('Escriturado')).toBe(true);
    expect(esEscriturado('Promesado')).toBe(false);
    expect(esEscriturado('Reservado')).toBe(false);
  });

  it('comprometido incluye promesado pero no reservado', () => {
    expect(esComprometido('Promesado')).toBe(true);
    expect(esComprometido('Escriturado')).toBe(true);
    expect(esComprometido('Reservado')).toBe(false);
  });

  it('tomado incluye la reserva revocable', () => {
    expect(estaTomado('Reservado')).toBe(true);
    expect(estaTomado('Promesado')).toBe(true);
    expect(estaTomado('Escriturado')).toBe(true);
    expect(estaTomado('Disponible')).toBe(false);
  });

  it('los estados de bodegas/estacionamientos no entran en ningún alcance', () => {
    for (const estado of ['Libre Asignación', 'Asignado']) {
      expect(esEscriturado(estado)).toBe(false);
      expect(esComprometido(estado)).toBe(false);
      expect(estaTomado(estado)).toBe(false);
    }
  });

  it('los roles vendedores incluyen Supervisor y Admin', () => {
    expect(esRolVendedor('Ventas')).toBe(true);
    expect(esRolVendedor('JefeSala')).toBe(true);
    expect(esRolVendedor('Supervisor')).toBe(true);
    expect(esRolVendedor('Admin')).toBe(true);
    expect(esRolVendedor('Lectura')).toBe(false);
  });
});

// ── sumarUF / contarPorEstado ────────────────────────────────────────────────
describe('sumarUF', () => {
  it('suma todos los tipos de unidad, no solo departamentos', () => {
    const us = [
      unidad({ id: 'd', type: 'Departamento', precioVenta: 5000 }),
      unidad({ id: 'b', type: 'Bodega', precioVenta: 80 }),
      unidad({ id: 'e', type: 'Estacionamiento', precioVenta: 350 }),
    ];
    expect(sumarUF(us)).toBe(5430);
  });

  it('un precioVenta corrupto cuenta como 0 en vez de envenenar la suma', () => {
    const us = [
      unidad({ id: 'a', precioVenta: 100 }),
      unidad({ id: 'b', precioVenta: NaN as unknown as number }),
      unidad({ id: 'c', precioVenta: undefined as unknown as number }),
    ];
    expect(sumarUF(us)).toBe(100);
  });

  it('lista vacía suma 0', () => {
    expect(sumarUF([])).toBe(0);
  });
});

describe('contarPorEstado', () => {
  it('cuenta los tres tramos y sus agregados en una pasada', () => {
    const us = [
      unidad({ id: '1', estado: 'Disponible' }),
      unidad({ id: '2', estado: 'Reservado' }),
      unidad({ id: '3', estado: 'Promesado' }),
      unidad({ id: '4', estado: 'Escriturado' }),
      unidad({ id: '5', estado: 'Escriturado' }),
      unidad({ id: '6', estado: 'Libre Asignación' }),
    ];
    const c = contarPorEstado(us);
    expect(c).toMatchObject({
      disponible: 1, reservado: 1, promesado: 1, escriturado: 2,
      comprometido: 3, tomado: 4, total: 6,
    });
  });

  it('avance y pipeline no se solapan: escriturado ⊂ comprometido ⊂ tomado', () => {
    const c = contarPorEstado([
      unidad({ id: '1', estado: 'Reservado' }),
      unidad({ id: '2', estado: 'Promesado' }),
      unidad({ id: '3', estado: 'Escriturado' }),
    ]);
    expect(c.escriturado).toBeLessThanOrEqual(c.comprometido);
    expect(c.comprometido).toBeLessThanOrEqual(c.tomado);
    expect(c.tomado).toBe(c.reservado + c.promesado + c.escriturado);
  });
});

// ── parsearMonto / sumarPagado ───────────────────────────────────────────────
describe('parsearMonto', () => {
  it('formato chileno con miles y decimal', () => {
    expect(parsearMonto('1.234,5')).toBe(1234.5);
    expect(parsearMonto('1.234.567,89')).toBe(1234567.89);
  });

  it('solo coma decimal', () => {
    expect(parsearMonto('1234,5')).toBe(1234.5);
  });

  it('punto como miles solo cuando el patrón es de grupos de 3', () => {
    expect(parsearMonto('1.234')).toBe(1234);
    expect(parsearMonto('12.5')).toBe(12.5);   // decimal, no miles
  });

  it('tolera símbolos de moneda y espacios', () => {
    expect(parsearMonto(' UF 1.500,25 ')).toBe(1500.25);
    expect(parsearMonto('$2.000')).toBe(2000);
  });

  it('devuelve null en lo no parseable en vez de NaN', () => {
    for (const v of ['abc', '', '   ', '-', '.', ',', null, undefined, {}, [], NaN]) {
      expect(parsearMonto(v)).toBeNull();
    }
  });

  it('acepta números directos', () => {
    expect(parsearMonto(42)).toBe(42);
    expect(parsearMonto(0)).toBe(0);
    expect(parsearMonto(Infinity)).toBeNull();
  });
});

describe('sumarPagado', () => {
  it('suma solo lo válido y nunca devuelve NaN', () => {
    const plan = [
      cuota('1.234,5'),
      cuota('abc'),
      cuota(''),
      cuota(null),
      cuota(undefined),
      cuota(100),
    ];
    const total = sumarPagado(plan);
    expect(Number.isNaN(total)).toBe(false);
    expect(total).toBe(1334.5);
  });

  it('ignora las cuotas que no están pagadas', () => {
    const plan = [cuota('100', 'Pagado'), cuota('900', 'Pendiente'), cuota('50', 'Atrasado')];
    expect(sumarPagado(plan)).toBe(100);
  });

  it('un solo valor corrupto no rompe el total', () => {
    expect(sumarPagado([cuota('no es plata'), cuota('500')])).toBe(500);
  });

  it('plan vacío, null o undefined suman 0', () => {
    expect(sumarPagado([])).toBe(0);
    expect(sumarPagado(null)).toBe(0);
    expect(sumarPagado(undefined)).toBe(0);
  });
});

// ── Fechas ───────────────────────────────────────────────────────────────────
describe('parseFechaFlexible', () => {
  it('DD-MM-YYYY, el formato que escribe la UI', () => {
    const d = parseFechaFlexible('27-07-2026')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // julio
    expect(d.getDate()).toBe(27);
  });

  it('ISO completo, el formato que escribe el backend', () => {
    const d = parseFechaFlexible('2026-07-27T15:39:12.927Z')!;
    expect(d).toBeInstanceOf(Date);
    expect(isNaN(d.getTime())).toBe(false);
    expect(d.toISOString()).toBe('2026-07-27T15:39:12.927Z');
  });

  it('ISO solo-fecha se interpreta en hora local (no corre al mes anterior)', () => {
    const d = parseFechaFlexible('2026-07-01')!;
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(1);
    expect(bucketMes(d)).toBe('2026-07');
  });

  it('acepta DD/MM/YYYY', () => {
    const d = parseFechaFlexible('05/03/2025')!;
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(5);
  });

  it('devuelve null en lo ilegible', () => {
    for (const v of ['', '   ', 'basura', '27-07', 'ayer', null, undefined, '99-99-9999']) {
      expect(parseFechaFlexible(v as string)).toBeNull();
    }
  });

  it('rechaza fechas que JS haría rollover en silencio', () => {
    expect(parseFechaFlexible('31-02-2026')).toBeNull();
  });
});

describe('bucketMes', () => {
  it('devuelve YYYY-MM con mes de dos dígitos', () => {
    expect(bucketMes(new Date(2026, 0, 15))).toBe('2026-01');
    expect(bucketMes(new Date(2026, 11, 1))).toBe('2026-12');
  });

  it('una fecha ISO no genera un bucket basura', () => {
    const d = parseFechaFlexible('2026-07-27T15:39:12.927Z')!;
    expect(bucketMes(d)).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('enPeriodo', () => {
  const ahora = new Date(2026, 6, 27); // 27-jul-2026, Q3

  it('all acepta todo, incluso null', () => {
    expect(enPeriodo(null, 'all', ahora)).toBe(true);
    expect(enPeriodo(new Date(1999, 0, 1), 'all', ahora)).toBe(true);
  });

  it('una fecha ilegible (null) queda FUERA de cualquier período acotado', () => {
    expect(enPeriodo(null, 'month', ahora)).toBe(false);
    expect(enPeriodo(null, 'quarter', ahora)).toBe(false);
    expect(enPeriodo(null, 'year', ahora)).toBe(false);
  });

  it('mes, trimestre y año', () => {
    expect(enPeriodo(new Date(2026, 6, 1), 'month', ahora)).toBe(true);
    expect(enPeriodo(new Date(2026, 5, 30), 'month', ahora)).toBe(false);
    expect(enPeriodo(new Date(2026, 8, 30), 'quarter', ahora)).toBe(true);  // sep = Q3
    expect(enPeriodo(new Date(2026, 3, 1), 'quarter', ahora)).toBe(false);  // abr = Q2
    expect(enPeriodo(new Date(2026, 0, 1), 'year', ahora)).toBe(true);
    expect(enPeriodo(new Date(2025, 6, 27), 'year', ahora)).toBe(false);
  });
});

// ── Vínculos y estado efectivo ───────────────────────────────────────────────
describe('estadoEfectivoUnidad', () => {
  it('el cruce bodega/estacionamiento con el mismo número resuelve a su padre correcto', () => {
    const deptoA = unidad({ id: 'dA', numero: '101', estado: 'Escriturado', bodegas: ['12'] });
    const deptoB = unidad({ id: 'dB', numero: '102', estado: 'Reservado', estacionamientos: ['12'] });
    const bodega12 = unidad({ id: 'b12', numero: '12', type: 'Bodega', estado: 'Asignado' });
    const estac12 = unidad({ id: 'e12', numero: '12', type: 'Estacionamiento', estado: 'Asignado' });

    const idx = crearIndiceVinculos([deptoA, deptoB]);
    expect(estadoEfectivoUnidad(bodega12, idx)).toBe('Escriturado');
    expect(estadoEfectivoUnidad(estac12, idx)).toBe('Reservado');
    expect(departamentoPadre(bodega12, idx)?.id).toBe('dA');
    expect(departamentoPadre(estac12, idx)?.id).toBe('dB');
  });

  it('un departamento usa su propio estado', () => {
    const d = unidad({ estado: 'Promesado' });
    expect(estadoEfectivoUnidad(d, crearIndiceVinculos([d]))).toBe('Promesado');
  });

  it('una unidad vinculada hereda el estado y deja de ser invisible para los alcances', () => {
    const depto = unidad({ id: 'd', numero: '201', estado: 'Escriturado', bodegas: ['B-1'] });
    const bodega = unidad({ id: 'b', numero: 'B-1', type: 'Bodega', estado: 'Libre Asignación' });
    // Sin heredar, 'Libre Asignación' no entra en ningún alcance y la métrica queda en 0.
    expect(estaTomado(bodega.estado)).toBe(false);
    expect(estaTomado(estadoEfectivoUnidad(bodega, [depto]))).toBe(true);
  });

  it('una unidad sin padre queda como Disponible', () => {
    const huerfana = unidad({ id: 'h', numero: 'X-9', type: 'Bodega', estado: 'Libre Asignación' });
    expect(estadoEfectivoUnidad(huerfana, [])).toBe('Disponible');
  });

  it('acepta el índice ya construido o el arreglo de departamentos', () => {
    const depto = unidad({ id: 'd', numero: '301', estado: 'Reservado', estacionamientos: ['E-5'] });
    const estac = unidad({ id: 'e', numero: 'E-5', type: 'Estacionamiento', estado: 'Asignado' });
    expect(estadoEfectivoUnidad(estac, [depto])).toBe('Reservado');
    expect(estadoEfectivoUnidad(estac, crearIndiceVinculos([depto]))).toBe('Reservado');
  });
});

describe('fechaHitoUnidad', () => {
  it('usa la fecha del hito que corresponde al estado', () => {
    const esc = unidad({ estado: 'Escriturado', fechaEscritura: '10-05-2026', fechaPromesa: '01-01-2026' });
    expect(fechaHitoUnidad(esc, [])!.getMonth()).toBe(4); // mayo, no enero
    const prom = unidad({ estado: 'Promesado', fechaPromesa: '01-02-2026' });
    expect(fechaHitoUnidad(prom, [])!.getMonth()).toBe(1);
    const res = unidad({ estado: 'Reservado', fechaReserva: '15-03-2026' });
    expect(fechaHitoUnidad(res, [])!.getMonth()).toBe(2);
  });

  it('una unidad disponible no tiene hito', () => {
    expect(fechaHitoUnidad(unidad({ estado: 'Disponible' }), [])).toBeNull();
  });

  it('una bodega hereda la fecha del departamento padre', () => {
    const depto = unidad({ id: 'd', numero: '401', estado: 'Escriturado', fechaEscritura: '20-06-2026', bodegas: ['B-7'] });
    const bodega = unidad({ id: 'b', numero: 'B-7', type: 'Bodega', estado: 'Asignado' });
    const f = fechaHitoUnidad(bodega, [depto]);
    expect(f).not.toBeNull();
    expect(f!.getMonth()).toBe(5); // junio
  });
});

// ── Atribución ───────────────────────────────────────────────────────────────
describe('vendedorAtribuidoId', () => {
  const cliente = (over: Partial<Client> = {}): Client => ({
    id: 'c1', projectId: 'p1', tipoPersona: 'Natural', nombre: 'Cliente', rut: '1-9',
    email: '', telefono: '', estado: 'Activo', fechaRegistro: '01-01-2026',
    historial: [], documents: [], ...over,
  });

  it('la unidad con ejecutivoId A gana sobre el cliente con ejecutivoId B', () => {
    const u = unidad({ ejecutivoId: 'A' });
    expect(vendedorAtribuidoId(u, cliente({ ejecutivoId: 'B' }))).toBe('A');
  });

  it('reasignar el cliente no mueve la unidad', () => {
    const u = unidad({ ejecutivoId: 'A' });
    expect(vendedorAtribuidoId(u, cliente({ ejecutivoId: 'B' }))).toBe('A');
    // el cliente pasa a C: la atribución de la unidad no se mueve
    expect(vendedorAtribuidoId(u, cliente({ ejecutivoId: 'C' }))).toBe('A');
  });

  it('sin ejecutivoId cae a reservaVendedorId', () => {
    const u = unidad({ reservaVendedorId: 'R' });
    expect(vendedorAtribuidoId(u, cliente({ ejecutivoId: 'B' }))).toBe('R');
  });

  it("ignora el centinela 'system' y cae al fallback del cliente", () => {
    const u = unidad({ reservaVendedorId: 'system' });
    expect(vendedorAtribuidoId(u, cliente({ ejecutivoId: 'B' }))).toBe('B');
  });

  it('sin nada en la unidad usa el ejecutivo del cliente (datos viejos)', () => {
    expect(vendedorAtribuidoId(unidad(), cliente({ ejecutivoId: 'B' }))).toBe('B');
  });

  it('sin atribución posible devuelve undefined', () => {
    expect(vendedorAtribuidoId(unidad(), undefined)).toBeUndefined();
    expect(vendedorAtribuidoId(unidad(), cliente({ ejecutivoId: undefined }))).toBeUndefined();
  });
});
