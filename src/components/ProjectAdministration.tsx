import React, { useState } from 'react';
import { Project } from '../types';
import { Lock, Unlock, Trash2, AlertTriangle, X, Building, Users, Loader2 } from 'lucide-react';

interface ProjectAdministrationProps {
  projects: Project[];
  currentProjectId: string | null;
  /** Refresca proyectos/unidades/clientes desde el servidor tras archivar o eliminar. */
  onRefresh: () => Promise<void> | void;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

export const ProjectAdministration: React.FC<ProjectAdministrationProps> = ({
  projects,
  currentProjectId,
  onRefresh,
  showToast,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  // Proyecto en confirmación de borrado + texto tipeado por el usuario.
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [confirmText, setConfirmText] = useState('');
  // Reabrir descongela un proyecto cerrado, asi que pide confirmacion. Terminar no: es
  // reversible y no destructivo. El motivo esta documentado en el commit del hallazgo.
  const [reabriendo, setReabriendo] = useState<Project | null>(null);

  const activos = projects.filter(p => !p.archivado);
  const archivados = projects.filter(p => p.archivado);

  const token = () => localStorage.getItem('dw_token') || '';

  const toggleArchivado = async (project: Project) => {
    const archivar = !project.archivado;
    // Sin esto el usuario puede archivar el último proyecto activo y quedarse sin selector.
    if (archivar && activos.length === 1) {
      showToast?.('No puedes terminar el único proyecto activo', 'warning');
      return;
    }
    setBusyId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}/archivar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ archivado: archivar }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setReabriendo(null);
      await onRefresh();
      showToast?.(archivar ? `"${project.nombre}" marcado como terminado` : `"${project.nombre}" reabierto para edición`);
    } catch {
      showToast?.('Error al cambiar el estado del proyecto', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmarEliminar = async () => {
    if (!deleting || confirmText !== deleting.nombre) return;
    setBusyId(deleting.id);
    try {
      const res = await fetch(`/api/projects/${deleting.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const nombre = deleting.nombre;
      setDeleting(null);
      setConfirmText('');
      await onRefresh();
      showToast?.(`Proyecto "${nombre}" eliminado`);
    } catch {
      showToast?.('Error al eliminar el proyecto', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const Fila: React.FC<{ project: Project }> = ({ project }) => {
    const esActual = project.id === currentProjectId;
    const ocupado = busyId === project.id;
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-100 dark:border-gray-700 last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900 dark:text-white truncate">{project.nombre}</span>
            {esActual && (
              <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold uppercase">Actual</span>
            )}
            {project.archivado && (
              <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold uppercase">Terminado</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Building className="w-3.5 h-3.5" /> {project.unidadesCount ?? 0} unidades</span>
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {project.clientesCount ?? 0} clientes</span>
            <span>Creado: {project.fechaCreacion}</span>
          </div>
          {project.archivado && project.archivadoPor && (
            <p className="text-[11px] text-amber-700 mt-1">
              Terminado por {project.archivadoPor}
              {project.archivadoAt ? ` el ${new Date(project.archivadoAt).toLocaleDateString('es-CL')}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => project.archivado ? setReabriendo(project) : toggleArchivado(project)}
            disabled={ocupado}
            title={project.archivado ? 'Reabrir para volver a editar (pide confirmacion)' : 'Marcar como terminado: queda en solo lectura'}
            className={`px-3 py-2 text-sm font-medium rounded-lg border disabled:opacity-50 flex items-center gap-2 transition-colors ${project.archivado
              ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" />
              : project.archivado ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {project.archivado ? 'Reabrir' : 'Terminar'}
          </button>
          {/* Flujo obligatorio de dos pasos: el backend responde 409 si el proyecto no está
              terminado, así que el botón se deshabilita en vez de producir un error confuso. */}
          <button
            onClick={() => { setDeleting(project); setConfirmText(''); }}
            disabled={ocupado || !project.archivado}
            title={project.archivado ? 'Eliminar definitivamente' : 'Primero marca el proyecto como terminado'}
            className="px-3 py-2 text-sm font-medium rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Eliminar
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 animate-fade-in">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Administrar proyectos</h2>
        <p className="text-sm text-gray-500 mt-1">
          Terminar deja el proyecto en solo lectura: se sigue consultando y se pueden descargar sus reportes, pero no admite cambios. Es reversible.
          Eliminar borra el proyecto y todo lo que contiene, de forma permanente.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">Activos ({activos.length})</h3>
        </div>
        {activos.length === 0
          ? <p className="p-4 text-sm text-gray-500">No hay proyectos activos.</p>
          : activos.map(p => <Fila key={p.id} project={p} />)}
      </div>

      {archivados.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">Terminados ({archivados.length})</h3>
          </div>
          {archivados.map(p => <Fila key={p.id} project={p} />)}
        </div>
      )}

      {reabriendo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <Unlock className="w-5 h-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">¿Reabrir el proyecto?</h3>
                <p className="text-sm text-gray-500 mt-1">{reabriendo.nombre}</p>
              </div>
              <button onClick={() => setReabriendo(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
              Vuelve a admitir cambios: se podrán editar unidades y precios, asignar clientes y
              emitir cotizaciones nuevas. Deja de estar en solo lectura.
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReabriendo(null)}
                className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => toggleArchivado(reabriendo)}
                disabled={busyId === reabriendo.id}
                className="px-5 py-2.5 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 disabled:opacity-40 flex items-center gap-2"
              >
                {busyId === reabriendo.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                Sí, reabrir
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">Eliminar proyecto</h3>
                <p className="text-sm text-gray-500 mt-1">Esta acción no se puede deshacer.</p>
              </div>
              <button onClick={() => { setDeleting(null); setConfirmText(''); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4 text-sm text-red-800">
              <p className="font-bold mb-2">Se eliminará permanentemente:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>{deleting.unidadesCount ?? 0} unidades</li>
                <li>{deleting.clientesCount ?? 0} clientes</li>
                <li>Cotizaciones, planes de pago, solicitudes de descuento y aprobaciones</li>
                <li>Historial de precios y configuración del proyecto</li>
              </ul>
            </div>

            <label className="block text-sm text-gray-700 dark:text-gray-200 mb-2">
              Escribe <span className="font-bold">{deleting.nombre}</span> para confirmar:
            </label>
            <input
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && confirmText === deleting.nombre) void confirmarEliminar(); }}
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-red-500 mb-4"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setDeleting(null); setConfirmText(''); }}
                className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarEliminar}
                disabled={confirmText !== deleting.nombre || busyId === deleting.id}
                className="px-5 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {busyId === deleting.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
