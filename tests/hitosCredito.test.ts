import { describe, it, expect } from 'vitest';
import {
  aplicaCredito, limpiarCamposCredito, porcentajeFinanciamiento, validarOrdenCBR,
  CAMPOS_CREDITO, CAMPOS_CREDITO_NULOS, CAMPOS_CREDITO_CERO,
} from '../src/utils/hitosCredito';
import { RealEstateUnit } from '../src/types';

// Sección Hitos: forma de financiamiento (Contado/Financiamiento) y fechas CBR.
// El foco está en los bordes que deciden si se esconde o se borra un dato real.

const unidad = (over: Partial<RealEstateUnit> = {}): RealEstateUnit => ({
  id: 'u1', projectId: 'p1', numero: '101', type: 'Departamento', estado: 'Disponible',
  bodegas: [], estacionamientos: [],
  precioLista: 1000, precioVenta: 1000, pie: 0, bonoDescuento: 0, reservaMonto: 0,
  creditoHipotecario: 0, totalPagado: 0, saldoPorPagar: 0, planPagos: [], observaciones: '',
  ...over,
});

describe('aplicaCredito', () => {
  it("'Contado' oculta el bloque de crédito", () => {
    expect(aplicaCredito('Contado')).toBe(false);
  });

  it("'Financiamiento' lo muestra", () => {
    expect(aplicaCredito('Financiamiento')).toBe(true);
  });

  it('null/undefined lo muestra: son las unidades anteriores al campo, que pueden tener crédito ya cargado', () => {
    // Si el default fuera ocultar, una unidad con banco y monto cargados por carga masiva
    // dejaría de mostrarlos de un día para el otro sin que nadie declarara nada.
    expect(aplicaCredito(null)).toBe(true);
    expect(aplicaCredito(undefined)).toBe(true);
    expect(aplicaCredito('')).toBe(true);
  });
});

describe('limpiarCamposCredito', () => {
  const conCredito = unidad({
    banco: 'BCI',
    fechaSolicitudCredito: '2026-01-10',
    fechaAprobacionCredito: '2026-01-20',
    creditoHipotecario: 3500,
    plazoCreditoAnios: 20,
    tasaFinanciamiento: 4.5,
  });

  it('vacía todos los campos del bloque de crédito', () => {
    const out = limpiarCamposCredito(conCredito) as Record<string, unknown>;
    for (const campo of CAMPOS_CREDITO_NULOS) expect(out[campo]).toBeNull();
    // creditoHipotecario va a 0, no a null: su columna es NOT NULL DEFAULT 0 y un null
    // reventaría la constraint en el UPDATE.
    for (const campo of CAMPOS_CREDITO_CERO) expect(out[campo]).toBe(0);
    expect(CAMPOS_CREDITO).toHaveLength(6);
  });

  it('usa null y no undefined, para que el PATCH sí limpie la columna en la BD', () => {
    const out = limpiarCamposCredito(conCredito) as Record<string, unknown>;
    // undefined se omite en JSON.stringify: el campo no viajaría y la BD quedaría con el
    // dato viejo. Se verifica sobre el JSON serializado, que es lo que realmente se manda.
    const enviado = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
    for (const campo of CAMPOS_CREDITO) {
      expect(campo in enviado).toBe(true);
    }
    for (const campo of CAMPOS_CREDITO_NULOS) expect(enviado[campo]).toBeNull();
  });

  it('no toca las fechas del ciclo de venta ni las CBR', () => {
    const completa = unidad({
      ...conCredito,
      fechaReserva: '2025-11-01', fechaPromesa: '2025-12-01', fechaEscritura: '2026-02-01',
      fechaEntrega: '2026-03-01', fechaAlzamiento: '2026-03-15',
      fechaIngresoCBR: '2026-02-10', fechaInscripcionCBR: '2026-02-20',
    });
    const out = limpiarCamposCredito(completa);
    expect(out.fechaReserva).toBe('2025-11-01');
    expect(out.fechaPromesa).toBe('2025-12-01');
    expect(out.fechaEscritura).toBe('2026-02-01');
    expect(out.fechaEntrega).toBe('2026-03-01');
    expect(out.fechaAlzamiento).toBe('2026-03-15');
    expect(out.fechaIngresoCBR).toBe('2026-02-10');
    expect(out.fechaInscripcionCBR).toBe('2026-02-20');
  });

  it('no muta la unidad de entrada', () => {
    const copia = JSON.parse(JSON.stringify(conCredito));
    limpiarCamposCredito(conCredito);
    expect(JSON.parse(JSON.stringify(conCredito))).toEqual(copia);
  });
});

describe('porcentajeFinanciamiento', () => {
  it('con Financiamiento devuelve exactamente el creditoPct recibido', () => {
    // Espeja "Crédito Banco" sin recalcular: lo que entra es lo que sale, decimales incluidos.
    for (const pct of [0, 1, 33.3, 79.99, 80, 100]) {
      expect(porcentajeFinanciamiento('Financiamiento', pct)).toBe(pct);
    }
  });

  it('con forma no declarada (null) también lo devuelve: el bloque sigue visible', () => {
    expect(porcentajeFinanciamiento(null, 80)).toBe(80);
  });

  it('con Contado devuelve null: no hay financiamiento del que declarar un %', () => {
    expect(porcentajeFinanciamiento('Contado', 80)).toBeNull();
  });
});

describe('validarOrdenCBR', () => {
  const escritura = '2026-02-01';

  it('ambas vacías: nada que validar', () => {
    expect(validarOrdenCBR({ fechaEscritura: escritura })).toBeNull();
    expect(validarOrdenCBR({ fechaEscritura: escritura, fechaIngresoCBR: '', fechaInscripcionCBR: '' })).toBeNull();
  });

  it('solo ingreso, posterior a escritura: ok', () => {
    expect(validarOrdenCBR({ fechaEscritura: escritura, fechaIngresoCBR: '2026-02-05' })).toBeNull();
  });

  it('solo inscripción (sin ingreso): no hay contra qué comparar, ok', () => {
    // La inscripción se valida contra el ingreso; si el ingreso está vacío no se inventa
    // una comparación contra la escritura.
    expect(validarOrdenCBR({ fechaEscritura: escritura, fechaInscripcionCBR: '2026-01-01' })).toBeNull();
  });

  it('sin escritura registrada: el ingreso no tiene contra qué compararse, ok', () => {
    expect(validarOrdenCBR({ fechaIngresoCBR: '2020-01-01' })).toBeNull();
  });

  it('ambas en orden correcto: ok', () => {
    expect(validarOrdenCBR({
      fechaEscritura: escritura, fechaIngresoCBR: '2026-02-05', fechaInscripcionCBR: '2026-02-20',
    })).toBeNull();
  });

  it('ingreso anterior a escritura: rechaza señalando fechaIngresoCBR', () => {
    const r = validarOrdenCBR({ fechaEscritura: escritura, fechaIngresoCBR: '2026-01-31' });
    expect(r).not.toBeNull();
    expect(r?.campo).toBe('fechaIngresoCBR');
    expect(r?.mensaje).toContain('Escritura');
  });

  it('inscripción anterior al ingreso: rechaza señalando fechaInscripcionCBR', () => {
    const r = validarOrdenCBR({
      fechaEscritura: escritura, fechaIngresoCBR: '2026-02-10', fechaInscripcionCBR: '2026-02-09',
    });
    expect(r).not.toBeNull();
    expect(r?.campo).toBe('fechaInscripcionCBR');
    expect(r?.mensaje).toContain('ingreso');
  });

  it('fechas iguales: "no anterior" admite igual', () => {
    expect(validarOrdenCBR({
      fechaEscritura: escritura, fechaIngresoCBR: escritura, fechaInscripcionCBR: escritura,
    })).toBeNull();
  });

  it('con ambas violaciones a la vez, reporta primero la del ingreso', () => {
    // El error inline muestra un campo a la vez; el primero en la cadena es el que hay
    // que corregir para que la segunda comparación tenga sentido.
    const r = validarOrdenCBR({
      fechaEscritura: escritura, fechaIngresoCBR: '2026-01-20', fechaInscripcionCBR: '2026-01-10',
    });
    expect(r?.campo).toBe('fechaIngresoCBR');
  });
});
