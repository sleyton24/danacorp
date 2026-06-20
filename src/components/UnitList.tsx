import React, { useState, useMemo } from 'react';
import { RealEstateUnit, Client, User } from '../types';
import {
  Search, Home, LayoutGrid, Car, Package, List,
  Layers, Bed, Bath, Ruler, Filter, ChevronRight, User as UserIcon, Link as LinkIcon, X, Compass, Unlock
} from 'lucide-react';

interface UnitListProps {
  units: RealEstateUnit[];
  clients: Client[];
  currentUser?: User;
  onSelectUnit: (unit: RealEstateUnit) => void;
  onReleaseUnit?: (unitId: string) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

export const UnitList: React.FC<UnitListProps> = ({ units, clients, currentUser, onSelectUnit, onReleaseUnit, showToast }) => {
  const [filterType, setFilterType] = useState<string>('Todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  // Estados de filtros avanzados (Igual que en Lista de Precios)
  const [filterOrientacion, setFilterOrientacion] = useState('');
  const [filterPiso, setFilterPiso] = useState('');
  const [filterDormitorios, setFilterDormitorios] = useState('');
  const [filterBanos, setFilterBanos] = useState('');

  // Memorización de valores únicos para filtros
  // Fix: Added explicit types to sort parameters to avoid arithmetic operation errors on inferred unknown types
  const uniqueFloors = useMemo(() => Array.from(new Set(units.map(u => u.piso).filter((v): v is number => typeof v === 'number'))).sort((a: number, b: number) => a - b), [units]);
  const uniqueDorms = useMemo(() => Array.from(new Set(units.map(u => u.dormitorios).filter((v): v is number => typeof v === 'number'))).sort((a: number, b: number) => a - b), [units]);
  const uniqueBaths = useMemo(() => Array.from(new Set(units.map(u => u.banos).filter((v): v is number => typeof v === 'number'))).sort((a: number, b: number) => a - b), [units]);
  const uniqueOrientations = useMemo(() => Array.from(new Set(units.filter(u => u.orientacion).map(u => u.orientacion))).sort(), [units]);

  const getUnitOwner = (unit: RealEstateUnit): Client | undefined => {
    if (unit.clienteId) return clients.find(c => c.id === unit.clienteId);
    if (unit.type !== 'Departamento') {
      const parent = units.find(u =>
        u.type === 'Departamento' &&
        (u.estacionamientos?.includes(unit.numero) ||
         u.bodegas?.includes(unit.numero))
      );
      if (parent?.clienteId) return clients.find(c => c.id === parent.clienteId);
    }
    return undefined;
  };

  /**
   * Lógica Centralizada de Estado
   * Sincroniza el estado de unidades secundarias con su departamento padre.
   * Reemplaza 'Libre Asignación' por 'Disponible'.
   */
  const getEffectiveStatus = (unit: RealEstateUnit): string => {
    if (unit.type === 'Departamento') return unit.estado;
    
    const parent = units.find(u => 
        u.type === 'Departamento' && 
        (u.estacionamientos.includes(unit.numero) || u.bodegas.includes(unit.numero))
    );
    
    if (parent) return parent.estado;
    
    return 'Disponible';
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'Disponible': return 'bg-green-100 text-green-800 border border-green-200';
      case 'Reservado': return 'bg-yellow-100 text-yellow-800';
      case 'Promesado': return 'bg-blue-100 text-blue-800';
      case 'Escriturado': return 'bg-purple-100 text-purple-800';
      case 'Asignado': return 'bg-gray-100 text-gray-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getUnitIcon = (type: string) => {
    switch(type) {
        case 'Bodega': return <Package className="w-5 h-5" />;
        case 'Estacionamiento': return <Car className="w-5 h-5" />;
        default: return <Home className="w-5 h-5" />;
    }
  };

  const getUnitAsociados = (unit: RealEstateUnit) => {
      const parentDepto = units.find(u => 
        u.type === 'Departamento' && 
        (u.estacionamientos.includes(unit.numero) || u.bodegas.includes(unit.numero))
      );

      if (unit.type === 'Departamento') {
          return (
              <div className="flex flex-wrap gap-1">
                  {unit.estacionamientos.map(e => (
                    <span key={e} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-black border border-gray-100 dark:border-gray-600">
                        <Car className="w-3 h-3 text-gray-600" />{e}
                    </span>
                  ))}
                  {unit.bodegas.map(b => (
                    <span key={b} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-black border border-gray-100 dark:border-gray-600">
                        <Package className="w-3 h-3 text-orange-600" />{b}
                    </span>
                  ))}
                  {unit.estacionamientos.length === 0 && unit.bodegas.length === 0 && <span className="text-gray-300">-</span>}
              </div>
          );
      }
      
      return parentDepto ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-[10px] font-black border border-blue-100 dark:border-blue-800">
              <Home className="w-3 h-3 text-blue-600" />{parentDepto.numero}
          </span>
      ) : <span className="text-gray-400 text-[10px] italic font-bold">Disponible</span>;
  };

  const getUnitAttributes = (unit: RealEstateUnit) => {
      if (unit.type === 'Departamento') {
          return (
              <div className="flex gap-2 items-center text-gray-600">
                  <span className="font-bold">{unit.dormitorios || 0}D</span>
                  <span className="text-gray-300">|</span>
                  <span className="font-bold">{unit.banos || 0}B</span>
                  <span className="text-gray-300">|</span>
                  <span>{unit.superficie || 0} m²</span>
              </div>
          );
      }
      if (unit.type === 'Estacionamiento') {
          const isTandem = unit.observaciones?.toLowerCase().includes('tandem') || unit.numero.toLowerCase().endsWith('t');
          return <span className="font-bold text-gray-600">{isTandem ? 'Tandem' : 'Single'}</span>;
      }
      if (unit.type === 'Bodega') {
          return <span className="font-bold text-gray-600">{unit.superficie || 0} m²</span>;
      }
      return '-';
  };

  const now = new Date().toISOString();

  const isReservadaOtroVendedor = (unit: RealEstateUnit): boolean =>
    unit.estado === 'Reservado' &&
    !!unit.reservaVendedorId &&
    unit.reservaVendedorId !== currentUser?.id;

  const handleLiberar = async (unitId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tok = localStorage.getItem('dw_token');
    if (!tok) return;
    try {
      const res = await fetch(`/api/units/${unitId}/liberar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        onReleaseUnit?.(unitId);
        showToast?.('Unidad liberada', 'success');
      } else {
        showToast?.('Error al liberar la unidad', 'error');
      }
    } catch {
      showToast?.('Error al liberar la unidad', 'error');
    }
  };

  const clearFilters = () => {
    setFilterOrientacion('');
    setFilterPiso('');
    setFilterDormitorios('');
    setFilterBanos('');
    setSearchTerm('');
  };

  const hasActiveFilters = filterOrientacion || filterPiso || filterDormitorios || filterBanos || searchTerm;

  const filteredUnits = useMemo(() => {
      const statusWeight: Record<string, number> = { 'Disponible': 1, 'Reservado': 2, 'Promesado': 3, 'Escriturado': 4 };
      const typeWeight: Record<string, number> = { 'Departamento': 1, 'Bodega': 2, 'Estacionamiento': 3 };

      return [...units].filter(u => {
          const owner = getUnitOwner(u);
          const effectiveStatus = getEffectiveStatus(u);
          const matchesSearch = u.numero.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                effectiveStatus.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                (owner && owner.nombre.toLowerCase().includes(searchTerm.toLowerCase()));
          const matchesType = filterType === 'Todos' || u.type === filterType;
          const matchesOrientacion = filterOrientacion ? u.orientacion === filterOrientacion : true;
          const matchesPiso = filterPiso ? u.piso?.toString() === filterPiso : true;
          const matchesDorm = filterDormitorios ? u.dormitorios?.toString() === filterDormitorios : true;
          const matchesBanos = filterBanos ? u.banos?.toString() === filterBanos : true;

          return matchesSearch && matchesType && matchesOrientacion && matchesPiso && matchesDorm && matchesBanos;
      }).sort((a, b) => {
          const sA = statusWeight[getEffectiveStatus(a)] || 9;
          const sB = statusWeight[getEffectiveStatus(b)] || 9;
          if (sA !== sB) return sA - sB;
          const tA = typeWeight[a.type] || 9;
          const tB = typeWeight[b.type] || 9;
          if (tA !== tB) return tA - tB;
          return a.numero.localeCompare(b.numero, undefined, { numeric: true });
      });
  }, [units, searchTerm, filterType, filterOrientacion, filterPiso, filterDormitorios, filterBanos]);

  const formatPrice = (price: number) => {
      return price.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Inventario de Proyecto</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Visualización y gestión de unidades del proyecto.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
             {[
                 { id: 'Todos', label: 'Todos', icon: LayoutGrid },
                 { id: 'Departamento', label: 'Departamentos', icon: Home },
                 { id: 'Estacionamiento', label: 'Estacionamientos', icon: Car },
                 { id: 'Bodega', label: 'Bodegas', icon: Package }
             ].map(tab => {
                 const Icon = tab.icon;
                 const active = filterType === tab.id;
                 return (
                     <button key={tab.id} onClick={() => { setFilterType(tab.id); if(tab.id !== 'Departamento' && tab.id !== 'Todos') clearFilters(); }} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${active ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                        <Icon className="w-4 h-4" /> {tab.label}
                    </button>
                 );
             })}
          </div>
          <div className="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg border border-gray-200 dark:border-gray-600">
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-gray-800 text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white dark:bg-gray-800 text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><List className="w-4 h-4" /></button>
          </div>
      </div>

      {/* Buscador Estilo Lista de Precios con Filtros Avanzados */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
        <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-6 h-6" />
            <input 
              type="text" 
              placeholder="Buscar por número o titular..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              className="w-full pl-12 pr-6 py-4 text-lg bg-gray-50 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 rounded-2xl focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 outline-none transition-all dark:text-white" 
            />
        </div>

        {(filterType === 'Todos' || filterType === 'Departamento') && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 pt-2">
                <div className="relative group">
                    <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <select value={filterPiso} onChange={(e) => setFilterPiso(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-100">
                        <option value="">Cualquier Piso</option>
                        {uniqueFloors.map(f => <option key={f} value={f}>{f > 0 ? `Piso ${f}` : 'Zócalo'}</option>)}
                    </select>
                </div>

                <div className="relative group">
                    <Bed className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <select value={filterDormitorios} onChange={(e) => setFilterDormitorios(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-100">
                        <option value="">Dormitorios (Todos)</option>
                        {uniqueDorms.map(d => <option key={d} value={d}>{d} {d === 1 ? 'Dormitorio' : 'Dormitorios'}</option>)}
                    </select>
                </div>

                <div className="relative group">
                    <Bath className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <select value={filterBanos} onChange={(e) => setFilterBanos(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-100">
                        <option value="">Baños (Todos)</option>
                        {uniqueBaths.map(b => <option key={b} value={b}>{b} {b === 1 ? 'Baño' : 'Baños'}</option>)}
                    </select>
                </div>

                <div className="relative group">
                    <Compass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <select value={filterOrientacion} onChange={(e) => setFilterOrientacion(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-100">
                        <option value="">Orientación (Todas)</option>
                        {uniqueOrientations.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>

                <button onClick={clearFilters} disabled={!hasActiveFilters} className="col-span-2 md:col-span-1 py-2.5 px-4 text-xs font-bold text-gray-500 hover:text-red-600 disabled:opacity-0 transition-all flex items-center justify-center gap-2">
                    <X className="w-4 h-4" /> Limpiar Filtros
                </button>
            </div>
        )}
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredUnits.length === 0 ? (
                <div className="col-span-full text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl"><Filter className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No se encontraron unidades.</p></div>
            ) : filteredUnits.map((unit) => {
                const owner = getUnitOwner(unit);
                const effectiveStatus = getEffectiveStatus(unit);
                return (
                <div key={unit.id} onClick={() => onSelectUnit(unit)} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 transition-all cursor-pointer hover:shadow-md hover:border-blue-300 group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${unit.type === 'Departamento' ? 'bg-blue-50 text-blue-600' : unit.type === 'Estacionamiento' ? 'bg-gray-100 text-gray-600' : 'bg-orange-50 text-orange-600'}`}>{getUnitIcon(unit.type)}</div>
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white">{unit.type} {unit.numero}</h3>
                                <div className="flex gap-2">
                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(effectiveStatus)}`}>{effectiveStatus}</span>
                                    {unit.type !== 'Estacionamiento' && unit.superficie && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"><Ruler className="w-3 h-3" /> {unit.superficie} m²</span>}
                                </div>
                            </div>
                        </div>
                    </div>
                    {unit.type === 'Departamento' && (
                        <div className="flex justify-between px-2 mb-4 text-sm text-gray-500 border-b border-gray-50 dark:border-gray-700 pb-2">
                            <div className="flex items-center gap-1"><Bed className="w-4 h-4" /> <span>{unit.dormitorios || '-'} Dorm.</span></div>
                            <div className="flex items-center gap-1"><Bath className="w-4 h-4" /> <span>{unit.banos || '-'} Baños</span></div>
                        </div>
                    )}
                    <div className="mb-4">
                        <span className="text-[10px] text-gray-400 font-semibold block mb-1">Titular / Estado Comercial</span>
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5 text-gray-400" />{owner ? owner.nombre : <span className="text-gray-300 italic">{effectiveStatus === 'Disponible' ? 'Disponible' : '—'}</span>}</div>
                    </div>
                    <div className="flex flex-col items-center py-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-colors mb-4">
                       <span className="text-[10px] text-gray-400 font-semibold">Precio Lista</span>
                       <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatPrice(unit.precioLista)} <small className="text-xs font-normal text-gray-400">UF</small></span>
                    </div>
                    <button className="w-full py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white">Gestionar Unidad <ChevronRight className="w-4 h-4" /></button>
                </div>
            )})}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
                <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600 font-semibold text-xs text-gray-500 dark:text-gray-400">
                        <th className="px-6 py-4">Unidad</th>
                        <th className="px-6 py-4">Tipo</th>
                        <th className="px-6 py-4">Asociados</th>
                        <th className="px-6 py-4">Estado Comercial</th>
                        <th className="px-6 py-4">Atributos</th>
                        <th className="px-6 py-4">Titular</th>
                        <th className="px-6 py-4 text-right">Precio (UF)</th>
                        <th className="px-6 py-4"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {filteredUnits.length === 0 ? (
                        <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400">No se encontraron registros.</td></tr>
                    ) : filteredUnits.map(unit => {
                        const owner = getUnitOwner(unit);
                        const effectiveStatus = getEffectiveStatus(unit);
                        const reservadaOtro = isReservadaOtroVendedor(unit);
                        const canLiberar = currentUser && ['Admin', 'Supervisor', 'JefeSala'].includes(currentUser.role) && unit.estado === 'Reservado';
                        const isVentas = currentUser?.role === 'Ventas';
                        const expiraDate = unit.reservaExpira ? new Date(unit.reservaExpira) : null;
                        const expiraProxima = expiraDate && (expiraDate.getTime() - Date.now()) < 24 * 60 * 60 * 1000;
                        return (
                        <tr key={unit.id} onClick={() => !reservadaOtro && onSelectUnit(unit)} className={`hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors group ${reservadaOtro ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                            <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{unit.numero}</td>
                            <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{unit.type}</td>
                            <td className="px-6 py-4">{getUnitAsociados(unit)}</td>
                            <td className="px-6 py-4">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(effectiveStatus)}`}>{effectiveStatus}</span>
                            </td>
                            <td className="px-6 py-4 text-gray-500 text-xs">{getUnitAttributes(unit)}</td>
                            <td className="px-6 py-4 text-gray-600 dark:text-gray-400 text-xs truncate max-w-[150px]">{owner ? owner.nombre : '—'}</td>
                            <td className="px-6 py-4 text-right font-mono font-bold text-blue-600 dark:text-blue-400">{formatPrice(unit.precioLista)}</td>
                            <td className="px-6 py-4">
                              {canLiberar && (
                                <button
                                  onClick={(e) => handleLiberar(unit.id, e)}
                                  className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors whitespace-nowrap"
                                  title="Liberar reserva"
                                >
                                  <Unlock className="w-3 h-3" /> Liberar Unidad
                                </button>
                              )}
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
