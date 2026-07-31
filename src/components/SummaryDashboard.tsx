import React, { useState, useMemo } from 'react';
import { RealEstateUnit } from '../types';
import { Car, Package } from 'lucide-react';
import {
  esComprometido, estaTomado, sumarUF, sumarPagado,
  crearIndiceVinculos, estadoEfectivoUnidad, fechaHitoUnidad, type Periodo,
} from '../utils/analytics';
import {
  CRUCE_VACIO, hayCruce, aplicarCruce, tipologia, delta,
  ventanaPeriodo, ventanaComparacion, enVentana, type CruceAnalitico, type Comparacion,
} from '../utils/analiticaFiltros';
import { TarjetaKpi } from './analitica/TarjetaKpi';
import { TablaDensa, type FilaDensa } from './analitica/TablaDensa';
import { Chips } from './analitica/Chips';
import { TablaUnidades } from './analitica/TablaUnidades';

interface SummaryDashboardProps {
  units: RealEstateUnit[];
  onSelectUnit?: (unit: RealEstateUnit) => void;
}

const ESTADOS = ['Disponible', 'Reservado', 'Promesado', 'Escriturado'] as const;
const COLOR_ESTADO: Record<string, string> = {
  Disponible: '#e5e7eb', Reservado: '#c7d2fe', Promesado: '#818cf8', Escriturado: '#4338ca',
};

const fmt = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt1 = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const SummaryDashboard: React.FC<SummaryDashboardProps> = ({ units, onSelectUnit }) => {
  const [cruce, setCruce] = useState<CruceAnalitico>(CRUCE_VACIO);
  const [periodo, setPeriodo] = useState<Periodo>('all');
  const [comparacion, setComparacion] = useState<Comparacion>('none');

  const vinculos = useMemo(() => crearIndiceVinculos(units.filter(u => u.type === 'Departamento')), [units]);
  const activoCruce = hayCruce(cruce);

  // ── Titular + barra segmentada: SIEMPRE el inventario completo del proyecto, ajeno al
  // cruce (igual que la leyenda) — es el "acumulado" que no se colapsa por selección.
  const inventario = useMemo(() => {
    const deptos = units.filter(u => u.type === 'Departamento');
    const disponibles = deptos.filter(u => u.estado === 'Disponible').length;
    const reservadas = deptos.filter(u => u.estado === 'Reservado').length;
    const promesadas = deptos.filter(u => u.estado === 'Promesado').length;
    const escrituradas = deptos.filter(u => u.estado === 'Escriturado').length;
    const totalDeptos = deptos.length;
    const avancePct = totalDeptos > 0 ? Math.round((escrituradas / totalDeptos) * 1000) / 10 : 0;
    const sinColocaciones = reservadas + promesadas + escrituradas === 0;
    const totalEstac = units.filter(u => u.type === 'Estacionamiento').length;
    const totalBod = units.filter(u => u.type === 'Bodega').length;
    return { deptos, disponibles, reservadas, promesadas, escrituradas, totalDeptos, avancePct, sinColocaciones, totalEstac, totalBod };
  }, [units]);

  // ── Selección: TODO el cruce aplicado (sin excepciones) — alimenta el resumen de
  // "Selección" y la tabla de unidades (nivel 3).
  const seleccion = useMemo(() => aplicarCruce(units, cruce, vinculos), [units, cruce, vinculos]);
  const ufSeleccion = useMemo(() => sumarUF(seleccion), [seleccion]);

  /**
   * Numerador para las tablas densas: con cruce activo, la selección (excluyendo del
   * filtro la clave que la propia tabla agrupa — si no, cruzar por piso colapsaría la
   * tabla de pisos al 100% en la fila activa, un dato vacío); sin cruce, la colocación
   * (reservado+promesado+escriturado).
   */
  const numeradorPara = (exceptoKey: keyof CruceAnalitico): RealEstateUnit[] =>
    activoCruce
      ? aplicarCruce(units, cruce, vinculos, exceptoKey)
      : units.filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos)));

  const notaTabla = activoCruce ? 'sel/tot · UF' : 'col/tot · UF';

  const filasPiso: FilaDensa[] = useMemo(() => {
    const num = numeradorPara('piso').filter(u => u.type === 'Departamento');
    const conPiso = inventario.deptos.filter(u => typeof u.piso === 'number');
    const pisos = Array.from(new Set<number>(conPiso.map(u => u.piso as number))).sort((a, b) => b - a);
    return pisos.map(p => {
      const denom = conPiso.filter(u => u.piso === p);
      const sel = num.filter(u => u.piso === p);
      return {
        key: String(p), label: `Piso ${p}`, total: denom.length, colocadas: sel.length,
        pct: denom.length ? Math.round((sel.length / denom.length) * 100) : 0, uf: sumarUF(sel),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, cruce, vinculos, inventario.deptos, activoCruce]);

  const filasTipologia: FilaDensa[] = useMemo(() => {
    const num = numeradorPara('tipologia').filter(u => u.type === 'Departamento');
    const tipos = Array.from(new Set(inventario.deptos.map(tipologia))).sort();
    return tipos
      .map(t => {
        const denom = inventario.deptos.filter(u => tipologia(u) === t);
        const sel = num.filter(u => tipologia(u) === t);
        return {
          key: t, label: t, total: denom.length, colocadas: sel.length,
          pct: denom.length ? Math.round((sel.length / denom.length) * 100) : 0, uf: sumarUF(sel),
        };
      })
      .sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, cruce, vinculos, inventario.deptos, activoCruce]);

  const filasBanco: FilaDensa[] = useMemo(() => {
    const conBanco = numeradorPara('banco').filter(u => u.banco);
    const bancos = Array.from(new Set(conBanco.map(u => u.banco as string)));
    const ufTotal = sumarUF(conBanco);
    return bancos
      .map(b => {
        const deB = conBanco.filter(u => u.banco === b);
        const uf = sumarUF(deB);
        return { key: b, label: b, total: deB.length, colocadas: deB.length, sinTotal: true, uf, pct: ufTotal ? Math.round((uf / ufTotal) * 100) : 0 };
      })
      .sort((a, b) => b.uf - a.uf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, cruce, vinculos, activoCruce]);

  // ── Bloque de flujo (Fase 3): SOLO esto reacciona al período; el titular de arriba es
  // acumulado y no depende de él. Con comparación de período anterior / año anterior.
  const flujo = useMemo(() => {
    const ahora = new Date();
    const ventana = ventanaPeriodo(periodo, 0, ahora);
    const ventanaPrev = ventanaComparacion(periodo, comparacion, ahora);
    const enVentanaActual = units.filter(u => enVentana(fechaHitoUnidad(u, vinculos), ventana));
    const actual = aplicarCruce(enVentanaActual, cruce, vinculos).filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos)));
    let previo: RealEstateUnit[] | null = null;
    if (ventanaPrev) {
      const enVentanaPrevia = units.filter(u => enVentana(fechaHitoUnidad(u, vinculos), ventanaPrev));
      previo = aplicarCruce(enVentanaPrevia, cruce, vinculos).filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos)));
    }
    return {
      unidades: actual.length, uf: sumarUF(actual),
      unidadesPrev: previo ? previo.length : null, ufPrev: previo ? sumarUF(previo) : null,
    };
  }, [units, cruce, vinculos, periodo, comparacion]);

  // ── UF/m² y estacionamientos/bodegas: métricas de "stock" del proyecto completo, ajenas
  // al cruce (igual criterio que el titular).
  const stock = useMemo(() => {
    const ufM2 = (pred: (estado: string) => boolean) => {
      const grupo = inventario.deptos.filter(u => pred(u.estado) && u.superficie && u.superficie > 0);
      if (grupo.length === 0) return 0;
      const m2 = grupo.reduce((a, u) => a + (u.superficie || 0), 0);
      return m2 > 0 ? sumarUF(grupo) / m2 : 0;
    };
    const estac = units.filter(u => u.type === 'Estacionamiento');
    const estacTomados = estac.filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos))).length;
    const bod = units.filter(u => u.type === 'Bodega');
    const bodTomadas = bod.filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos))).length;
    return {
      ufM2Stock: ufM2(e => e === 'Disponible' || e === 'Reservado'),
      ufM2Cerrada: ufM2(esComprometido),
      estacTomados, totalEstac: estac.length,
      bodTomadas, totalBod: bod.length,
      estacEnSeleccion: seleccion.filter(u => u.type === 'Estacionamiento').length,
      bodEnSeleccion: seleccion.filter(u => u.type === 'Bodega').length,
      recaudado: seleccion.reduce((a, u) => a + sumarPagado(u.planPagos), 0),
      ufEscriturada: sumarUF(seleccion.filter(u => estadoEfectivoUnidad(u, vinculos) === 'Escriturado')),
      ufPipeline: sumarUF(seleccion.filter(u => ['Promesado', 'Reservado'].includes(estadoEfectivoUnidad(u, vinculos)))),
    };
  }, [units, vinculos, seleccion]);

  const toggleCruce = (key: keyof CruceAnalitico, valor: string | number) => {
    setCruce(prev => ({ ...prev, [key]: prev[key] === valor ? null : valor }));
  };
  const limpiarCruce = (key: keyof CruceAnalitico) => setCruce(prev => ({ ...prev, [key]: null }));
  const limpiarTodo = () => setCruce(CRUCE_VACIO);

  const totalBarra = inventario.totalDeptos;
  const etiquetaPeriodo: Record<Periodo, string> = { all: 'todo el tiempo', month: 'este mes', quarter: 'este trimestre', year: 'este año' };
  const deltaUnidades = flujo.unidadesPrev !== null ? delta(flujo.unidades, flujo.unidadesPrev) : null;
  const deltaUf = flujo.ufPrev !== null ? delta(flujo.uf, flujo.ufPrev) : null;

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Resumen del Proyecto</h2>
        <p className="text-gray-500 text-sm mt-1">Avance de venta, distribución del inventario y detalle por selección.</p>
      </div>

      {/* Nivel 1 — Titular */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm text-gray-500">Avance de venta</span>
          <span className="text-xs text-gray-400">{inventario.totalDeptos} deptos</span>
        </div>
        {inventario.sinColocaciones ? (
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-5 mb-4">
            <span className="text-3xl font-bold text-gray-400 leading-none">Sin colocaciones</span>
            <div className="text-sm text-gray-600 leading-tight">
              {inventario.disponibles} departamentos disponibles
              <br /><span className="text-gray-400">{inventario.totalEstac} estacionamientos · {inventario.totalBod} bodegas</span>
            </div>
            <p className="text-[11px] text-gray-400 sm:ml-auto sm:max-w-[220px]">
              El avance aparece con la primera unidad reservada. El inventario ya está cargado.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-5 mb-4">
            <span className="text-5xl font-bold text-gray-900 leading-none font-mono tabular-nums">{fmt1(inventario.avancePct)}%</span>
            <div className="text-sm text-gray-600 leading-tight">
              {inventario.escrituradas} escriturados
              <br /><span className="text-gray-400">{inventario.promesadas + inventario.reservadas} en pipeline</span>
            </div>
            <div className="sm:ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">acumulado</p>
              <p className="text-[11px] text-gray-400">no depende del período</p>
            </div>
          </div>
        )}

        {/* Barra segmentada + leyenda */}
        <div className="flex h-4 rounded-lg overflow-hidden bg-gray-100">
          {ESTADOS.map(e => {
            const n = e === 'Disponible' ? inventario.disponibles : e === 'Reservado' ? inventario.reservadas
              : e === 'Promesado' ? inventario.promesadas : inventario.escrituradas;
            const w = totalBarra ? (n / totalBarra) * 100 : 0;
            const activo = cruce.estado === e;
            return (
              <button
                key={e} title={`${e}: ${n} deptos`} disabled={n === 0}
                onClick={() => toggleCruce('estado', e)}
                style={{ width: `${w}%`, backgroundColor: COLOR_ESTADO[e], outline: activo ? '2px solid #312e81' : 'none', outlineOffset: '-2px' }}
                className="h-full transition-all hover:brightness-95 disabled:cursor-default"
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          {ESTADOS.map(e => {
            const n = e === 'Disponible' ? inventario.disponibles : e === 'Reservado' ? inventario.reservadas
              : e === 'Promesado' ? inventario.promesadas : inventario.escrituradas;
            const activo = cruce.estado === e;
            if (n === 0) {
              return (
                <span key={e} title="Sin unidades en este estado" className="flex items-center gap-1.5 text-xs text-gray-300 cursor-default">
                  <span className="w-2 h-2 rounded-sm inline-block bg-gray-200" />{e} 0
                </span>
              );
            }
            return (
              <button key={e} onClick={() => toggleCruce('estado', e)} className={`flex items-center gap-1.5 text-xs hover:text-indigo-800 ${activo ? 'font-bold text-indigo-900' : 'text-gray-600'}`}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: COLOR_ESTADO[e] }} />{e} {n}
              </button>
            );
          })}
        </div>

        {activoCruce && (
          <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Selección</span>
            <span className="text-sm text-gray-700"><b className="font-mono">{seleccion.length}</b> unidades</span>
            <span className="text-sm text-gray-700"><b className="font-mono">{fmt(ufSeleccion)}</b> UF</span>
          </div>
        )}
      </div>

      {/* Chips del cruce */}
      <Chips cruce={cruce} onClear={limpiarCruce} onClearAll={limpiarTodo} />

      {/* Bloque de flujo + comparación (Fase 3) */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Período</label>
              <select value={periodo} onChange={e => { setPeriodo(e.target.value as Periodo); if (e.target.value === 'all') setComparacion('none'); }}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100">
                <option value="all">Todo el tiempo</option>
                <option value="month">Este mes</option>
                <option value="quarter">Este trimestre</option>
                <option value="year">Este año</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Comparar contra</label>
              <select value={comparacion} disabled={periodo === 'all'} onChange={e => setComparacion(e.target.value as Comparacion)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-40">
                <option value="none">Sin comparación</option>
                <option value="prev">Período anterior</option>
                <option value="yoy">Mismo período, año anterior</option>
              </select>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Colocado en el período</p>
            <p className="text-[11px] text-gray-400">{etiquetaPeriodo[periodo]} · flujo, no acumulado</p>
          </div>
          {inventario.sinColocaciones ? (
            <span className="text-[11px] text-gray-400 max-w-[280px]">Sin hitos registrados: la comparación de períodos no tiene con qué contrastar todavía.</span>
          ) : (
            <div className="flex items-baseline gap-6">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900 font-mono">{flujo.unidades}</span>
                <span className="text-xs text-gray-500">unidades</span>
                {deltaUnidades && <span className={`text-[11px] font-bold ${deltaUnidades.direccion === 'up' ? 'text-green-600' : deltaUnidades.direccion === 'down' ? 'text-red-600' : 'text-gray-400'}`}>{deltaUnidades.texto}</span>}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900 font-mono">{fmt(flujo.uf)}</span>
                <span className="text-xs text-gray-500">UF</span>
                {deltaUf && <span className={`text-[11px] font-bold ${deltaUf.direccion === 'up' ? 'text-green-600' : deltaUf.direccion === 'down' ? 'text-red-600' : 'text-gray-400'}`}>{deltaUf.texto}</span>}
              </div>
              {periodo === 'all' && <span className="text-[11px] text-gray-400">elegí un período para comparar</span>}
            </div>
          )}
        </div>
      </div>

      {/* Nivel 2 — tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TarjetaKpi label="UF escriturada" valor={fmt(stock.ufEscriturada)} sub="acumulado, todos los tipos" />
        <TarjetaKpi label="Pipeline UF" valor={fmt(stock.ufPipeline)} sub="promesado + reservado" />
        <TarjetaKpi label="Recaudado" valor={fmt(stock.recaudado)} sub="cuotas pagadas" />
        <TarjetaKpi label="UF/m² cerrada" valor={fmt1(stock.ufM2Cerrada)} sub={`stock ${fmt1(stock.ufM2Stock)}`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
          <div className="flex justify-between items-baseline">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> Estacionamientos</p>
            <span className="text-sm font-bold font-mono">{stock.totalEstac ? Math.round((stock.estacTomados / stock.totalEstac) * 100) : 0}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-gray-600 rounded-full" style={{ width: `${stock.totalEstac ? (stock.estacTomados / stock.totalEstac) * 100 : 0}%` }} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {stock.estacTomados} colocados de {stock.totalEstac}
            {activoCruce && <span className="text-indigo-700 font-bold"> · {stock.estacEnSeleccion} en la selección</span>}
          </p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
          <div className="flex justify-between items-baseline">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Bodegas</p>
            <span className="text-sm font-bold font-mono">{stock.totalBod ? Math.round((stock.bodTomadas / stock.totalBod) * 100) : 0}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full" style={{ width: `${stock.totalBod ? (stock.bodTomadas / stock.totalBod) * 100 : 0}%` }} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {stock.bodTomadas} colocadas de {stock.totalBod}
            {activoCruce && <span className="text-indigo-700 font-bold"> · {stock.bodEnSeleccion} en la selección</span>}
          </p>
        </div>
      </div>

      {/* Nivel 2 — consola de tablas densas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <TablaDensa
          titulo={activoCruce ? 'Selección por piso' : 'Colocación por piso'}
          filas={filasPiso} nota={notaTabla}
          activoKey={k => cruce.piso !== null && String(cruce.piso) === k}
          onClickFila={k => toggleCruce('piso', Number(k))}
        />
        <TablaDensa
          titulo={activoCruce ? 'Selección por tipología' : 'Colocación por tipología'}
          filas={filasTipologia} nota={notaTabla}
          activoKey={k => cruce.tipologia === k}
          onClickFila={k => toggleCruce('tipologia', k)}
        />
        <TablaDensa
          titulo="Financiamiento" filas={filasBanco} nota="unid · % UF · UF"
          vacio="Aparece cuando haya unidades promesadas o escrituradas con banco asignado."
          activoKey={k => cruce.banco === k}
          onClickFila={k => toggleCruce('banco', k)}
        />
      </div>

      {/* Nivel 3 — unidades de la selección */}
      <TablaUnidades units={seleccion} onSelectUnit={onSelectUnit} />
    </div>
  );
};
