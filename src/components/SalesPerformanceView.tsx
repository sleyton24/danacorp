import React, { useState, useMemo } from 'react';
import { RealEstateUnit, Client, User, Project } from '../types';
import { TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';

interface SalesPerformanceViewProps {
  currentUser: User;
  units: RealEstateUnit[];
  clients: Client[];
  users: User[];
  projects: Project[];
  currentProjectId: string | null;
}

export const SalesPerformanceView: React.FC<SalesPerformanceViewProps> = ({
  currentUser, units, clients, users, projects, currentProjectId,
}) => {
  const isVentas = currentUser.role === 'Ventas';

  const [filterProject, setFilterProject] = useState(currentProjectId || 'all');
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'year' | 'quarter' | 'month'>('all');
  const [filterVendor, setFilterVendor] = useState(isVentas ? currentUser.id : 'all');
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  const parseFecha = (s: string): Date | null => {
    const parts = s.split('-');
    if (parts.length < 3) return null;
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return isNaN(d.getTime()) ? null : d;
  };

  const filteredClients = useMemo(() => {
    const now = new Date();
    return clients.filter(c => {
      if (filterProject !== 'all' && c.projectId !== filterProject) return false;
      if (isVentas) { if (c.ejecutivoId !== currentUser.id) return false; }
      else if (filterVendor !== 'all' && c.ejecutivoId !== filterVendor) return false;
      if (filterPeriod !== 'all') {
        const d = parseFecha(c.fechaRegistro);
        if (!d) return true;
        if (filterPeriod === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (filterPeriod === 'quarter') return Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3) && d.getFullYear() === now.getFullYear();
        if (filterPeriod === 'year') return d.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [clients, filterProject, filterPeriod, filterVendor, isVentas, currentUser.id]);

  const filteredUnits = useMemo(() =>
    filterProject === 'all' ? units : units.filter(u => u.projectId === filterProject),
    [units, filterProject]);

  const kpis = useMemo(() => {
    const cerrados = filteredClients.filter(c => c.estado === 'Cerrado').length;
    const total = filteredClients.length;
    const ufVendidas = filteredUnits
      .filter(u => ['Reservado', 'Promesado', 'Escriturado'].includes(u.estado))
      .reduce((s, u) => s + (u.precioVenta || 0), 0);
    return {
      total,
      cerrados,
      activos: filteredClients.filter(c => c.estado === 'Activo').length,
      prospectos: filteredClients.filter(c => c.estado === 'Prospecto').length,
      desistidos: filteredClients.filter(c => c.estado === 'Desistido').length,
      ufVendidas,
      conversion: total > 0 ? Math.round((cerrados / total) * 1000) / 10 : 0,
    };
  }, [filteredClients, filteredUnits]);

  const funnelData = [
    { label: 'Prospectos', count: kpis.prospectos, color: '#3b82f6' },
    { label: 'Activos', count: kpis.activos, color: '#8b5cf6' },
    { label: 'Cerrados', count: kpis.cerrados, color: '#10b981' },
    { label: 'Desistidos', count: kpis.desistidos, color: '#ef4444' },
  ];
  const funnelMax = Math.max(...funnelData.map(f => f.count), 1);

  const unitTypeDist = useMemo(() => {
    const sold = filteredUnits.filter(u => ['Reservado', 'Promesado', 'Escriturado'].includes(u.estado));
    return (['Departamento', 'Bodega', 'Estacionamiento'] as const).map(type => ({
      type,
      count: sold.filter(u => u.type === type).length,
      uf: sold.filter(u => u.type === type).reduce((s, u) => s + (u.precioVenta || 0), 0),
    }));
  }, [filteredUnits]);

  const vendorStats = useMemo(() => {
    const vendorUsers = users.filter(u => u.role === 'Ventas' || u.role === 'JefeSala');
    return vendorUsers.map(v => {
      const vClients = filteredClients.filter(c => c.ejecutivoId === v.id);
      const vUnits = filteredUnits.filter(u => vClients.some(c => c.id === u.clienteId));
      return {
        user: v,
        cotizantes: vClients.length,
        activos: vClients.filter(c => c.estado === 'Activo').length,
        cerrados: vClients.filter(c => c.estado === 'Cerrado').length,
        desistidos: vClients.filter(c => c.estado === 'Desistido').length,
        ufVendidas: vUnits.filter(u => ['Reservado', 'Promesado', 'Escriturado'].includes(u.estado)).reduce((s, u) => s + (u.precioVenta || 0), 0),
        clients: vClients,
      };
    }).sort((a, b) => b.cerrados - a.cerrados);
  }, [filteredClients, filteredUnits, users]);

  const top3 = vendorStats.slice(0, 3);

  const trendData = useMemo(() => {
    const months: Record<string, { cotizantes: number; cerrados: number }> = {};
    filteredClients.forEach(c => {
      const parts = c.fechaRegistro.split('-');
      if (parts.length < 3) return;
      const key = `${parts[2]}-${parts[1]}`;
      if (!months[key]) months[key] = { cotizantes: 0, cerrados: 0 };
      months[key].cotizantes++;
      if (c.estado === 'Cerrado') months[key].cerrados++;
    });
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => ({ key, ...val }));
  }, [filteredClients]);

  const trendMax = Math.max(...trendData.map(d => d.cotizantes), 1);
  const fmtUF = (v: number) => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const toggleVendor = (id: string) => {
    setExpandedVendors(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-blue-600" /> Performance de Ventas
        </h2>
        <p className="text-gray-500 mt-1 text-sm">Métricas de gestión comercial del equipo.</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
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
          <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as typeof filterPeriod)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100">
            <option value="all">Todo el tiempo</option>
            <option value="year">Este año</option>
            <option value="quarter">Este trimestre</option>
            <option value="month">Este mes</option>
          </select>
        </div>
        {!isVentas && (
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Vendedor</label>
            <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100">
              <option value="all">Todos</option>
              {users.filter(u => u.role === 'Ventas' || u.role === 'JefeSala').map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Cotizantes', value: String(kpis.total), sub: 'clientes registrados', emoji: '👥' },
          { label: 'Cierres', value: String(kpis.cerrados), sub: 'estado Cerrado', emoji: '✅' },
          { label: 'UF Vendidas', value: fmtUF(kpis.ufVendidas), sub: 'precio de venta', emoji: '💰' },
          { label: 'Conversión', value: `${kpis.conversion}%`, sub: 'cerrados / total', emoji: '📈' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-1">
            <div className="text-2xl">{kpi.emoji}</div>
            <div className="text-2xl font-black text-gray-800">{kpi.value}</div>
            <div className="text-sm font-bold text-gray-600">{kpi.label}</div>
            <div className="text-[10px] text-gray-400">{kpi.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-5">Embudo de Ventas</h3>
          <div className="space-y-4">
            {funnelData.map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.round((count / funnelMax) * 100)}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-xs font-black text-gray-700 w-6 text-right shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Unit type distribution */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-5">Distribución por Tipo de Unidad</h3>
          <div className="space-y-3">
            {unitTypeDist.map(({ type, count, uf }) => (
              <div key={type} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-sm font-bold text-gray-800">{type}</div>
                  <div className="text-xs text-gray-400">{count} unidades con estado activo</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-blue-700 font-mono">{fmtUF(uf)} UF</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top 3 Ranking */}
      {top3.length > 0 && !isVentas && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-5">🏆 Ranking de Vendedores</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {top3.map((v, i) => (
              <div key={v.user.id} className={`p-5 rounded-xl border-2 space-y-1 ${i === 0 ? 'border-yellow-300 bg-yellow-50' : i === 1 ? 'border-gray-300 bg-gray-50' : 'border-orange-200 bg-orange-50/60'}`}>
                <div className="text-3xl">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
                <div className="font-bold text-gray-900">{v.user.name}</div>
                <div className="text-xs text-gray-600">{v.cerrados} cierre{v.cerrados !== 1 ? 's' : ''}</div>
                <div className="text-xs font-mono text-blue-700 font-bold">{fmtUF(v.ufVendidas)} UF</div>
                <div className="text-[10px] text-gray-400">
                  Conversión: {v.cotizantes > 0 ? Math.round(v.cerrados / v.cotizantes * 100) : 0}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vendor Matrix Table */}
      {vendorStats.length > 0 && !isVentas && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-bold text-gray-700">Matriz de Vendedores</h3>
            <p className="text-xs text-gray-400 mt-0.5">Clic en una fila para ver los clientes del vendedor.</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendedor</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Cotizantes</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Activos</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Cerrados</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Desistidos</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">UF Vendidas</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {vendorStats.map(v => (
                <React.Fragment key={v.user.id}>
                  <tr
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => toggleVendor(v.user.id)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        {expandedVendors.has(v.user.id)
                          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                        {v.user.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{v.cotizantes}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{v.activos}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-700">{v.cerrados}</td>
                    <td className="px-4 py-3 text-right text-red-500">{v.desistidos}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">{fmtUF(v.ufVendidas)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {v.cotizantes > 0 ? Math.round(v.cerrados / v.cotizantes * 100) : 0}%
                    </td>
                  </tr>
                  {expandedVendors.has(v.user.id) && v.clients.map(c => (
                    <tr key={c.id} className="bg-blue-50/30 border-b border-blue-50">
                      <td className="px-4 py-2 pl-10 text-xs text-gray-700" colSpan={2}>{c.nombre}</td>
                      <td className="px-4 py-2 text-xs text-gray-400 font-mono">{c.rut}</td>
                      <td className="px-4 py-2 text-right text-xs" colSpan={4}>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.estado === 'Cerrado' ? 'bg-green-100 text-green-700'
                          : c.estado === 'Activo' ? 'bg-blue-100 text-blue-700'
                          : c.estado === 'Desistido' ? 'bg-red-100 text-red-600'
                          : 'bg-gray-100 text-gray-500'
                        }`}>{c.estado}</span>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trend Line Chart (SVG) */}
      {trendData.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-4">Tendencia de Clientes Registrados por Mes</h3>
          <div className="overflow-x-auto">
            <svg width={Math.max(trendData.length * 64 + 40, 400)} height={160}>
              {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                const y = 120 - frac * 100;
                return (
                  <React.Fragment key={frac}>
                    <line x1={30} y1={y} x2={Math.max(trendData.length * 64 + 40, 400)} y2={y} stroke="#f3f4f6" strokeWidth={1} />
                    <text x={0} y={y + 4} fontSize={8} fill="#9ca3af">{Math.round(frac * trendMax)}</text>
                  </React.Fragment>
                );
              })}
              <polyline
                fill="none" stroke="#3b82f6" strokeWidth={2}
                points={trendData.map((d, i) => `${34 + i * 64},${120 - (d.cotizantes / trendMax) * 100}`).join(' ')}
              />
              <polyline
                fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray="5,3"
                points={trendData.map((d, i) => `${34 + i * 64},${120 - (d.cerrados / trendMax) * 100}`).join(' ')}
              />
              {trendData.map((d, i) => (
                <React.Fragment key={d.key}>
                  <circle cx={34 + i * 64} cy={120 - (d.cotizantes / trendMax) * 100} r={3} fill="#3b82f6" />
                  <circle cx={34 + i * 64} cy={120 - (d.cerrados / trendMax) * 100} r={3} fill="#10b981" />
                  <text x={34 + i * 64} y={148} textAnchor="middle" fontSize={8} fill="#9ca3af">{d.key}</text>
                </React.Fragment>
              ))}
            </svg>
          </div>
          <div className="flex items-center gap-5 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-5 border-t-2 border-blue-500" />
              <span className="text-xs text-gray-500">Cotizantes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 border-t-2 border-green-500 border-dashed" />
              <span className="text-xs text-gray-500">Cerrados</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
