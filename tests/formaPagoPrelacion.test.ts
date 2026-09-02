import { describe, it, expect } from 'vitest';
import {
  redistribuirPctReales, componentePlugForma, PROMESA_PCT_MIN, type RepartoPctReales,
} from '../src/utils/pricingUtils';

/**
 * Orden de prelación de la Distribución del Pago (cuadro financiero de UnitDetail):
 *
 *     Crédito Banco  >  Promesa (el "pie")  >  Cuotas  >  Escritura
 *
 * Al editar una componente, las que van ANTES en el orden no se mueven y las que van
 * DESPUÉS absorben la diferencia en proporción a lo que tenían. El certificador de 100%
 * de la UI (el chip "100% ✓" y el bloqueo del botón "Generar Cronograma de Pagos") sigue
 * dependiendo de que la suma cierre exacto, así que cada caso lo verifica.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const suma = (r: RepartoPctReales) => r2(r.promesaPct + r.cuotasPct + r.escrituraPct);
/** Invariante transversal: los cuatro componentes cierran el 100% al centésimo. */
const sumaCon = (r: RepartoPctReales, creditoPct: number) => r2(suma(r) + creditoPct);

type Args = Parameters<typeof redistribuirPctReales>[0];
const armar = (o: Partial<Args> = {}): RepartoPctReales => redistribuirPctReales({
  actual: { promesaPct: 3, cuotasPct: 11.33, escrituraPct: 5.67 },
  promesaActiva: true, cuotasActiva: true, escrituraActiva: true,
  creditoPct: 80,
  ...o,
});

describe('Prelación — secuencia de edición que describió el usuario', () => {
  // Punto de partida: Crédito 80 → disponible 20, repartido 3 / 11,33 / 5,67.
  const inicial: RepartoPctReales = { promesaPct: 3, cuotasPct: 11.33, escrituraPct: 5.67 };

  it('1) cambiar Promesa mueve Cuotas y Escritura en proporción', () => {
    const r = armar({ actual: { ...inicial, promesaPct: 8 }, fijada: 'promesa' });
    expect(r.promesaPct).toBe(8);
    // Los 12 restantes conservan la proporción 11,33 : 5,67 (≈ 2:1).
    expect(r.cuotasPct).toBe(8);
    expect(r.escrituraPct).toBe(4);
    expect(suma(r)).toBe(20);
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('2) acto seguido, cambiar Cuotas deja la Promesa intacta y solo ajusta Escritura', () => {
    const paso1 = armar({ actual: { ...inicial, promesaPct: 8 }, fijada: 'promesa' });
    const r = armar({ actual: { ...paso1, cuotasPct: 5 }, fijada: 'cuotas' });
    expect(r.promesaPct).toBe(8);        // anterior en el orden: NO se mueve
    expect(r.cuotasPct).toBe(5);
    expect(r.escrituraPct).toBe(7);      // 20 − 8 − 5, absorbe todo el cambio
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('3) volver a cambiar la Promesa recalcula de nuevo las dos posteriores en proporción', () => {
    const paso2: RepartoPctReales = { promesaPct: 8, cuotasPct: 5, escrituraPct: 7 };
    const r = armar({ actual: { ...paso2, promesaPct: 4 }, fijada: 'promesa' });
    expect(r.promesaPct).toBe(4);
    // 16 repartidos 5 : 7.
    expect(r.cuotasPct).toBe(6.67);
    expect(r.escrituraPct).toBe(9.33);
    expect(sumaCon(r, 80)).toBe(100);
  });

  /**
   * Escritura es la última del orden y NO tiene grados de libertad: su valor es la resta
   * `disponible − promesa − cuotas`. Por eso la UI la muestra derivada y de solo lectura
   * (componentePlugForma) en vez de aceptar un número y reemplazarlo en silencio.
   *
   * Los dos casos de abajo ya no se alcanzan tecleando, pero la función sigue siendo
   * total: `fijada: 'escritura'` cae en la misma rama general que editar Cuotas con
   * Escritura apagada, así que se deja documentado que converge al valor derivado —
   * venga el número de donde venga, por arriba o por abajo del espacio libre.
   */
  it('4) fijar Escritura converge al espacio libre y no mueve nada más (viniendo de arriba)', () => {
    const previo: RepartoPctReales = { promesaPct: 4, cuotasPct: 6.67, escrituraPct: 9.33 };
    const r = armar({ actual: { ...previo, escrituraPct: 50 }, fijada: 'escritura' });
    expect(r.promesaPct).toBe(4);        // intacta
    expect(r.cuotasPct).toBe(6.67);      // intacta
    expect(r.escrituraPct).toBe(9.33);   // el espacio libre, ni más ni menos
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('4b) …y también viniendo de abajo: nadie detrás puede tomar el saldo', () => {
    const previo: RepartoPctReales = { promesaPct: 4, cuotasPct: 6, escrituraPct: 10 };
    const r = armar({ actual: { ...previo, escrituraPct: 1 }, fijada: 'escritura' });
    expect(r.promesaPct).toBe(4);
    expect(r.cuotasPct).toBe(6);
    expect(r.escrituraPct).toBe(10);
    expect(sumaCon(r, 80)).toBe(100);
  });
});

describe('componentePlugForma — qué campo se muestra derivado', () => {
  /**
   * La componente plug es la que absorbe el saldo, así que se muestra de solo lectura.
   * Invariante de la UI: nunca las dos derivadas, y nunca las dos editables mientras haya
   * algo que repartir.
   */
  it('cubre las cuatro combinaciones de Cuotas × Escritura sin bono', () => {
    expect(componentePlugForma({ cuotasActiva: true, escrituraActiva: true, aplicaBonoPie: false }))
      .toBe('escritura');   // Escritura derivada, Cuotas editable
    expect(componentePlugForma({ cuotasActiva: false, escrituraActiva: true, aplicaBonoPie: false }))
      .toBe('escritura');   // Cuotas apagada: sigue siendo Escritura
    expect(componentePlugForma({ cuotasActiva: true, escrituraActiva: false, aplicaBonoPie: false }))
      .toBe('cuotas');      // Escritura apagada: el rol de plug pasa a Cuotas
    expect(componentePlugForma({ cuotasActiva: false, escrituraActiva: false, aplicaBonoPie: false }))
      .toBeNull();          // Nada que repartir; la UI ya muestra su propio error
  });

  it('con bono pie no hay derivada: los campos son pesos libres', () => {
    // Con Compra Segura los campos dejan de ser porcentajes reales y reajustarPctReales
    // hace short-circuit. Volver de solo lectura la Escritura ahí rompería el flujo.
    for (const cuotasActiva of [true, false]) {
      for (const escrituraActiva of [true, false]) {
        expect(componentePlugForma({ cuotasActiva, escrituraActiva, aplicaBonoPie: true })).toBeNull();
      }
    }
  });

  it('el plug siempre es una componente activa, nunca una apagada', () => {
    for (const cuotasActiva of [true, false]) {
      for (const escrituraActiva of [true, false]) {
        const plug = componentePlugForma({ cuotasActiva, escrituraActiva, aplicaBonoPie: false });
        if (plug === 'cuotas') expect(cuotasActiva).toBe(true);
        if (plug === 'escritura') expect(escrituraActiva).toBe(true);
      }
    }
  });
});

describe('Prelación — componentes apagadas', () => {
  it('editar Cuotas con Escritura apagada la clampea a disponible − promesa', () => {
    const r = armar({
      actual: { promesaPct: 3, cuotasPct: 5, escrituraPct: 0 },
      escrituraActiva: false, fijada: 'cuotas',
    });
    expect(r.promesaPct).toBe(3);
    expect(r.cuotasPct).toBe(17);        // 20 − 3: se lleva todo, no descuadra el 100%
    expect(r.escrituraPct).toBe(0);
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('editar Promesa con Cuotas apagada deja todo el resto a Escritura', () => {
    const r = armar({
      actual: { promesaPct: 6, cuotasPct: 0, escrituraPct: 14 },
      cuotasActiva: false, fijada: 'promesa',
    });
    expect(r.promesaPct).toBe(6);
    expect(r.cuotasPct).toBe(0);
    expect(r.escrituraPct).toBe(14);
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('editar Promesa con Cuotas y Escritura apagadas la fuerza a todo lo disponible', () => {
    const r = armar({
      actual: { promesaPct: 5, cuotasPct: 0, escrituraPct: 0 },
      cuotasActiva: false, escrituraActiva: false, fijada: 'promesa',
    });
    expect(r.promesaPct).toBe(20);
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('editar Escritura con la Promesa apagada solo mira lo que ocupan las Cuotas', () => {
    const r = armar({
      actual: { promesaPct: 0, cuotasPct: 12, escrituraPct: 99 },
      promesaActiva: false, fijada: 'escritura',
    });
    expect(r.promesaPct).toBe(0);
    expect(r.cuotasPct).toBe(12);        // anterior en el orden: intacta
    expect(r.escrituraPct).toBe(8);      // 20 − 12
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('editar Cuotas con la Promesa apagada le da todo el disponible menos Escritura', () => {
    const r = armar({
      actual: { promesaPct: 0, cuotasPct: 13, escrituraPct: 7 },
      promesaActiva: false, fijada: 'cuotas',
    });
    expect(r.promesaPct).toBe(0);
    expect(r.cuotasPct).toBe(13);
    expect(r.escrituraPct).toBe(7);
    expect(sumaCon(r, 80)).toBe(100);
  });
});

describe('Prelación — el piso de 3% de la Promesa se mantiene', () => {
  it('la Promesa no cae por debajo del piso cuando es la componente anterior', () => {
    const r = armar({
      actual: { promesaPct: 0.5, cuotasPct: 15, escrituraPct: 4.5 },
      fijada: 'cuotas',
    });
    expect(r.promesaPct).toBe(PROMESA_PCT_MIN);
    expect(sumaCon(r, 80)).toBe(100);
  });

  it('editar la Promesa por debajo del piso la sube al piso (la UI además lo rechaza)', () => {
    // handlePromesaChange rechaza el valor con error inline antes de llegar acá; esto es
    // la red de seguridad de la función pura, que nunca devuelve un reparto bajo el piso.
    const r = armar({ actual: { promesaPct: 1, cuotasPct: 11.33, escrituraPct: 5.67 }, fijada: 'promesa' });
    expect(r.promesaPct).toBe(PROMESA_PCT_MIN);
    expect(sumaCon(r, 80)).toBe(100);
  });
});

describe('Prelación — bordes del Crédito Banco', () => {
  it('crédito al 100% deja las tres en cero y el total sigue cerrando', () => {
    for (const fijada of ['promesa', 'cuotas', 'escritura'] as const) {
      const r = armar({ creditoPct: 100, fijada });
      expect(r).toEqual({ promesaPct: 0, cuotasPct: 0, escrituraPct: 0 });
      expect(sumaCon(r, 100)).toBe(100);
    }
  });

  it('crédito al 0% reparte los 100 puntos completos', () => {
    const r = armar({ creditoPct: 0, actual: { promesaPct: 10, cuotasPct: 60, escrituraPct: 30 }, fijada: 'promesa' });
    expect(r.promesaPct).toBe(10);
    expect(r.cuotasPct).toBe(60);
    expect(r.escrituraPct).toBe(30);
    expect(sumaCon(r, 0)).toBe(100);
  });

  it('cambiar el Crédito recalcula las tres activas en proporción (sin prelación)', () => {
    // El Crédito es el de mayor prelación y no se reparte: define el disponible. Al
    // cambiarlo no hay componente "fijada", así que todas se recalculan proporcionalmente,
    // que es el comportamiento anterior y se conserva tal cual.
    const r = armar({ creditoPct: 60, actual: { promesaPct: 3, cuotasPct: 11.33, escrituraPct: 5.67 } });
    expect(suma(r)).toBe(40);
    expect(sumaCon(r, 60)).toBe(100);
    // Se duplicó el disponible, así que cada una duplica su parte.
    expect(r.promesaPct).toBe(6);
    expect(r.cuotasPct).toBe(22.66);
    expect(r.escrituraPct).toBe(11.34);
  });

  it('el crédito que no deja espacio ni para el piso no rompe el cierre del 100%', () => {
    for (const fijada of ['promesa', 'cuotas', 'escritura'] as const) {
      const r = armar({ creditoPct: 98, fijada });
      expect(sumaCon(r, 98)).toBe(100);
    }
  });
});

describe('Prelación — idempotencia', () => {
  /**
   * La UI llama a esta función desde un useEffect que depende de los mismos valores que
   * escribe (la red de seguridad que normaliza los defaults y lo que carga una
   * cotización). Si f(f(x)) ≠ f(x), ese efecto cicla.
   */
  const CASOS: Array<Partial<Args>> = [
    { fijada: 'promesa' },
    { fijada: 'cuotas' },
    { fijada: 'escritura' },
    { fijada: 'promesa', actual: { promesaPct: 50, cuotasPct: 1, escrituraPct: 1 } },
    { fijada: 'cuotas', actual: { promesaPct: 3, cuotasPct: 99, escrituraPct: 1 } },
    { fijada: 'escritura', actual: { promesaPct: 3, cuotasPct: 5, escrituraPct: 99 } },
    { fijada: 'escritura', actual: { promesaPct: 3, cuotasPct: 5, escrituraPct: 0 } },
    { fijada: 'cuotas', escrituraActiva: false },
    { fijada: 'escritura', cuotasActiva: false },
    { fijada: 'promesa', cuotasActiva: false, escrituraActiva: false },
    { fijada: 'cuotas', promesaActiva: false },
    { fijada: 'promesa', creditoPct: 0 },
    { fijada: 'cuotas', creditoPct: 98 },
    { fijada: 'escritura', creditoPct: 100 },
    { fijada: 'promesa', actual: { promesaPct: 0, cuotasPct: 0, escrituraPct: 0 } },
  ];

  it('f(f(x)) === f(x) en todos los casos, con y sin componente fijada', () => {
    for (const caso of CASOS) {
      const uno = armar(caso);
      // Segunda pasada con la MISMA componente fijada…
      const dosFijada = armar({ ...caso, actual: uno });
      expect({ caso, r: dosFijada }).toEqual({ caso, r: uno });
      // …y la que dispara de verdad el useEffect de red de seguridad, sin fijada.
      const dosLibre = armar({ ...caso, actual: uno, fijada: undefined });
      expect({ caso, r: dosLibre }).toEqual({ caso, r: uno });
    }
  });

  it('todos los casos cierran el 100% junto con el crédito', () => {
    for (const caso of CASOS) {
      const creditoPct = caso.creditoPct ?? 80;
      const r = armar(caso);
      // Sin ninguna componente activa no hay nada que repartir: solo cierra si el crédito
      // se lleva el 100%, que no es el caso de esta batería.
      expect({ caso, total: sumaCon(r, creditoPct) }).toEqual({ caso, total: 100 });
    }
  });
});
