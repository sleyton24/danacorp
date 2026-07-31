import React, { useState, useMemo } from 'react';
import { RealEstateUnit, Client, User, Project } from '../types';
import { TrendingUp } from 'lucide-react';
import {
  estaTomado, esRolVendedor,
  sumarUF, parseFechaFlexible, bucketMes, enPeriodo, type Periodo,
  crearIndiceVinculos, estadoEfectivoUnidad, departamentoPadre, fechaHitoUnidad,
  vendedorAtribuidoId,
} from '../utils/analytics';
import { ventanaComparacion, enVentana, delta, type Comparacion } from '../utils/analiticaFiltros';
import { TarjetaKpi } from './analitica/TarjetaKpi';
import { TablaDensa, type FilaDensa } from './analitica/TablaDensa';
import { TablaUnidades } from './analitica/TablaUnidades';

interface SalesPerformanceViewProps {
  currentUser: User;
  units: RealEstateUnit[];
  clients: Client[];
  users: User[];
  projects: Project[];
  currentProjectId: string | null;
  onSelectUnit?: (unit: RealEstateUnit) => void;
}

const fmtUF = (v: number) => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const SalesPerformanceView: React.FC<SalesPerformanceViewProps> = ({
  currentUser, units, clients, users, projects, currentProjectId, onSelectUnit,
}) => {
  const isVentas = currentUser.role === 'Ventas';

  const [filterProject, setFilterProject] = useState(currentProjectId || 'all');
  const [filterPeriod, setFilterPeriod] = useState<Periodo>('all');
  const [comparacion, setComparacion] = useState<Comparacion>('none');
  const [filterVendor, setFilterVendor] = useState(isVentas ? currentUser.id : 'all');
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  const clientePorId = useMemo(() => {
    const m = new Map<string, Client>();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const filteredClients = useMemo(() => {
    const ahora = new Date();
    return clients.filter(c => {
      if (filterProject !== 'all' && c.projectId !== filterProject) return false;
      if (isVentas) { if (c.ejecutivoId !== currentUser.id) return false; }
      else if (filterVendor !== 'all' && c.ejecutivoId !== filterVendor) return false;
      // Una fecha ilegible queda FUERA del período en vez de colarse en todos.
      return enPeriodo(parseFechaFlexible(c.fechaRegistro), filterPeriod, ahora);
    });
  }, [clients, filterProject, filterPeriod, filterVendor, isVentas, currentUser.id]);

  /**
   * Unidades del proyecto seleccionado + el índice de vínculos.
   *
   * El índice se construye ANTES de filtrar por vendedor y período: las bodegas y
   * estacionamientos heredan estado, fecha de hito y atribución de su departamento padre,
   * y ese padre podría quedar fuera del filtro.
   */
  const scopeProyecto = useMemo(() => {
    const delProyecto = filterProject === 'all' ? units : units.filter(u => u.projectId === filterProject);
    const vinculos = crearIndiceVinculos(delProyecto.filter(u => u.type === 'Departamento'));
    return { delProyecto, vinculos };
  }, [units, filterProject]);

  const filteredUnits = useMemo(() => {
    const { delProyecto, vinculos } = scopeProyecto;
    const ahora = new Date();
    const vendedorEfectivo = isVentas ? currentUser.id : filterVendor;

    return delProyecto.filter(u => {
      if (vendedorEfectivo !== 'all') {
        const fuente = u.type === 'Departamento' ? u : (departamentoPadre(u, vinculos) ?? u);
        const cliente = fuente.clienteId ? clientePorId.get(fuente.clienteId) : undefined;
        if (vendedorAtribuidoId(fuente, cliente) !== vendedorEfectivo) return false;
      }
      if (filterPeriod !== 'all') {
        if (!enPeriodo(fechaHitoUnidad(u, vinculos), filterPeriod, ahora)) return false;
      }
      return true;
    });
  }, [scopeProyecto, filterVendor, filterPeriod, isVentas, currentUser.id, clientePorId]);

  const unidadesTomadas = useMemo(() => {
    const { vinculos } = scopeProyecto;
    return filteredUnits.filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos)));
  }, [filteredUnits, scopeProyecto]);

  const kpis = useMemo(() => {
    const cerrados = filteredClients.filter(c => c.estado === 'Cerrado').length;
    const total = filteredClients.length;
    return {
      total, cerrados,
      activos: filteredClients.filter(c => c.estado === 'Activo').length,
      prospectos: filteredClients.filter(c => c.estado === 'Prospecto').length,
      ufColocadas: sumarUF(unidadesTomadas),
      tasaEscrituracion: total > 0 ? Math.round((cerrados / total) * 1000) / 10 : 0,
    };
  }, [filteredClients, unidadesTomadas]);

  /**
   * Métricas del período de COMPARACIÓN (ventana arbitraria, no uno de los `Periodo`
   * nombrados) — repite el mismo criterio de filtrado de `filteredClients`/`filteredUnits`
   * pero contra `ventanaComparacion` en vez de `enPeriodo`. Null si no hay comparación
   * elegida o el período es 'all' (acumulado no tiene con qué contrastar).
   */
  const previo = useMemo(() => {
    const ventana = ventanaComparacion(filterPeriod, comparacion, new Date());
    if (!ventana) return null;
    const { delProyecto, vinculos } = scopeProyecto;
    const vendedorEfectivo = isVentas ? currentUser.id : filterVendor;

    const clientesPrev = clients.filter(c => {
      if (filterProject !== 'all' && c.projectId !== filterProject) return false;
      if (isVentas) { if (c.ejecutivoId !== currentUser.id) return false; }
      else if (filterVendor !== 'all' && c.ejecutivoId !== filterVendor) return false;
      return enVentana(parseFechaFlexible(c.fechaRegistro), ventana);
    });
    const unidadesPrev = delProyecto.filter(u => {
      if (vendedorEfectivo !== 'all') {
        const fuente = u.type === 'Departamento' ? u : (departamentoPadre(u, vinculos) ?? u);
        const cliente = fuente.clienteId ? clientePorId.get(fuente.clienteId) : undefined;
        if (vendedorAtribuidoId(fuente, cliente) !== vendedorEfectivo) return false;
      }
      return enVentana(fechaHitoUnidad(u, vinculos), ventana);
    }).filter(u => estaTomado(estadoEfectivoUnidad(u, vinculos)));

    return {
      clientes: clientesPrev.length,
      cerrados: clientesPrev.filter(c => c.estado === 'Cerrado').length,
      ufColocadas: sumarUF(unidadesPrev),
    };
  }, [filterPeriod, comparacion, clients, scopeProyecto, filterProject, filterVendor, isVentas, currentUser.id, clientePorId]);

  const funnelData = [
    { label: 'Prospectos', count: kpis.prospectos, color: '#3b82f6' },
    { label: 'Activos', count: kpis.activos, color: '#8b5cf6' },
    { label: 'Cerrados', count: kpis.cerrados, color: '#10b981' },
  ];
  const funnelMax = Math.max(...funnelData.map(f => f.count), 1);

  const unitTypeDist = useMemo(() =>
    (['Departamento', 'Bodega', 'Estacionamiento'] as const).map(type => {
      const delTipo = unidadesTomadas.filter(u => u.type === type);
      return { type, count: delTipo.length, uf: sumarUF(delTipo) };
    }), [unidadesTomadas]);

  const vendorStats = useMemo(() => {
    const { vinculos } = scopeProyecto;
    const atribucion = (u: RealEstateUnit) => {
      const fuente = u.type === 'Departamento' ? u : (departamentoPadre(u, vinculos) ?? u);
      const cliente = fuente.clienteId ? clientePorId.get(fuente.clienteId) : undefined;
      return vendedorAtribuidoId(fuente, cliente);
    };

    return users
      .filter(u => esRolVendedor(u.role))
      .map(v => {
        const vClients = filteredClients.filter(c => c.ejecutivoId === v.id);
        const vUnits = unidadesTomadas.filter(u => atribucion(u) === v.id);
        return {
          user: v,
          clientesRegistrados: vClients.length,
          activos: vClients.filter(c => c.estado === 'Activo').length,
          cerrados: vClients.filter(c => c.estado === 'Cerrado').length,
          unidades: vUnits.length,
          ufColocadas: sumarUF(vUnits),
          clients: vClients,
        };
      })
      .filter(v => v.unidades > 0 || v.clientesRegistrados > 0)
      .sort((a, b) => b.cerrados - a.cerrados);
  }, [filteredClients, unidadesTomadas, users, scopeProyecto, clientePorId]);

  const trend = useMemo(() => {
    const months: Record<string, { cotizantes: number; cerrados: number }> = {};
    let descartados = 0;
    filteredClients.forEach(c => {
      const d = parseFechaFlexible(c.fechaRegistro);
      if (!d) { descartados++; return; }
      const key = bucketMes(d);
      if (!months[key]) months[key] = { cotizantes: 0, cerrados: 0 };
      months[key].cotizantes++;
      if (c.estado === 'Cerrado') months[key].cerrados++;
    });
    const series = Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({ key, ...val }));
    return { series, descartados };
  }, [filteredClients]);

  const trendMax = Math.max(...trend.series.map(d => d.cotizantes), 1);

  const toggleVendor = (id: string) => {
    setExpandedVendors(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };
  const toggleFilterVendor = (id: string) => setFilterVendor(prev => (prev === id ? 'all' : id));

  const maxUf = Math.max(...vendorStats.map(v => v.ufColocadas), 1);
  const deltaUf = previo ? delta(kpis.ufColocadas, previo.ufColocadas) : null;
  const deltaClientes = previo ? delta(kpis.total, previo.clientes) : null;
  const deltaCerrados = previo ? delta(kpis.cerrados, previo.cerrados) : null;
  const colorDelta = (d: ReturnType<typeof delta>) =>
    !d ? '' : d.direccion === 'up' ? 'text-green-600' : d.direccion === 'down' ? 'text-red-600' : 'text-gray-400';

  const filasVendedores: FilaDensa[] = vendorStats.map(v => ({
    key: v.user.id, label: v.user.name, total: v.clientesRegistrados || 1, colocadas: v.cerrados,
    pct: v.clientesRegistrados ? Math.round((v.cerrados / v.clientesRegistrados) * 100) : 0, uf: v.ufColocadas,
  }));

  return (
    <div className="animate-fade-in max-w-6xl mx-auto space-y-4 pb-12">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-blue-600" /> Performance de Ventas
        </h2>
        <p className="text-gray-500 mt-1 text-sm">Métricas de gestión comercial del equipo.</p>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Proyecto</label>
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100">
            <option value="all">Todos los proyectos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Período</label>
          <select value={filterPeriod} onChange={e => { setFilterPeriod(e.target.value as Periodo); if (e.target.value === 'all') setComparacion('none'); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100">
            <option value="all">Todo el tiempo</option>
            <option value="year">Este año</option>
            <option value="quarter">Este trimestre</option>
            <option value="month">Este mes</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Comparar contra</label>
          <select value={comparacion} disabled={filterPeriod === 'all'} onChange={e => setComparacion(e.target.value as Comparacion)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-40">
            <option value="none">Sin comparación</option>
            <option value="prev">Período anterior</option>
            <option value="yoy">Mismo período, año anterior</option>
          </select>
        </div>
        {!isVentas && (
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Vendedor</label>
            <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100">
              <option value="all">Todos</option>
              {users.filter(u => esRolVendedor(u.role)).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Nivel 1 — Titular: UF colocadas + barras por vendedor (ranking visual) */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm text-gray-500">UF colocadas</span>
          <span className="text-xs text-gray-400">
            {isVentas ? 'tus unidades'
              : filterVendor === 'all' ? 'equipo completo'
                : users.find(u => u.id === filterVendor)?.name ?? 'vendedor filtrado'}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-5 mb-2">
          <span className="text-5xl font-bold text-gray-900 leading-none font-mono tabular-nums">{fmtUF(kpis.ufColocadas)}</span>
          <div className="text-sm text-gray-600 leading-tight">
            {unidadesTomadas.length} unidades
            <br /><span className="text-gray-400">{kpis.cerrados} clientes cerrados</span>
          </div>
          {deltaUf && (
            <div className="sm:ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-0.5">vs comparación</p>
              <span className={`text-[11px] font-bold ${colorDelta(deltaUf)}`}>{deltaUf.texto}</span>
            </div>
          )}
        </div>

        {!isVentas && vendorStats.length > 0 && (
          <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
            {vendorStats.map(v => (
              <button key={v.user.id} onClick={() => toggleFilterVendor(v.user.id)} className="w-full flex items-center gap-3 group">
                <span className={`text-xs w-32 text-left truncate shrink-0 ${filterVendor === v.user.id ? 'font-bold text-indigo-900' : 'text-gray-600'}`}>{v.user.name}</span>
                <span className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <span className="block h-full rounded-full transition-all" style={{ width: `${(v.ufColocadas / maxUf) * 100}%`, backgroundColor: filterVendor === v.user.id ? '#312e81' : '#818cf8' }} />
                </span>
                <span className="text-xs font-mono text-gray-700 w-20 text-right shrink-0">{fmtUF(v.ufColocadas)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nivel 2 — tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TarjetaKpi label="Clientes registrados" valor={String(kpis.total)} sub="fichas de cliente creadas" delta={deltaClientes} />
        <TarjetaKpi label="Cierres" valor={String(kpis.cerrados)} sub="estado Cerrado" delta={deltaCerrados} />
        <TarjetaKpi label="Tasa de escrituración" valor={`${kpis.tasaEscrituracion}%`} sub="clientes con todo escriturado" />
        <TarjetaKpi label="UF por cierre" valor={kpis.cerrados ? fmtUF(kpis.ufColocadas / kpis.cerrados) : '—'} sub="promedio" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <h3 className="text-xs font-bold text-gray-700 mb-1">Embudo de Ventas</h3>
          <p className="text-[11px] text-gray-400 mb-4">Clientes por estado.</p>
          <div className="space-y-3">
            {funnelData.map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((count / funnelMax) * 100)}%`, backgroundColor: color }} />
                </div>
                <span className="text-xs font-black text-gray-700 w-6 text-right shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <h3 className="text-xs font-bold text-gray-700 mb-1">Distribución por Tipo de Unidad</h3>
          <p className="text-[11px] text-gray-400 mb-4">Colocadas = reservadas, promesadas o escrituradas.</p>
          <div className="space-y-2">
            {unitTypeDist.map(({ type, count, uf }) => (
              <div key={type} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-sm font-bold text-gray-800">{type}</div>
                  <div className="text-xs text-gray-400">{count} colocada{count !== 1 ? 's' : ''}</div>
                </div>
                <div className="text-sm font-black text-blue-700 font-mono">{fmtUF(uf)} UF</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Nivel 2 — consola: matriz de vendedores + serie mensual */}
      {!isVentas && vendorStats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TablaDensa
            titulo="Matriz de vendedores" filas={filasVendedores} nota="cerrados/clientes · UF"
            activoKey={k => filterVendor === k}
            onClickFila={toggleVendor}
            expandidoKey={k => expandedVendors.has(k)}
            filaExpandida={k => {
              const v = vendorStats.find(x => x.user.id === k);
              if (!v || v.clients.length === 0) return null;
              return v.clients.map(c => (
                <tr key={c.id} className="bg-indigo-50/40 border-b border-indigo-50">
                  <td colSpan={5} className="px-3 py-1.5 pl-6 text-[11px] text-gray-700 flex items-center justify-between gap-2">
                    <span className="truncate">{c.nombre}</span>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      c.estado === 'Cerrado' ? 'bg-green-100 text-green-700'
                        : c.estado === 'Activo' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>{c.estado}</span>
                  </td>
                </tr>
              ));
            }}
          />
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-xs font-bold text-gray-700 mb-4">Tendencia de Clientes Registrados por Mes</h3>
            {trend.series.length > 1 ? (
              <>
                <div className="overflow-x-auto">
                  <svg width={Math.max(trend.series.length * 64 + 40, 360)} height={160}>
                    {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                      const y = 120 - frac * 100;
                      return (
                        <React.Fragment key={frac}>
                          <line x1={30} y1={y} x2={Math.max(trend.series.length * 64 + 40, 360)} y2={y} stroke="#f3f4f6" strokeWidth={1} />
                          <text x={0} y={y + 4} fontSize={8} fill="#9ca3af">{Math.round(frac * trendMax)}</text>
                        </React.Fragment>
                      );
                    })}
                    <polyline fill="none" stroke="#3b82f6" strokeWidth={2}
                      points={trend.series.map((d, i) => `${34 + i * 64},${120 - (d.cotizantes / trendMax) * 100}`).join(' ')} />
                    <polyline fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray="5,3"
                      points={trend.series.map((d, i) => `${34 + i * 64},${120 - (d.cerrados / trendMax) * 100}`).join(' ')} />
                    {trend.series.map((d, i) => (
                      <React.Fragment key={d.key}>
                        <circle cx={34 + i * 64} cy={120 - (d.cotizantes / trendMax) * 100} r={3} fill="#3b82f6" />
                        <circle cx={34 + i * 64} cy={120 - (d.cerrados / trendMax) * 100} r={3} fill="#10b981" />
                        <text x={34 + i * 64} y={148} textAnchor="middle" fontSize={8} fill="#9ca3af">{d.key}</text>
                      </React.Fragment>
                    ))}
                  </svg>
                </div>
                <div className="flex items-center gap-5 mt-2">
                  <div className="flex items-center gap-1.5"><div className="w-5 border-t-2 border-blue-500" /><span className="text-xs text-gray-500">Clientes registrados</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-5 border-t-2 border-green-500 border-dashed" /><span className="text-xs text-gray-500">Cerrados</span></div>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-gray-400">Sin hitos en el período seleccionado.</p>
            )}
            {trend.descartados > 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-4">
                {trend.descartados} cliente{trend.descartados !== 1 ? 's' : ''} con fecha de registro ilegible, excluido{trend.descartados !== 1 ? 's' : ''} de este gráfico y de los filtros de período.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Nivel 3 — unidades atribuidas de la selección */}
      <TablaUnidades units={unidadesTomadas} onSelectUnit={onSelectUnit} vacio="Sin unidades colocadas en esta selección." />
    </div>
  );
};
