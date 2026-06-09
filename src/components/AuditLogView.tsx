import React, { useState } from 'react';
import { AuditLogEntry } from '../types';
import { Search, Clock, ShieldAlert, Filter } from 'lucide-react';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSection, setFilterSection] = useState('Todas');

  const filteredLogs = logs.filter(log => {
      const matchesSearch = log.userName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (log.target && log.target.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesSection = filterSection === 'Todas' || log.section === filterSection;
      return matchesSearch && matchesSection;
  });

  const sections = Array.from(new Set(logs.map(l => l.section)));

  return (
    <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2"><ShieldAlert className="w-6 h-6 text-purple-600" /> Bitácora de Sistema</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Auditoría cronológica de cambios y acciones operacionales.</p>
            </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input type="text" placeholder="Buscar por usuario, acción o unidad..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border-none rounded-xl text-sm focus:ring-2 focus:ring-purple-100 outline-none" />
            </div>
            <div className="relative w-full md:w-64">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)} className="w-full pl-9 pr-10 py-3 border-none rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white text-sm appearance-none focus:ring-2 focus:ring-purple-100 outline-none font-bold text-gray-600"><option value="Todas">Todas las Secciones</option>{sections.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <Clock className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
            </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700 font-semibold text-gray-600 dark:text-gray-300">
                            <th className="px-6 py-3">Fecha / Hora</th>
                            <th className="px-6 py-3">Usuario</th>
                            <th className="px-6 py-3 text-center">Acción</th>
                            <th className="px-6 py-3">Objetivo</th>
                            <th className="px-6 py-3">Detalle</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {filteredLogs.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic">No se registran eventos.</td></tr>
                        ) : filteredLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors">
                                <td className="px-6 py-4 text-gray-500 dark:text-gray-400 font-mono text-[10px] font-bold whitespace-nowrap">{new Date(log.timestamp).toLocaleDateString('es-CL')} <br/> {new Date(log.timestamp).toLocaleTimeString('es-CL')}</td>
                                <td className="px-6 py-4 font-bold text-gray-900 dark:text-white text-base">{log.userName}</td>
                                <td className="px-6 py-4 text-center"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${log.action === 'Eliminar' ? 'bg-red-50 text-red-700 border-red-100' : log.action === 'Crear' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>{log.action}</span></td>
                                <td className="px-6 py-4"><span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] font-bold border border-purple-100 dark:border-purple-800">{log.target || 'Global'}</span></td>
                                <td className="px-6 py-4 text-gray-600 dark:text-gray-400 italic text-xs leading-relaxed max-w-xs">{log.details}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
};