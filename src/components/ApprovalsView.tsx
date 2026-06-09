import React, { useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import {
  CheckSquare, Check, X, Clock, AlertTriangle, ChevronDown,
  RefreshCw, User as UserIcon, Building, Percent,
} from 'lucide-react';

interface DiscountRow {
  id: string;
  project_id: string;
  unit_id: string;
  unit_numero: string;
  vendedor_id: string;
  vendedor_nombre: string;
  cotizacion_id: string | null;
  precio_original: number;
  precio_solicitado: number;
  descuento_pct: number;
  descuento_monto: number;
  estado: 'Pendiente' | 'AprobadoJefe' | 'Aprobado' | 'Rechazado' | 'Cancelado';
  aprobado_jefe_id: string | null;
  aprobado_jefe_at: string | null;
  aprobado_supervisor_id: string | null;
  aprobado_supervisor_at: string | null;
  rechazado_por_id: string | null;
  rechazo_motivo: string | null;
  created_at: string;
}

interface ApprovalsViewProps {
  currentUser: User;
}

type FilterType = 'pending' | 'approved' | 'rejected' | 'all';

const formatUF = (v: number) => v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatDate = (s: string | null) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({ currentUser }) => {
  const [requests, setRequests] = useState<DiscountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('pending');
  const [rejectModal, setRejectModal] = useState<{ id: string; unitNumero: string } | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  const token = () => localStorage.getItem('dw_token');

  const fetchRequests = useCallback(async () => {
    const t = token();
    if (!t) return;
    try {
      const res = await fetch('/api/discount-requests/pending', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) setRequests(await res.json() as DiscountRow[]);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleApprove = async (id: string) => {
    const t = token();
    if (!t) return;
    setProcessing(id);
    try {
      const res = await fetch(`/api/discount-requests/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json() as { estado: string };
        setRequests(prev => prev.map(r =>
          r.id === id ? { ...r, estado: data.estado as DiscountRow['estado'] } : r,
        ));
      }
    } catch { /* silencioso */ }
    finally { setProcessing(null); }
  };

  const handleReject = async () => {
    if (!rejectModal || !rejectMotivo.trim()) return;
    const t = token();
    if (!t) return;
    setProcessing(rejectModal.id);
    try {
      const res = await fetch(`/api/discount-requests/${rejectModal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ motivo: rejectMotivo }),
      });
      if (res.ok) {
        setRequests(prev => prev.map(r =>
          r.id === rejectModal.id ? { ...r, estado: 'Rechazado', rechazo_motivo: rejectMotivo } : r,
        ));
        setRejectModal(null);
        setRejectMotivo('');
      }
    } catch { /* silencioso */ }
    finally { setProcessing(null); }
  };

  const filteredRequests = requests.filter(r => {
    if (filter === 'pending') return r.estado === 'Pendiente' || r.estado === 'AprobadoJefe';
    if (filter === 'approved') return r.estado === 'Aprobado';
    if (filter === 'rejected') return r.estado === 'Rechazado';
    return true;
  });

  const pendingCount = requests.filter(r => r.estado === 'Pendiente' || r.estado === 'AprobadoJefe').length;

  const subtitle = currentUser.role === 'JefeSala'
    ? 'Descuentos que requieren tu visación'
    : currentUser.role === 'Supervisor'
    ? 'Descuentos visados por Jefe, pendientes tu aprobación'
    : 'Todas las solicitudes de descuento';

  const canApprove = (r: DiscountRow) => {
    if (currentUser.role === 'Admin') return r.estado !== 'Cancelado';
    if (currentUser.role === 'JefeSala') return r.estado === 'Pendiente';
    if (currentUser.role === 'Supervisor') return r.estado === 'AprobadoJefe';
    return false;
  };

  const canReject = (r: DiscountRow) =>
    ['Admin', 'JefeSala', 'Supervisor'].includes(currentUser.role) &&
    !['Aprobado', 'Cancelado', 'Rechazado'].includes(r.estado);

  const estadoBadge = (r: DiscountRow) => {
    switch (r.estado) {
      case 'Pendiente':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full"><Clock className="w-3 h-3" /> Pendiente</span>;
      case 'AprobadoJefe':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full"><Check className="w-3 h-3" /> Visado Jefe</span>;
      case 'Aprobado':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full"><Check className="w-3 h-3" /> Aprobado</span>;
      case 'Rechazado':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full"><X className="w-3 h-3" /> Rechazado</span>;
      case 'Cancelado':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-bold rounded-full">Cancelado</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-1">Rechazar descuento</h3>
              <p className="text-sm text-gray-500">Unidad {rejectModal.unitNumero}</p>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Motivo del rechazo <span className="text-red-500">*</span></label>
              <textarea
                value={rejectMotivo}
                onChange={e => setRejectMotivo(e.target.value)}
                placeholder="Explica brevemente por qué se rechaza..."
                rows={3}
                className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-100 resize-none text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setRejectModal(null); setRejectMotivo(''); }}
                className="flex-1 py-2.5 border border-gray-200 font-bold rounded-xl text-gray-600 hover:bg-gray-50 transition-all">
                Cancelar
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectMotivo.trim() || processing === rejectModal.id}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                {processing === rejectModal.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-blue-600" /> Bandeja de Aprobaciones
          </h2>
          <p className="text-gray-500 text-sm mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-black px-3 py-1 rounded-full">
              {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
            </span>
          )}
          <button onClick={fetchRequests}
            className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all text-gray-500">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['pending', 'approved', 'rejected', 'all'] as FilterType[]).map(f => {
          const labels: Record<FilterType, string> = {
            pending: 'Pendientes', approved: 'Aprobados', rejected: 'Rechazados', all: 'Todos',
          };
          const count = f === 'pending' ? pendingCount :
            f === 'all' ? requests.length :
            requests.filter(r => f === 'approved' ? r.estado === 'Aprobado' : r.estado === 'Rechazado').length;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-bold rounded-xl transition-all ${filter === f ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {labels[f]} {count > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${filter === f ? 'bg-white/20' : 'bg-gray-100'}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-3 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Cargando...</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 space-y-2">
            <CheckSquare className="w-8 h-8 opacity-40" />
            <p className="text-sm font-medium">No hay solicitudes {filter !== 'all' ? 'en esta categoría' : ''}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Vendedor', 'Unidad', 'Descuento', 'P. Original', 'P. Solicitado', 'Estado', 'Fecha', 'Acciones'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRequests.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-xs">
                          {r.vendedor_nombre?.charAt(0) || 'V'}
                        </div>
                        <span className="font-medium text-gray-800 text-xs">{r.vendedor_nombre || r.vendedor_id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-gray-800 font-bold text-xs">
                        <Building className="w-3.5 h-3.5 text-gray-400" /> {r.unit_numero}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-red-600 font-black text-sm">
                        <Percent className="w-3.5 h-3.5" /> {r.descuento_pct.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono">-{formatUF(r.descuento_monto)} UF</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700 text-xs">{formatUF(r.precio_original)}</td>
                    <td className="px-4 py-3 font-mono text-blue-700 font-bold text-xs">{formatUF(r.precio_solicitado)}</td>
                    <td className="px-4 py-3">
                      {estadoBadge(r)}
                      {r.estado === 'AprobadoJefe' && (
                        <div className="text-[10px] text-blue-500 mt-1">Visado: {formatDate(r.aprobado_jefe_at)}</div>
                      )}
                      {r.estado === 'Aprobado' && r.aprobado_supervisor_at && (
                        <div className="text-[10px] text-green-500 mt-1">Aprobado: {formatDate(r.aprobado_supervisor_at)}</div>
                      )}
                      {r.estado === 'Rechazado' && r.rechazo_motivo && (
                        <div className="text-[10px] text-red-500 mt-1 max-w-[120px] truncate" title={r.rechazo_motivo}>
                          "{r.rechazo_motivo}"
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {canApprove(r) && (
                          <button onClick={() => handleApprove(r.id)} disabled={processing === r.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-all">
                            {processing === r.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Aprobar
                          </button>
                        )}
                        {canReject(r) && (
                          <button
                            onClick={() => { setRejectModal({ id: r.id, unitNumero: r.unit_numero }); setRejectMotivo(''); }}
                            disabled={processing === r.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 disabled:opacity-50 transition-all">
                            <X className="w-3 h-3" /> Rechazar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
