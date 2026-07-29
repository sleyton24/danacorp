import React, { useState, useMemo } from 'react';
import { RealEstateUnit } from '../types';
import { TrendingUp, Car, Package, DollarSign, Scale, Landmark, LayoutTemplate, ArrowUp, FileSignature, Clock } from 'lucide-react';
import {
  esEscriturado, esComprometido, estaTomado,
  sumarUF, contarPorEstado, sumarPagado,
  crearIndiceVinculos, estadoEfectivoUnidad,
} from '../utils/analytics';

interface SummaryDashboardProps {
  units: RealEstateUnit[];
}

export const SummaryDashboard: React.FC<SummaryDashboardProps> = ({ units }) => {
  const [financingMetric, setFinancingMetric] = useState<'units' | 'volume'>('units');

  const formatUF = (val: number) =>
    val.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /**
   * Todos los valores derivados se calculan en un solo useMemo: son ~40 y antes se
   * recomputaban en cada render, incluso al tocar el toggle de Unidades/UF (que no
   * afecta a ninguno de ellos).
   *
   * El estado efectivo se resuelve UNA vez por unidad con el índice de vínculos: las
   * bodegas y estacionamientos nacen como 'Libre Asignación'/'Asignado', que no entran en
   * ningún alcance, así que sin heredar el estado del departamento sus UF quedarían fuera
   * de todas las sumas y el criterio "UF incluye todos los tipos" no se cumpliría.
   */
  const m = useMemo(() => {
    const deptos = units.filter(u => u.type === 'Departamento');
    const totalDeptos = deptos.length;
    const vinculos = crearIndiceVinculos(deptos);

    // Estado efectivo por unidad, resuelto una sola vez.
    const conEstado = units.map(u => ({ unit: u, efectivo: estadoEfectivoUnidad(u, vinculos) }));
    const porAlcance = (pred: (estado: string) => boolean) =>
      conEstado.filter(x => pred(x.efectivo)).map(x => x.unit);
    const porEstado = (estado: string) =>
      conEstado.filter(x => x.efectivo === estado).map(x => x.unit);

    const conteoDeptos = contarPorEstado(deptos);

    // ── Avance: solo escriturado. Las promesas se pueden resciliar, así que no son
    // avance; se muestran aparte como pipeline.
    const escrituradas = conteoDeptos.escriturado;
    const avancePct = totalDeptos > 0 ? Math.round((escrituradas / totalDeptos) * 100) : 0;

    // ── UF por tramo, sobre todos los tipos de unidad (vía estado efectivo).
    const ufEscriturada = sumarUF(porAlcance(esEscriturado));
    const ufPromesada = sumarUF(porEstado('Promesado'));
    const ufReservada = sumarUF(porEstado('Reservado'));

    // Recaudado: cuotas pagadas de todo el inventario, con montos saneados.
    const recaudado = units.reduce((total, u) => total + sumarPagado(u.planPagos), 0);

    // ── Estacionamientos y bodegas: alcance TOMADO sobre el estado efectivo.
    const estacionamientos = units.filter(u => u.type === 'Estacionamiento');
    const estacTomados = estacionamientos.filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos))).length;
    const estacPct = estacionamientos.length > 0 ? Math.round((estacTomados / estacionamientos.length) * 100) : 0;

    const bodegas = units.filter(u => u.type === 'Bodega');
    const bodegasTomadas = bodegas.filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos))).length;
    const bodegasPct = bodegas.length > 0 ? Math.round((bodegasTomadas / bodegas.length) * 100) : 0;

    // ── Embudo por estado (departamentos).
    const funnelData = [
      { label: 'Disponible', count: conteoDeptos.disponible, color: 'bg-green-500' },
      { label: 'Reservado', count: conteoDeptos.reservado, color: 'bg-yellow-500' },
      { label: 'Promesado', count: conteoDeptos.promesado, color: 'bg-blue-500' },
      { label: 'Escriturado', count: conteoDeptos.escriturado, color: 'bg-purple-500' },
    ];

    // ── Colocación por piso. Las unidades sin piso definido se EXCLUYEN: antes
    // `u.piso || 0` las colapsaba todas a un "P.0" indistinguible de un piso 0 real.
    const conPiso = deptos.filter(u => typeof u.piso === 'number' && Number.isFinite(u.piso));
    const sinPiso = totalDeptos - conPiso.length;
    // El tipo explícito en el Set es necesario: con la lib de TS de este proyecto,
    // Array.from(new Set(...)) degrada a unknown[] y el sort numérico no compila.
    const pisos: number[] = Array.from(new Set<number>(conPiso.map(u => u.piso as number)))
      .sort((a, b) => a - b);
    const floorData = pisos.map(piso => {
      const enPiso = conPiso.filter(u => u.piso === piso);
      const colocadas = enPiso.filter(u => estaTomado(u.estado)).length;
      return {
        floor: piso,
        total: enPiso.length,
        colocadas,
        percent: enPiso.length > 0 ? Math.round((colocadas / enPiso.length) * 100) : 0,
      };
    });
    const buildingFloors = [...floorData].sort((a, b) => b.floor - a.floor);

    // ── Colocación por tipología.
    interface TipologiaStat { label: string; total: number; colocadas: number }
    const typologyRaw = deptos.reduce((acc, unit) => {
      const dorms = unit.dormitorios || 0;
      const baths = unit.banos || 0;
      const key = `${dorms} Dorm + ${baths} Baño${baths !== 1 ? 's' : ''}`;
      if (!acc[key]) acc[key] = { label: key, total: 0, colocadas: 0 };
      acc[key].total += 1;
      if (estaTomado(unit.estado)) acc[key].colocadas += 1;
      return acc;
    }, {} as Record<string, TipologiaStat>);
    const typologyStats = (Object.values(typologyRaw) as TipologiaStat[])
      .map(s => ({ ...s, percent: s.total > 0 ? Math.round((s.colocadas / s.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    // ── UF/m²: stock = Disponible + Reservado (la reserva es revocable, sigue siendo
    // oferta potencial); cerrada = comprometido. Solo departamentos: la superficie de
    // bodegas y estacionamientos no es comparable.
    const promedioUfM2 = (pred: (estado: string) => boolean) => {
      const grupo = deptos.filter(u => pred(u.estado) && u.superficie && u.superficie > 0);
      if (grupo.length === 0) return 0;
      const totalM2 = grupo.reduce((acc, u) => acc + (u.superficie || 0), 0);
      return totalM2 > 0 ? sumarUF(grupo) / totalM2 : 0;
    };
    const ufM2Stock = promedioUfM2(e => e === 'Disponible' || e === 'Reservado');
    const ufM2Cerrada = promedioUfM2(esComprometido);

    // ── Financiamiento por banco: alcance COMPROMETIDO, que es donde el crédito está en
    // trámite o cursado. Restringirlo a escrituradas lo dejaría casi vacío.
    const financingRaw = deptos.filter(u => esComprometido(u.estado)).reduce((acc, unit) => {
      const banco = unit.banco && unit.banco.trim() !== '' ? unit.banco.toUpperCase() : 'SIN INSTITUCIÓN';
      const precio = Number(unit.precioVenta) || 0;
      if (!acc[banco]) acc[banco] = { units: 0, volume: 0 };
      acc[banco].units += 1;
      acc[banco].volume += precio;
      return acc;
    }, {} as Record<string, { units: number; volume: number }>);

    return {
      totalDeptos, escrituradas, avancePct,
      promesadas: conteoDeptos.promesado, reservadas: conteoDeptos.reservado,
      ufEscriturada, ufPromesada, ufReservada, recaudado,
      estacTomados, totalEstac: estacionamientos.length, estacPct,
      bodegasTomadas, totalBodegas: bodegas.length, bodegasPct,
      funnelData, buildingFloors, sinPiso, typologyStats,
      ufM2Stock, ufM2Cerrada, financingRaw,
    };
  }, [units]);

  // Depende del toggle, no de los datos: se queda fuera del memo de arriba.
  const financing = useMemo(() => {
    const entries = Object.entries(m.financingRaw) as [string, { units: number; volume: number }][];
    let withBank = 0;
    let noBank = 0;
    entries.forEach(([name, data]) => {
      const value = financingMetric === 'units' ? data.units : data.volume;
      if (name === 'SIN INSTITUCIÓN') noBank += value;
      else withBank += value;
    });
    return {
      withBank, noBank, grandTotal: withBank + noBank,
      sortedBanks: entries
        .filter(([name]) => name !== 'SIN INSTITUCIÓN')
        .sort((a, b) => b[1][financingMetric] - a[1][financingMetric]),
    };
  }, [m.financingRaw, financingMetric]);

  const maxUfM2 = Math.max(m.ufM2Stock, m.ufM2Cerrada) || 1;
  const formatFinancingValue = (val: number) =>
    financingMetric === 'units' ? String(val) : `${formatUF(val)} UF`;

  return (
    <div className="space-y-6 animate-fade-in pb-10">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Resumen del Proyecto</h2>
          <p className="text-gray-500 text-sm mt-1">Métricas clave de rendimiento comercial e inventario.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
          {/* Avance: solo escriturado */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 h-full">
             <div className="w-14 h-14 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                 <ArrowUp className="w-7 h-7" />
             </div>
             <div>
                 <p className="text-gray-500 text-xs font-bold uppercase tracking-tighter">Avance Venta</p>
                 <h3 className="text-xl font-bold text-gray-900">{m.avancePct}%</h3>
                 <p className="text-xs text-gray-400 mt-0.5">{m.escrituradas} de {m.totalDeptos} deptos escriturados</p>
             </div>
          </div>

          {/* UF escriturada + recaudado */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 h-full">
             <div className="w-14 h-14 rounded-xl bg-green-50 flex items-center justify-center text-green-600 shrink-0">
                 <DollarSign className="w-7 h-7" />
             </div>
             <div className="flex-1">
                 <p className="text-gray-500 text-xs font-bold">UF Escriturada</p>
                 <h3 className="text-xl font-bold text-gray-900">{formatUF(m.ufEscriturada)}</h3>
                 <div className="mt-1 flex flex-col gap-0.5">
                    <p className="text-[10px] text-blue-600 font-black uppercase tracking-tight">Recaudado: {formatUF(m.recaudado)} UF</p>
                    <p className="text-[10px] text-gray-400 font-bold">Incluye deptos, bodegas y estacionamientos</p>
                 </div>
             </div>
          </div>

          {/* Pipeline: promesado */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 h-full">
             <div className="w-14 h-14 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                 <FileSignature className="w-7 h-7" />
             </div>
             <div>
                 <p className="text-gray-500 text-xs font-bold uppercase tracking-tighter">Pipeline · Promesado</p>
                 <h3 className="text-xl font-bold text-gray-900">{formatUF(m.ufPromesada)} <span className="text-sm font-medium text-gray-400">UF</span></h3>
                 <p className="text-xs text-gray-400 mt-0.5">{m.promesadas} deptos · todos los tipos en UF</p>
             </div>
          </div>

          {/* Pipeline: reservado (revocable) */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 h-full">
             <div className="w-14 h-14 rounded-xl bg-yellow-50 flex items-center justify-center text-yellow-600 shrink-0">
                 <Clock className="w-7 h-7" />
             </div>
             <div>
                 <p className="text-gray-500 text-xs font-bold uppercase tracking-tighter">Pipeline · Reservado</p>
                 <h3 className="text-xl font-bold text-gray-900">{formatUF(m.ufReservada)} <span className="text-sm font-medium text-gray-400">UF</span></h3>
                 <p className="text-xs text-gray-400 mt-0.5">{m.reservadas} deptos · <span className="text-yellow-600 font-bold">revocable</span></p>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between h-full">
             <div className="flex justify-between items-start mb-2">
                 <div className="p-2 bg-gray-100 rounded-lg text-gray-600"><Car className="w-5 h-5"/></div>
                 <span className="text-2xl font-bold text-gray-900">{m.estacPct}%</span>
             </div>
             <div>
                 <p className="text-sm font-medium text-gray-700">Estacionamientos</p>
                 <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                     <div className="bg-gray-600 h-1.5 rounded-full" style={{ width: `${m.estacPct}%` }}></div>
                 </div>
                 <p className="text-xs text-gray-400 mt-1">{m.estacTomados} colocados de {m.totalEstac}</p>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between h-full">
             <div className="flex justify-between items-start mb-2">
                 <div className="p-2 bg-orange-50 rounded-lg text-orange-600"><Package className="w-5 h-5"/></div>
                 <span className="text-2xl font-bold text-gray-900">{m.bodegasPct}%</span>
             </div>
             <div>
                 <p className="text-sm font-medium text-gray-700">Bodegas</p>
                 <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                     <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${m.bodegasPct}%` }}></div>
                 </div>
                 <p className="text-xs text-gray-400 mt-1">{m.bodegasTomadas} colocadas de {m.totalBodegas}</p>
             </div>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
                 <TrendingUp className="w-5 h-5 text-gray-400" /> Pipeline de Ventas
             </h3>
             <p className="text-[11px] text-gray-400 mb-5">Departamentos por estado.</p>
             <div className="space-y-4">
                 {m.funnelData.map((stage) => (
                     <div key={stage.label} className="relative">
                         <div className="flex justify-between text-sm mb-1 font-medium text-gray-700 relative z-10 px-2">
                             <span>{stage.label}</span>
                             <span>{stage.count} u.</span>
                         </div>
                         <div className="h-8 w-full bg-gray-50 rounded-lg overflow-hidden relative">
                             <div
                                className={`h-full ${stage.color} opacity-20 absolute top-0 left-0`}
                                style={{ width: `${m.totalDeptos > 0 ? (stage.count / m.totalDeptos * 100) : 0}%` }}
                             ></div>
                             <div className={`h-full w-1 ${stage.color} absolute top-0 left-0`}></div>
                         </div>
                     </div>
                 ))}
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
                 <LayoutTemplate className="w-5 h-5 text-gray-400" /> Colocación por Tipología
             </h3>
             <p className="text-[11px] text-gray-400 mb-5">Colocada = reservada, promesada o escriturada.</p>
             <div className="space-y-5 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                 {m.typologyStats.map((type) => (
                     <div key={type.label}>
                         <div className="flex justify-between items-center mb-1">
                             <span className="text-sm font-bold text-gray-700">{type.label}</span>
                             <span className="text-xs text-gray-500">{type.colocadas}/{type.total} ({type.percent}%)</span>
                         </div>
                         <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                             <div
                                 className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                                 style={{ width: `${type.percent}%` }}
                             ></div>
                         </div>
                     </div>
                 ))}
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col">
             <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
                 <Scale className="w-5 h-5 text-gray-400" /> Valor UF/m²
             </h3>
             <p className="text-[11px] text-gray-400 mb-5">Por m² de departamento. Stock incluye disponible y reservado.</p>
             <div className="flex-1 flex flex-col justify-center space-y-8">
                 <div>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-medium text-gray-600">Oferta (Stock)</span>
                        <span className="text-2xl font-bold text-blue-600">{formatUF(m.ufM2Stock)}</span>
                    </div>
                    <div className="w-full bg-blue-100 h-2 rounded-full overflow-hidden">
                        <div
                            className="bg-blue-500 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${(m.ufM2Stock / maxUfM2) * 100}%` }}
                        ></div>
                    </div>
                 </div>
                 <div>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-medium text-gray-600">Venta Cerrada</span>
                        <span className="text-2xl font-bold text-purple-600">{formatUF(m.ufM2Cerrada)}</span>
                    </div>
                    <div className="w-full bg-purple-100 h-2 rounded-full overflow-hidden">
                        <div
                            className="bg-purple-500 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${(m.ufM2Cerrada / maxUfM2) * 100}%` }}
                        ></div>
                    </div>
                 </div>
             </div>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm flex flex-col">
             <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">Colocación por Piso</h3>
             <p className="text-[11px] text-gray-400 mb-8">Colocada = reservada, promesada o escriturada.</p>
             <div className="flex w-full justify-center gap-8">
                <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-16 h-3 bg-slate-600 rounded-t-sm mx-auto relative z-20"></div>
                    <div className="flex flex-col items-center">
                        {m.buildingFloors.map((data) => (
                            <div key={data.floor} className="w-24 h-12 border-x-4 border-slate-400 border-b border-slate-300 bg-slate-100 relative z-10 flex flex-col items-center justify-center">
                                <span className="absolute text-[10px] font-bold text-slate-500 bg-white/80 px-1 rounded bottom-0.5 right-0.5">P.{data.floor}</span>
                            </div>
                        ))}
                    </div>
                    <div className="w-28 h-2 bg-slate-600 rounded-sm mt-0 relative z-20"></div>
                </div>
                <div className="flex-1 flex flex-col pt-[4px]">
                    {m.buildingFloors.map((data) => (
                        <div key={data.floor} className="flex items-center w-full h-12">
                            <div className="w-8 h-[1px] bg-gray-300 flex-shrink-0 relative"></div>
                            <div className="flex-1 pl-2">
                                 <div className="flex justify-between items-center mb-0.5">
                                     <span className="text-xs font-bold text-gray-700">Piso {data.floor}</span>
                                     <span className="text-[10px] text-gray-400">{data.colocadas}/{data.total} ({data.percent}%)</span>
                                 </div>
                                 <div className="h-2 w-full bg-gray-100 rounded-r-md overflow-hidden">
                                     <div className="h-full bg-blue-600 rounded-r-md transition-all duration-700" style={{ width: `${data.percent}%` }}></div>
                                 </div>
                            </div>
                        </div>
                    ))}
                </div>
             </div>
             {m.sinPiso > 0 && (
                <p className="text-[11px] text-gray-400 mt-6 pt-4 border-t border-gray-100">
                  {m.sinPiso} departamento{m.sinPiso !== 1 ? 's' : ''} sin piso definido, excluido{m.sinPiso !== 1 ? 's' : ''} de este gráfico.
                </p>
             )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-gray-800 flex items-center gap-2">
                      <Landmark className="w-5 h-5 text-gray-400" /> Fuente de Financiamiento
                  </h3>
                  <p className="text-[11px] text-gray-400 mt-1">Departamentos promesados y escriturados.</p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-lg shrink-0">
                    <button onClick={() => setFinancingMetric('units')} className={`px-2 py-1 text-xs font-bold rounded-md transition-all ${financingMetric === 'units' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}>Unidades</button>
                    <button onClick={() => setFinancingMetric('volume')} className={`px-2 py-1 text-xs font-bold rounded-md transition-all ${financingMetric === 'volume' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}>UF</button>
                </div>
             </div>
             <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
                <div className="flex-1 text-center border-r border-gray-100">
                    <div className="font-bold text-gray-900">{formatFinancingValue(financing.withBank)}</div>
                    <div className="text-[10px] text-gray-500 font-bold uppercase mt-1">Con Banco</div>
                </div>
                <div className="flex-1 text-center">
                    <div className="font-bold text-gray-900">{formatFinancingValue(financing.noBank)}</div>
                    <div className="text-[10px] text-gray-500 font-bold uppercase mt-1">Sin Institución</div>
                </div>
             </div>
             <div className="space-y-4 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                 {financing.sortedBanks.map(([bankName, data]) => {
                     const value = financingMetric === 'units' ? data.units : data.volume;
                     return (
                         <div key={bankName} className="relative">
                             <div className="flex justify-between text-sm mb-1 font-medium text-gray-700 relative z-10"><span>{bankName}</span><span>{formatFinancingValue(value)}</span></div>
                             <div className="h-6 w-full bg-gray-50 rounded-md overflow-hidden relative">
                                 <div className="h-full bg-teal-500 opacity-20 absolute top-0 left-0" style={{ width: `${financing.grandTotal > 0 ? (value / financing.grandTotal * 100) : 0}%` }}></div>
                             </div>
                         </div>
                     );
                 })}
             </div>
          </div>
        </div>
      </div>
  );
};
