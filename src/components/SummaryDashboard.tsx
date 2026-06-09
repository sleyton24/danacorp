import React, { useState } from 'react';
import { RealEstateUnit } from '../types';
import { TrendingUp, Car, Package, DollarSign, Scale, Landmark, LayoutTemplate, ArrowUp } from 'lucide-react';

interface SummaryDashboardProps {
  units: RealEstateUnit[];
}

export const SummaryDashboard: React.FC<SummaryDashboardProps> = ({ units }) => {
  const [financingMetric, setFinancingMetric] = useState<'units' | 'volume'>('units');
  
  const deptos = units.filter(u => u.type === 'Departamento');
  const totalDeptos = deptos.length;

  const formatUF = (val: number) => {
      return val.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  const formatUFNoDec = (val: number) => {
      return val.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };
  
  const funnelData = [
    { label: 'Disponible', count: deptos.filter(u => u.estado === 'Disponible').length, color: 'bg-green-500' },
    { label: 'Reservado', count: deptos.filter(u => u.estado === 'Reservado').length, color: 'bg-yellow-500' },
    { label: 'Promesado', count: deptos.filter(u => u.estado === 'Promesado').length, color: 'bg-blue-500' },
    { label: 'Escriturado', count: deptos.filter(u => u.estado === 'Escriturado').length, color: 'bg-purple-500' },
  ];

  const isUnitSold = (status: string) => ['Reservado', 'Promesado', 'Escriturado'].includes(status);
  const soldDeptos = deptos.filter(u => isUnitSold(u.estado));
  const soldCount = soldDeptos.length;
  const soldPercentage = totalDeptos > 0 ? Math.round((soldCount / totalDeptos) * 100) : 0;

  const floors: number[] = Array.from(new Set<number>(deptos.map(u => u.piso || 0))).sort((a, b) => a - b);
  
  interface FloorStat {
    floor: number;
    total: number;
    sold: number;
    percent: number;
  }

  const floorData: FloorStat[] = floors.map(floor => {
      const unitsOnFloor = deptos.filter(u => (u.piso || 0) === floor);
      const soldOnFloor = unitsOnFloor.filter(u => isUnitSold(u.estado)).length;
      return {
          floor,
          total: unitsOnFloor.length,
          sold: soldOnFloor,
          percent: unitsOnFloor.length > 0 ? Math.round((soldOnFloor / unitsOnFloor.length) * 100) : 0
      };
  });
  
  const buildingFloors = [...floorData].sort((a, b) => b.floor - a.floor);

  interface TypeStat {
      label: string;
      total: number;
      sold: number;
      percent: number;
  }

  const typologyStatsRaw = deptos.reduce((acc, unit) => {
      const dorms = unit.dormitorios || 0;
      const baths = unit.banos || 0;
      const key = `${dorms} Dorm + ${baths} Baño${baths !== 1 ? 's' : ''}`;
      
      if (!acc[key]) {
          acc[key] = { label: key, total: 0, sold: 0, percent: 0 };
      }
      
      acc[key].total += 1;
      if (isUnitSold(unit.estado)) {
          acc[key].sold += 1;
      }
      
      return acc;
  }, {} as Record<string, TypeStat>);

  const typologyStats = (Object.values(typologyStatsRaw) as TypeStat[])
      .map((stat: TypeStat) => ({
          ...stat,
          percent: stat.total > 0 ? Math.round((stat.sold / stat.total) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total);

  const getEffectiveStatus = (unit: RealEstateUnit): string => {
    if (unit.type === 'Departamento') return unit.estado;
    const parent = deptos.find(d => d.estacionamientos.includes(unit.numero) || d.bodegas.includes(unit.numero));
    if (parent) return parent.estado;
    return 'Disponible';
  };

  const parkings = units.filter(u => u.type === 'Estacionamiento');
  const soldParkings = parkings.filter(u => isUnitSold(getEffectiveStatus(u))).length;
  const parkingPercent = parkings.length > 0 ? Math.round((soldParkings / parkings.length) * 100) : 0;

  const storages = units.filter(u => u.type === 'Bodega');
  const soldStorages = storages.filter(u => isUnitSold(getEffectiveStatus(u))).length;
  const storagePercent = storages.length > 0 ? Math.round((soldStorages / storages.length) * 100) : 0;

  const totalVentaEstimada = deptos.reduce((sum, u) => sum + Number(u.precioVenta), 0);
  const totalVentaReal = soldDeptos.reduce((sum, u) => sum + Number(u.precioVenta), 0);
  
  // Cálculo de Venta Recaudada (Sumatoria de cuotas pagadas en todo el inventario)
  const totalVentaRecaudada = units.reduce((total, unit) => {
      const unitPaid = (unit.planPagos || [])
          .filter(p => p.status === 'Pagado')
          .reduce((subtotal, p) => subtotal + Number(p.amount || 0), 0);
      return total + unitPaid;
  }, 0);

  const calculateAvgUfM2 = (statuses: string[]) => {
      const group = deptos.filter(u => statuses.includes(u.estado) && u.superficie && u.superficie > 0);
      if (group.length === 0) return 0;
      const totalUF = group.reduce((acc, u) => acc + Number(u.precioVenta), 0);
      const totalM2 = group.reduce((acc, u) => acc + (u.superficie || 0), 0);
      return totalM2 > 0 ? totalUF / totalM2 : 0;
  };

  const ufM2Stock = calculateAvgUfM2(['Disponible', 'Reservado']);
  const ufM2Sold = calculateAvgUfM2(['Promesado', 'Escriturado']);

  // Cálculo proporcional para barras UF/m2
  const maxUfM2 = Math.max(ufM2Stock, ufM2Sold) || 1;

  const financingRaw = soldDeptos.reduce((acc, unit) => {
      const bankName = unit.banco && unit.banco.trim() !== '' ? unit.banco.toUpperCase() : 'SIN INSTITUCIÓN';
      const price = Number(unit.precioVenta) || 0;
      if (!acc[bankName]) {
          acc[bankName] = { units: 0, volume: 0 };
      }
      acc[bankName].units += 1;
      acc[bankName].volume += price;
      return acc;
  }, {} as Record<string, { units: number, volume: number }>);

  let withBankTotal = 0;
  let noBankTotal = 0;
  const financingEntries = Object.entries(financingRaw) as [string, { units: number; volume: number }][];

  financingEntries.forEach(([name, data]) => {
      const value = financingMetric === 'units' ? data.units : data.volume;
      if (name === 'SIN INSTITUCIÓN') noBankTotal += value;
      else withBankTotal += value;
  });

  const grandTotalFinancing = withBankTotal + noBankTotal;
  const sortedBanks = financingEntries
    .filter(([name]) => name !== 'SIN INSTITUCIÓN')
    .sort((a, b) => b[1][financingMetric] - a[1][financingMetric]);

  const formatFinancingValue = (val: number) => {
      if (financingMetric === 'units') return val;
      return formatUF(val) + ' UF';
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Resumen del Proyecto</h2>
          <p className="text-gray-500 text-sm mt-1">Métricas clave de rendimiento comercial e inventario.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-center">
          {/* Card Avance de Venta */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 h-full">
             <div className="w-14 h-14 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                 <ArrowUp className="w-7 h-7" />
             </div>
             <div>
                 <p className="text-gray-500 text-xs font-bold uppercase tracking-tighter">Avance Venta</p>
                 <h3 className="text-xl font-bold text-gray-900">{soldPercentage}%</h3>
                 <p className="text-xs text-gray-400 mt-0.5">{soldCount} de {totalDeptos} u.</p>
             </div>
          </div>

          {/* Card Venta UF Acumulada - Actualizada con Venta Recaudada */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4 h-full">
             <div className="w-14 h-14 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
                 <DollarSign className="w-7 h-7" />
             </div>
             <div className="flex-1">
                 <p className="text-gray-500 text-xs font-bold">Venta UF Acumulada</p>
                 <h3 className="text-xl font-bold text-gray-900">{formatUF(totalVentaReal)}</h3>
                 <div className="mt-1 flex flex-col gap-0.5">
                    <p className="text-[10px] text-blue-600 font-black uppercase tracking-tight">Recaudado: {formatUF(totalVentaRecaudada)} UF</p>
                    <p className="text-[10px] text-gray-400 font-bold">Meta: {formatUF(totalVentaEstimada)} UF</p>
                 </div>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between h-full">
             <div className="flex justify-between items-start mb-2">
                 <div className="p-2 bg-gray-100 rounded-lg text-gray-600"><Car className="w-5 h-5"/></div>
                 <span className="text-2xl font-bold text-gray-900">{parkingPercent}%</span>
             </div>
             <div>
                 <p className="text-sm font-medium text-gray-700">Estacionamientos</p>
                 <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                     <div className="bg-gray-600 h-1.5 rounded-full" style={{ width: `${parkingPercent}%` }}></div>
                 </div>
                 <p className="text-xs text-gray-400 mt-1">{soldParkings} vendidos de {parkings.length}</p>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between h-full">
             <div className="flex justify-between items-start mb-2">
                 <div className="p-2 bg-orange-50 rounded-lg text-orange-600"><Package className="w-5 h-5"/></div>
                 <span className="text-2xl font-bold text-gray-900">{storagePercent}%</span>
             </div>
             <div>
                 <p className="text-sm font-medium text-gray-700">Bodegas</p>
                 <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                     <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${storagePercent}%` }}></div>
                 </div>
                 <p className="text-xs text-gray-400 mt-1">{soldStorages} vendidas de {storages.length}</p>
             </div>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                 <TrendingUp className="w-5 h-5 text-gray-400" /> Pipeline de Ventas
             </h3>
             <div className="space-y-4">
                 {funnelData.map((stage) => (
                     <div key={stage.label} className="relative">
                         <div className="flex justify-between text-sm mb-1 font-medium text-gray-700 relative z-10 px-2">
                             <span>{stage.label}</span>
                             <span>{stage.count} u.</span>
                         </div>
                         <div className="h-8 w-full bg-gray-50 rounded-lg overflow-hidden relative">
                             <div 
                                className={`h-full ${stage.color} opacity-20 absolute top-0 left-0`} 
                                style={{ width: `${totalDeptos > 0 ? (stage.count / totalDeptos * 100) : 0}%` }}
                             ></div>
                             <div className={`h-full w-1 ${stage.color} absolute top-0 left-0`}></div>
                         </div>
                     </div>
                 ))}
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                 <LayoutTemplate className="w-5 h-5 text-gray-400" /> Ventas por Tipología
             </h3>
             <div className="space-y-5 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                 {typologyStats.map((type) => (
                     <div key={type.label}>
                         <div className="flex justify-between items-center mb-1">
                             <span className="text-sm font-bold text-gray-700">{type.label}</span>
                             <span className="text-xs text-gray-500">{type.sold}/{type.total} ({type.percent}%)</span>
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
             <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                 <Scale className="w-5 h-5 text-gray-400" /> Valor UF/m²
             </h3>
             <div className="flex-1 flex flex-col justify-center space-y-8">
                 <div>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-medium text-gray-600">Oferta (Stock)</span>
                        <span className="text-2xl font-bold text-blue-600">{formatUF(ufM2Stock)}</span>
                    </div>
                    <div className="w-full bg-blue-100 h-2 rounded-full overflow-hidden">
                        <div 
                            className="bg-blue-500 h-full rounded-full transition-all duration-1000" 
                            style={{ width: `${(ufM2Stock / maxUfM2) * 100}%` }}
                        ></div>
                    </div>
                 </div>
                 <div>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-medium text-gray-600">Venta Cerrada</span>
                        <span className="text-2xl font-bold text-purple-600">{formatUF(ufM2Sold)}</span>
                    </div>
                    <div className="w-full bg-purple-100 h-2 rounded-full overflow-hidden">
                        <div 
                            className="bg-purple-500 h-full rounded-full transition-all duration-1000" 
                            style={{ width: `${(ufM2Sold / maxUfM2) * 100}%` }}
                        ></div>
                    </div>
                 </div>
             </div>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm flex flex-col">
             <h3 className="font-bold text-gray-800 mb-8 flex items-center gap-2">Ventas por Piso</h3>
             <div className="flex w-full justify-center gap-8">
                <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-16 h-3 bg-slate-600 rounded-t-sm mx-auto relative z-20"></div>
                    <div className="flex flex-col items-center">
                        {buildingFloors.map((data) => (
                            <div key={data.floor} className={`w-24 border-x-4 border-slate-400 bg-slate-100 relative z-10 flex flex-col items-center justify-center ${data.floor === 1 ? 'h-16 border-b-4 border-slate-500' : 'h-12 border-b border-slate-300'}`}>
                                <span className="absolute text-[10px] font-bold text-slate-500 bg-white/80 px-1 rounded bottom-0.5 right-0.5">P.{data.floor}</span>
                            </div>
                        ))}
                    </div>
                    <div className="w-28 h-2 bg-slate-600 rounded-sm mt-0 relative z-20"></div>
                </div>
                <div className="flex-1 flex flex-col pt-[4px]"> 
                    {buildingFloors.map((data) => (
                        <div key={data.floor} className={`flex items-center w-full ${data.floor === 1 ? 'h-16' : 'h-12'}`}>
                            <div className="w-8 h-[1px] bg-gray-300 flex-shrink-0 relative"></div>
                            <div className="flex-1 pl-2">
                                 <div className="flex justify-between items-center mb-0.5">
                                     <span className="text-xs font-bold text-gray-700">Piso {data.floor}</span>
                                     <span className="text-[10px] text-gray-400">{data.sold}/{data.total} ({data.percent}%)</span>
                                 </div>
                                 <div className="h-2 w-full bg-gray-100 rounded-r-md overflow-hidden">
                                     <div className="h-full bg-blue-600 rounded-r-md transition-all duration-700" style={{ width: `${data.percent}%` }}></div>
                                 </div>
                            </div>
                        </div>
                    ))}
                </div>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                    <Landmark className="w-5 h-5 text-gray-400" /> Ventas por Fuente de Financiamiento
                </h3>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button onClick={() => setFinancingMetric('units')} className={`px-2 py-1 text-xs font-bold rounded-md transition-all ${financingMetric === 'units' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}>Unidades</button>
                    <button onClick={() => setFinancingMetric('volume')} className={`px-2 py-1 text-xs font-bold rounded-md transition-all ${financingMetric === 'volume' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}>UF</button>
                </div>
             </div>
             <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
                <div className="flex-1 text-center border-r border-gray-100">
                    <div className="font-bold text-gray-900">{formatFinancingValue(withBankTotal)}</div>
                    <div className="text-[10px] text-gray-500 font-bold uppercase mt-1">Con Banco</div>
                </div>
                <div className="flex-1 text-center">
                    <div className="font-bold text-gray-900">{formatFinancingValue(noBankTotal)}</div>
                    <div className="text-[10px] text-gray-500 font-bold uppercase mt-1">Sin Institución</div>
                </div>
             </div>
             <div className="space-y-4 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                 {sortedBanks.map(([bankName, data]) => {
                     const value = financingMetric === 'units' ? data.units : data.volume;
                     return (
                         <div key={bankName} className="relative">
                             <div className="flex justify-between text-sm mb-1 font-medium text-gray-700 relative z-10"><span>{bankName}</span><span>{formatFinancingValue(value)}</span></div>
                             <div className="h-6 w-full bg-gray-50 rounded-md overflow-hidden relative">
                                 <div className="h-full bg-teal-500 opacity-20 absolute top-0 left-0" style={{ width: `${grandTotalFinancing > 0 ? (value / grandTotalFinancing * 100) : 0}%` }}></div>
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