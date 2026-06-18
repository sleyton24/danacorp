import React, { useState, useMemo } from 'react';
import { RealEstateUnit, User } from '../types';
import { Search, Edit2, Check, X, ArrowUp, ArrowDown, Filter, Compass, Layers, Bed, Bath, Car, Package, Home, LayoutGrid, Lock, Ruler, Tag, List, Link as LinkIcon } from 'lucide-react';

interface PriceManagerProps {
  units: RealEstateUnit[];
  onUpdateUnit: (unit: RealEstateUnit) => void;
  currentUser: User;
}

export const PriceManager: React.FC<PriceManagerProps> = ({ units, onUpdateUnit, currentUser }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<RealEstateUnit | null>(null);
  const [tempPrice, setTempPrice] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('Todos');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');

  const [filterOrientacion, setFilterOrientacion] = useState('');
  const [filterPiso, setFilterPiso] = useState('');
  const [filterDormitorios, setFilterDormitorios] = useState('');
  const [filterBanos, setFilterBanos] = useState('');

  // Extraer valores únicos para los filtros dinámicos (solo para Departamentos)
  // Fix: Added explicit types to sort parameters to avoid arithmetic operation errors on inferred unknown types
  const uniqueFloors = useMemo(() => Array.from(new Set(units.map(u => u.piso).filter((v): v is number => typeof v === 'number'))).sort((a: number, b: number) => a - b), [units]);
  const uniqueDorms = useMemo(() => Array.from(new Set(units.map(u => u.dormitorios).filter((v): v is number => typeof v === 'number'))).sort((a: number, b: number) => a - b), [units]);
  const uniqueBaths = useMemo(() => Array.from(new Set(units.map(u => u.banos).filter((v): v is number => typeof v === 'number'))).sort((a: number, b: number) => a - b), [units]);
  const uniqueOrientations = useMemo(() => Array.from(new Set(units.filter(u => u.orientacion).map(u => u.orientacion))).sort(), [units]);

  const formatPrice = (price: number) => {
      return price.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  /**
   * Lógica Centralizada de Estado (Tarea Puntual)
   * Sincroniza el estado de unidades secundarias con su departamento padre.
   * Si no tiene padre, se marca como Disponible.
   */
  const getEffectiveStatus = (unit: RealEstateUnit): string => {
    // 1. Si es un Departamento, manda su estado comercial real
    if (unit.type === 'Departamento') return unit.estado;
    
    // 2. Si es Estacionamiento o Bodega, buscamos si algún Departamento lo tiene asignado
    const parent = units.find(u => 
        u.type === 'Departamento' && 
        (u.estacionamientos.includes(unit.numero) || u.bodegas.includes(unit.numero))
    );
    
    // 3. Si encontramos el departamento, heredamos su estado
    if (parent) return parent.estado;
    
    // 4. Tarea puntual: Si no tiene departamento asignado, se muestra como "Disponible"
    return 'Disponible';
  };

  const getUnitTitle = (unit: RealEstateUnit) => {
    switch(unit.type) {
        case 'Bodega': return `Bodega ${unit.numero}`;
        case 'Estacionamiento': return `Estacionamiento ${unit.numero}`;
        default: return `Departamento ${unit.numero}`;
    }
  };

  const getUnitIcon = (type: string) => {
    switch(type) {
        case 'Bodega': return <Package className="w-6 h-6" />;
        case 'Estacionamiento': return <Car className="w-6 h-6" />;
        default: return <Home className="w-6 h-6" />;
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

  const isStatusEditable = (status: string) => status === 'Disponible';

  const filteredUnits = useMemo(() => {
      return units.filter(u => {
        const effectiveStatus = getEffectiveStatus(u);
        const matchesSearch = u.numero.toLowerCase().includes(searchTerm.toLowerCase()) || effectiveStatus.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = filterType === 'Todos' || u.type === filterType;
        const matchesOrientacion = filterOrientacion ? u.orientacion === filterOrientacion : true;
        const matchesPiso = filterPiso ? u.piso?.toString() === filterPiso : true;
        const matchesDorm = filterDormitorios ? u.dormitorios?.toString() === filterDormitorios : true;
        const matchesBanos = filterBanos ? u.banos?.toString() === filterBanos : true;
        return matchesSearch && matchesType && matchesOrientacion && matchesPiso && matchesDorm && matchesBanos;
      }).sort((a, b) => {
          const statusA = getEffectiveStatus(a);
          const statusB = getEffectiveStatus(b);
          const isAvailableA = isStatusEditable(statusA);
          const isAvailableB = isStatusEditable(statusB);
          
          if (isAvailableA && !isAvailableB) return -1;
          if (!isAvailableA && isAvailableB) return 1;
          
          const typePriority: Record<string, number> = { 'Departamento': 1, 'Estacionamiento': 2, 'Bodega': 3 };
          const priorityA = typePriority[a.type] || 99;
          const priorityB = typePriority[b.type] || 99;
          if (priorityA !== priorityB) return priorityA - priorityB;
          
          return a.numero.localeCompare(b.numero, undefined, { numeric: true });
      });
  }, [units, searchTerm, filterType, filterOrientacion, filterPiso, filterDormitorios, filterBanos]);

  const openEditModal = (unit: RealEstateUnit, effectiveStatus: string) => {
    // Tarea Puntual: Se restringe la edición para JefeSala
    if (!isStatusEditable(effectiveStatus) || currentUser.role === 'Ventas' || currentUser.role === 'Lectura' || currentUser.role === 'JefeSala') return;
    setSelectedUnit(unit);
    setTempPrice(unit.precioLista.toString());
  };

  const handlePriceChange = (delta: number) => {
    const current = parseFloat(tempPrice) || 0;
    setTempPrice((current + delta).toFixed(1));
  };

  const handleSave = () => {
    if (selectedUnit && tempPrice) {
      const newPrice = parseFloat(tempPrice);
      const updatedUnit: RealEstateUnit = {
        ...selectedUnit,
        precioLista: newPrice,
        precioVenta: isStatusEditable(getEffectiveStatus(selectedUnit)) ? newPrice : selectedUnit.precioVenta,
      };
      onUpdateUnit(updatedUnit);
      setSelectedUnit(null);
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

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Lista de precios</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Gestión de valores base para unidades disponibles.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
             {[
                 { id: 'Todos', label: 'Todos', icon: LayoutGrid },
                 { id: 'Departamento', label: 'Departamentos', icon: Home },
                 { id: 'Estacionamiento', label: 'Estacionamientos', icon: Car },
                 { id: 'Bodega', label: 'Bodegas', icon: Package },
             ].map(tab => {
                 const Icon = tab.icon;
                 const active = filterType === tab.id;
                 return (
                     <button key={tab.id} onClick={() => { setFilterType(tab.id); if(tab.id !== 'Departamento' && tab.id !== 'Todos') clearFilters(); }} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${active ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>
                         <Icon className="w-4 h-4" /> {tab.label}
                     </button>
                 );
             })}
          </div>
          <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><List className="w-4 h-4" /></button>
          </div>
      </div>

      {/* Barra de Búsqueda y Filtros de Atributos */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-6 h-6" />
            <input type="text" placeholder="Buscar por número o estado..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-6 py-4 text-lg bg-gray-50 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all" />
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
                        <option value="">Dormitorios (Cualquiera)</option>
                        {uniqueDorms.map(d => <option key={d} value={d}>{d} {d === 1 ? 'Dormitorio' : 'Dormitorios'}</option>)}
                    </select>
                </div>

                <div className="relative group">
                    <Bath className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <select value={filterBanos} onChange={(e) => setFilterBanos(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-100">
                        <option value="">Baños (Cualquiera)</option>
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
          <div className="col-span-full text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl"><Filter className="w-12 h-12 mx-auto mb-2 opacity-20" /><p>No se encontraron unidades con estos filtros.</p></div>
        ) : filteredUnits.map((unit) => {
          const effectiveStatus = getEffectiveStatus(unit);
          // Tarea Puntual: Se restringe isEditable para JefeSala
          const isEditable = isStatusEditable(effectiveStatus) && (currentUser.role !== 'Ventas' && currentUser.role !== 'Lectura' && currentUser.role !== 'JefeSala');
          return (
          <div key={unit.id} onClick={() => openEditModal(unit, effectiveStatus)} className={`bg-white rounded-xl border border-gray-200 p-6 transition-all cursor-pointer group relative ${!isEditable ? 'opacity-60 grayscale-[0.3]' : 'hover:shadow-lg hover:border-blue-300'}`}>
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${unit.type === 'Departamento' ? 'bg-blue-50 text-blue-600' : unit.type === 'Estacionamiento' ? 'bg-gray-100 text-gray-600' : 'bg-orange-50 text-orange-600'}`}>{getUnitIcon(unit.type)}</div>
                    <div><h3 className="font-bold text-lg text-gray-900">{getUnitTitle(unit)}</h3><div className="flex flex-wrap gap-1 mt-1"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(effectiveStatus)}`}>{effectiveStatus}</span></div></div>
                </div>
                {!isEditable && <div title="Edición bloqueada" className="text-gray-300"><Lock className="w-5 h-5" /></div>}
            </div>
            <div className="px-2 mb-4 text-xs text-gray-500 border-b border-gray-50 pb-3">{getUnitAttributes(unit)}</div>
            <div className={`flex flex-col items-center py-4 rounded-xl mb-4 transition-colors ${!isEditable ? 'bg-gray-50' : 'bg-gray-50 group-hover:bg-blue-50'}`}><span className="text-sm text-gray-500 font-semibold">Precio de lista</span><span className={`text-3xl font-extrabold ${!isEditable ? 'text-gray-400' : 'text-blue-700'}`}>{formatPrice(unit.precioLista)} <small className="text-sm font-normal text-gray-500">UF</small></span></div>
            <button disabled={!isEditable} className={`w-full py-3 font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${!isEditable ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed' : 'bg-white border-2 border-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white'}`}>{isEditable ? <Edit2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}{isEditable ? 'Editar precio' : 'Precio bloqueado'}</button>
          </div>
        )})}
      </div>
      ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                      <thead>
                          <tr className="bg-gray-50 border-b border-gray-100 font-semibold text-xs text-gray-500">
                              <th className="px-6 py-4">Unidad</th>
                              <th className="px-6 py-4">Tipo</th>
                              <th className="px-6 py-4">Asociados</th>
                              <th className="px-6 py-4">Estado</th>
                              <th className="px-6 py-4">Atributos</th>
                              <th className="px-6 py-4 text-right">Precio lista (UF)</th>
                              <th className="px-6 py-4 text-center w-10"></th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {filteredUnits.length === 0 ? (
                              <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No se encontraron unidades.</td></tr>
                          ) : filteredUnits.map((unit) => {
                              const effectiveStatus = getEffectiveStatus(unit);
                              // Tarea Puntual: Se restringe isEditable para JefeSala
                              const isEditable = isStatusEditable(effectiveStatus) && (currentUser.role !== 'Ventas' && currentUser.role !== 'Lectura' && currentUser.role !== 'JefeSala');
                              return (
                              <tr key={unit.id} onClick={() => openEditModal(unit, effectiveStatus)} className={`transition-colors ${isEditable ? 'hover:bg-blue-50 cursor-pointer' : 'hover:bg-gray-50 opacity-70 cursor-not-allowed'}`}>
                                  <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{unit.numero}</td>
                                  <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{unit.type}</td>
                                  <td className="px-6 py-4">{getUnitAsociados(unit)}</td>
                                  <td className="px-6 py-4">
                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(effectiveStatus)}`}>{effectiveStatus}</span>
                                  </td>
                                  <td className="px-6 py-4 text-gray-500 text-xs">{getUnitAttributes(unit)}</td>
                                  <td className="px-6 py-4 text-right font-mono font-bold text-blue-700">{formatPrice(unit.precioLista)}</td>
                                  <td className="px-6 py-4 text-center">{isEditable ? <Edit2 className="w-4 h-4 text-blue-400" /> : <Lock className="w-4 h-4 text-gray-300" />}</td>
                              </tr>
                          )})}
                      </tbody>
                  </table>
              </div>
          </div>
      )}
      {selectedUnit && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden transform transition-all scale-100 flex flex-col max-h-[90vh]">
            <div className="bg-blue-600 p-6 flex justify-between items-center text-white flex-shrink-0"><h3 className="text-2xl font-bold">Editar {getUnitTitle(selectedUnit)}</h3><button onClick={() => setSelectedUnit(null)} className="p-2 hover:bg-white/20 rounded-full transition-colors"><X className="w-8 h-8" /></button></div>
            <div className="p-8 space-y-8 overflow-y-auto"><div className="text-center"><label className="block text-gray-500 font-semibold mb-2 uppercase tracking-wide">Nuevo precio (UF)</label><input type="number" step="0.1" value={tempPrice} onChange={(e) => setTempPrice(e.target.value)} className="w-full text-center text-5xl font-bold text-gray-800 dark:text-white border-b-4 border-blue-200 focus:border-blue-600 outline-none py-2 bg-transparent" /><p className="mt-2 text-xs text-gray-400">Visualmente: {formatPrice(parseFloat(tempPrice) || 0)} UF</p></div><div className="grid grid-cols-2 gap-4"><button onClick={() => handlePriceChange(-10)} className="py-4 bg-red-50 text-red-700 font-bold rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2"><ArrowDown className="w-6 h-6" /> Bajar 10 UF</button><button onClick={() => handlePriceChange(10)} className="py-4 bg-green-50 text-green-700 font-bold rounded-xl hover:bg-green-100 transition-colors flex items-center justify-center gap-2"><ArrowUp className="w-6 h-6" /> Subir 10 UF</button></div><div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 flex gap-3 items-start"><div className="text-yellow-600 mt-1"><Tag className="w-5 h-5" /></div><div className="text-sm text-yellow-800 leading-relaxed"><p>Al guardar, el <strong>Precio de lista</strong> se actualizará en todo el sistema con un solo decimal.</p></div></div><div className="grid grid-cols-2 gap-4 pt-2"><button onClick={() => setSelectedUnit(null)} className="py-4 border-2 border-gray-200 text-gray-500 font-bold rounded-xl hover:bg-gray-50 hover:text-gray-700 text-lg">Cancelar</button><button onClick={handleSave} className="py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all text-lg flex items-center justify-center gap-2"><Check className="w-6 h-6" /> Guardar cambios</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
};