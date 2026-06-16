import React, { useState, useEffect } from 'react';
import { User, Project, ProjectConfig } from '../types';
import { Plus, Search, Shield, Trash2, Edit2, Check, X, Mail, Briefcase, User as UserIcon, ShieldAlert, CheckSquare, Square, Settings2, AlertCircle, Building } from 'lucide-react';

interface ProfileAdministrationProps {
  users: User[];
  projects?: Project[];
  onAddUser: (user: User) => void;
  onUpdateUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
  currentUser: User;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

// ── P4: Project Configuration Section (full spec) ─────────────────────────
type ProjectCfg = {
  jefeMaxPct: number;
  supervisorMaxPct: number;
  bonoPiePct: number;
  vigenciaCotizacionDias: number;
  // SSilva PDF fields
  reservaCLP: number;
  direccionProyecto: string;
  comunaProyecto: string;
  ciudadProyecto: string;
  nombreInmobiliaria: string;
  cantidadCuotasPie: number;
};
const DEFAULT_CFG: ProjectCfg = {
  jefeMaxPct: 3, supervisorMaxPct: 8, bonoPiePct: 10, vigenciaCotizacionDias: 7,
  reservaCLP: 0, direccionProyecto: '', comunaProyecto: '', ciudadProyecto: '',
  nombreInmobiliaria: '', cantidadCuotasPie: 36,
};

const ProjectConfigSection: React.FC<{
  projects: Project[];
  currentUser: User;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
}> = ({ projects, currentUser, showToast }) => {
  const [configs, setConfigs] = useState<Record<string, ProjectCfg>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    projects.forEach(p => {
      fetch(`/api/projects/${p.id}/config`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then((d: ProjectConfig | null) => {
          setConfigs(prev => ({
            ...prev,
            [p.id]: d ? {
              jefeMaxPct:             d.discountConfig?.jefeMaxPct ?? DEFAULT_CFG.jefeMaxPct,
              supervisorMaxPct:       d.discountConfig?.supervisorMaxPct ?? DEFAULT_CFG.supervisorMaxPct,
              bonoPiePct:             d.bonoPiePct ?? DEFAULT_CFG.bonoPiePct,
              vigenciaCotizacionDias: d.discountConfig?.vigenciaCotizacionDias ?? DEFAULT_CFG.vigenciaCotizacionDias,
              reservaCLP:             d.reservaCLP ?? DEFAULT_CFG.reservaCLP,
              direccionProyecto:      d.direccionProyecto ?? DEFAULT_CFG.direccionProyecto,
              comunaProyecto:         d.comunaProyecto ?? DEFAULT_CFG.comunaProyecto,
              ciudadProyecto:         d.ciudadProyecto ?? DEFAULT_CFG.ciudadProyecto,
              nombreInmobiliaria:     d.nombreInmobiliaria ?? DEFAULT_CFG.nombreInmobiliaria,
              cantidadCuotasPie:      d.cantidadCuotasPie ?? DEFAULT_CFG.cantidadCuotasPie,
            } : (prev[p.id] || DEFAULT_CFG),
          }));
        })
        .catch(() => {});
    });
  }, [projects]);

  const validate = (projectId: string, cfg: ProjectCfg): string => {
    if (cfg.jefeMaxPct >= cfg.supervisorMaxPct) return 'La Banda 1 debe ser menor que la Banda 2';
    if (cfg.jefeMaxPct < 0 || cfg.jefeMaxPct > 30) return 'Banda 1 debe estar entre 0 y 30%';
    if (cfg.supervisorMaxPct < 0 || cfg.supervisorMaxPct > 30) return 'Banda 2 debe estar entre 0 y 30%';
    if (cfg.bonoPiePct < 0 || cfg.bonoPiePct > 99) return '% Bono Pie debe estar entre 0 y 99';
    if (cfg.vigenciaCotizacionDias < 1 || cfg.vigenciaCotizacionDias > 30) return 'Vigencia debe estar entre 1 y 30 días';
    return '';
  };

  const saveConfig = async (projectId: string) => {
    const cfg = configs[projectId] || DEFAULT_CFG;
    const err = validate(projectId, cfg);
    if (err) { setErrors(prev => ({ ...prev, [projectId]: err })); return; }
    setErrors(prev => ({ ...prev, [projectId]: '' }));

    const token = localStorage.getItem('dw_token');
    if (!token) return;
    setSaving(projectId);

    const payload: ProjectConfig = {
      projectId,
      bonoPiePct: cfg.bonoPiePct,
      discountConfig: {
        jefeMaxPct: cfg.jefeMaxPct,
        supervisorMaxPct: cfg.supervisorMaxPct,
        bonoPiePct: cfg.bonoPiePct,
        vigenciaCotizacionDias: cfg.vigenciaCotizacionDias,
      },
      reservaCLP: cfg.reservaCLP,
      direccionProyecto: cfg.direccionProyecto,
      comunaProyecto: cfg.comunaProyecto,
      ciudadProyecto: cfg.ciudadProyecto,
      nombreInmobiliaria: cfg.nombreInmobiliaria,
      cantidadCuotasPie: cfg.cantidadCuotasPie,
    };
    try {
      const res = await fetch(`/api/projects/${projectId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast?.('✓ Configuración guardada');
        setSaved(projectId);
        setTimeout(() => setSaved(null), 2500);
      } else {
        showToast?.('Error al guardar configuración', 'error');
      }
    } catch {
      showToast?.('Error al guardar configuración', 'error');
    }
    setSaving(null);
  };

  const upd = (projectId: string, field: keyof ProjectCfg, value: number) => {
    setConfigs(prev => ({ ...prev, [projectId]: { ...(prev[projectId] || DEFAULT_CFG), [field]: value } }));
    setErrors(prev => ({ ...prev, [projectId]: '' }));
  };

  if (currentUser.role !== 'Admin') return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-bold text-gray-800">Configuración de Proyectos</h3>
        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black uppercase">Admin</span>
      </div>

      {projects.map(p => {
        const cfg = configs[p.id] || DEFAULT_CFG;
        const err = errors[p.id];
        return (
          <div key={p.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
              <Building className="w-5 h-5 text-gray-400" />
              <h4 className="font-bold text-gray-800">{p.nombre}</h4>
            </div>
            <div className="p-6 space-y-6">
              {/* Bandas de descuento */}
              <div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Bandas de Descuento</div>
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <div className="flex-1">
                      <div className="font-bold text-sm text-blue-900 mb-0.5">Banda 1 — Aprueba Jefe de Ventas</div>
                      <div className="text-xs text-blue-600">Hasta este % lo aprueba solo el JefeSala</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.5" min="0" max="30"
                        value={cfg.jefeMaxPct}
                        onChange={e => upd(p.id, 'jefeMaxPct', Number(e.target.value))}
                        className="w-20 px-3 py-2 border border-blue-200 rounded-lg text-sm font-mono text-center outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
                      <span className="text-sm font-bold text-blue-600">%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-orange-50 rounded-xl border border-orange-100">
                    <div className="flex-1">
                      <div className="font-bold text-sm text-orange-900 mb-0.5">Banda 2 — Aprueba Jefe + Supervisor</div>
                      <div className="text-xs text-orange-600">Hasta este % requiere doble visación</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.5" min="0" max="30"
                        value={cfg.supervisorMaxPct}
                        onChange={e => upd(p.id, 'supervisorMaxPct', Number(e.target.value))}
                        className="w-20 px-3 py-2 border border-orange-200 rounded-lg text-sm font-mono text-center outline-none focus:ring-2 focus:ring-orange-300 bg-white" />
                      <span className="text-sm font-bold text-orange-600">%</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100">
                    Sobre <strong>{cfg.supervisorMaxPct}%</strong> no está permitido para vendedores.
                  </div>
                </div>
              </div>

              {/* Simulador hipotecario */}
              <div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Simulador Hipotecario</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">% Bono Pie <span className="text-gray-400 text-xs">(solo Admin)</span></label>
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.5" min="0" max="99"
                        value={cfg.bonoPiePct}
                        onChange={e => upd(p.id, 'bonoPiePct', Number(e.target.value))}
                        className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono text-center outline-none focus:ring-2 focus:ring-blue-100" />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Vigencia cotización</label>
                    <div className="flex items-center gap-2">
                      <input type="number" step="1" min="1" max="30"
                        value={cfg.vigenciaCotizacionDias}
                        onChange={e => upd(p.id, 'vigenciaCotizacionDias', Number(e.target.value))}
                        className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono text-center outline-none focus:ring-2 focus:ring-blue-100" />
                      <span className="text-sm text-gray-500">días</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Cuotas del pie <span className="text-gray-400 text-xs">(cantidad fija)</span></label>
                    <div className="flex items-center gap-2">
                      <input type="number" step="1" min="1" max="120"
                        value={cfg.cantidadCuotasPie}
                        onChange={e => upd(p.id, 'cantidadCuotasPie', Number(e.target.value))}
                        className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono text-center outline-none focus:ring-2 focus:ring-blue-100" />
                      <span className="text-sm text-gray-500">cuotas</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Datos del proyecto para PDF */}
              <div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Datos del Proyecto (PDF Cotización)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Inmobiliaria</label>
                    <input type="text"
                      value={cfg.nombreInmobiliaria}
                      onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || DEFAULT_CFG), nombreInmobiliaria: e.target.value } }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Ej: Inmobiliaria Calle del Peumo" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Reserva CLP <span className="text-gray-400 text-xs">($ pesos)</span></label>
                    <input type="number" step="10000" min="0"
                      value={cfg.reservaCLP}
                      onChange={e => upd(p.id, 'reservaCLP' as keyof ProjectCfg, Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono text-right outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="300000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Dirección</label>
                    <input type="text"
                      value={cfg.direccionProyecto}
                      onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || DEFAULT_CFG), direccionProyecto: e.target.value } }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Av. Ejemplo 1234" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Comuna</label>
                    <input type="text"
                      value={cfg.comunaProyecto}
                      onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || DEFAULT_CFG), comunaProyecto: e.target.value } }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Las Condes" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Ciudad</label>
                    <input type="text"
                      value={cfg.ciudadProyecto}
                      onChange={e => setConfigs(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || DEFAULT_CFG), ciudadProyecto: e.target.value } }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Santiago" />
                  </div>
                </div>
              </div>

              {/* Error + Save */}
              {err && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {err}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={() => saveConfig(p.id)} disabled={saving === p.id}
                  className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2 transition-all">
                  {saving === p.id ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                    saved === p.id ? <Check className="w-4 h-4 text-green-300" /> : <Settings2 className="w-4 h-4" />}
                  {saved === p.id ? '✓ Configuración guardada' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const ProfileAdministration: React.FC<ProfileAdministrationProps> = ({
  users,
  projects = [],
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  currentUser,
  showToast,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Form State
  const [formData, setFormData] = useState<{
      name: string, 
      email: string, 
      company: string, 
      role: 'Admin' | 'Supervisor' | 'Ventas' | 'Lectura' | 'JefeSala',
      assignedProjectIds: string[]
  }>({
    name: '', email: '', company: '', role: 'Ventas', assignedProjectIds: []
  });

  // Reset form when opening modal
  useEffect(() => {
    if (!editingUser) {
        setFormData({ name: '', email: '', company: '', role: 'Ventas', assignedProjectIds: [] });
    } else {
        setFormData({
            name: editingUser.name,
            email: editingUser.email,
            company: editingUser.company || '',
            role: editingUser.role,
            assignedProjectIds: editingUser.assignedProjectIds || []
        });
    }
  }, [editingUser, isModalOpen]);

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingUser) {
      onUpdateUser({
        ...editingUser,
        name: formData.name,
        email: formData.email,
        company: formData.company,
        role: formData.role,
        assignedProjectIds: formData.assignedProjectIds,
      });
      showToast?.('✓ Usuario actualizado');
    } else {
      onAddUser({
        id: crypto.randomUUID(),
        name: formData.name,
        email: formData.email,
        company: formData.company,
        role: formData.role,
        avatar: undefined,
        assignedProjectIds: formData.assignedProjectIds,
      });
      showToast?.('✓ Usuario creado correctamente');
    }
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const toggleProjectAssignment = (projectId: string) => {
      setFormData(prev => {
          const exists = prev.assignedProjectIds.includes(projectId);
          if (exists) {
              return { ...prev, assignedProjectIds: prev.assignedProjectIds.filter(id => id !== projectId) };
          } else {
              return { ...prev, assignedProjectIds: [...prev.assignedProjectIds, projectId] };
          }
      });
  };

  const getRoleBadge = (role: string) => {
    switch(role) {
        case 'Admin': return 'bg-purple-100 text-purple-800 border-purple-200';
        case 'JefeSala': return 'bg-orange-100 text-orange-800 border-orange-200';
        case 'Supervisor': return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'Lectura': return 'bg-gray-100 text-gray-800 border-gray-200';
        default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            Administración de Perfiles
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Gestiona el acceso, roles y asignación de proyectos.
          </p>
        </div>
        <button 
            onClick={() => {
                setEditingUser(null);
                setIsModalOpen(true);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-all"
        >
            <Plus className="w-4 h-4" />
            Nuevo Usuario
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Buscar usuario por nombre o correo..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border-none rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900 outline-none"
          />
        </div>
      </div>

      {/* Users List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
         <div className="overflow-x-auto">
             <table className="min-w-full text-left text-sm">
                 <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase font-semibold border-b border-gray-100 dark:border-gray-700">
                     <tr>
                         <th className="px-6 py-4">Usuario</th>
                         <th className="px-6 py-4">Empresa</th>
                         <th className="px-6 py-4">Rol</th>
                         <th className="px-6 py-4">Proyectos Asignados</th>
                         <th className="px-6 py-4 text-right">Acciones</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                     {filteredUsers.map(user => {
                         const userProjectNames = projects
                            .filter(p => user.assignedProjectIds?.includes(p.id))
                            .map(p => p.nombre);
                         
                         return (
                         <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                             <td className="px-6 py-4">
                                 <div className="flex items-center gap-3">
                                     <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold shadow-sm">
                                         {user.name.charAt(0)}
                                     </div>
                                     <div>
                                         <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                             {user.name}
                                             {user.id === currentUser.id && (
                                                 <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full border border-green-200">Tú</span>
                                             )}
                                         </div>
                                         <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                             <Mail className="w-3 h-3" /> {user.email}
                                         </div>
                                     </div>
                                 </div>
                             </td>
                             <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                                 <div className="flex items-center gap-2">
                                     <Briefcase className="w-4 h-4 text-gray-400" />
                                     {user.company || 'Sin Empresa'}
                                 </div>
                             </td>
                             <td className="px-6 py-4">
                                 <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getRoleBadge(user.role)}`}>
                                     {user.role === 'Admin' && <ShieldAlert className="w-3 h-3 mr-1.5" />}
                                     {user.role}
                                 </span>
                             </td>
                             <td className="px-6 py-4">
                                 {user.role === 'Admin' || user.role === 'Supervisor' ? (
                                     <span className="text-gray-400 text-xs italic">Acceso Total</span>
                                 ) : userProjectNames.length > 0 ? (
                                     <div className="flex flex-wrap gap-1">
                                         {userProjectNames.map((name, i) => (
                                             <span key={i} className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-800">
                                                 {name}
                                             </span>
                                         ))}
                                     </div>
                                 ) : (
                                     <span className="text-red-400 text-xs italic">Sin proyectos</span>
                                 )}
                             </td>
                             <td className="px-6 py-4 text-right">
                                 <div className="flex justify-end gap-2">
                                     <button 
                                        onClick={() => {
                                            setEditingUser(user);
                                            setIsModalOpen(true);
                                        }}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                        title="Editar usuario"
                                     >
                                         <Edit2 className="w-4 h-4" />
                                     </button>
                                     {user.id !== currentUser.id && (
                                         <button
                                            onClick={() => { onDeleteUser(user.id); showToast?.('✓ Usuario eliminado'); }}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                            title="Eliminar usuario"
                                         >
                                             <Trash2 className="w-4 h-4" />
                                         </button>
                                     )}
                                 </div>
                             </td>
                         </tr>
                     )})}
                 </tbody>
             </table>
         </div>
      </div>

      {/* C6: Project Configuration — bonoPiePct */}
      {(currentUser.role === 'Admin' || currentUser.role === 'JefeSala') && projects.length > 0 && (
        <ProjectConfigSection projects={projects} currentUser={currentUser} showToast={showToast} />
      )}

      {/* User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
             <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700/50">
                 <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                     <UserIcon className="w-5 h-5 text-blue-600" />
                     {editingUser ? 'Editar Perfil' : 'Crear Nuevo Usuario'}
                 </h3>
                 <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X className="w-5 h-5" />
                 </button>
             </div>
             
             <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
                 <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre Completo</label>
                     <input 
                        required
                        type="text" 
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                        placeholder="Ej. Ana García"
                     />
                 </div>
                 
                 <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo Electrónico</label>
                     <input 
                        required
                        type="email" 
                        value={formData.email}
                        onChange={e => setFormData({...formData, email: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                        placeholder="ejemplo@empresa.com"
                     />
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                     <div>
                         <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Empresa</label>
                         <input 
                            type="text" 
                            value={formData.company}
                            onChange={e => setFormData({...formData, company: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                            placeholder="Organización"
                         />
                     </div>
                     <div>
                         <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rol / Permisos</label>
                         <select 
                            value={formData.role}
                            onChange={e => setFormData({...formData, role: e.target.value as any})}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-gray-700 dark:text-white"
                         >
                             <option value="Admin">Administrador</option>
                             <option value="JefeSala">Jefe de Sala</option>
                             <option value="Supervisor">Supervisor</option>
                             <option value="Ventas">Vendedor</option>
                             <option value="Lectura">Lectura (Solo Ver)</option>
                         </select>
                     </div>
                 </div>

                 {/* Project Assignment Section */}
                 {(formData.role === 'Ventas' || formData.role === 'JefeSala' || formData.role === 'Supervisor' || formData.role === 'Lectura') && (
                     <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl border border-gray-200 dark:border-gray-600">
                         <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">Asignar Proyectos</label>
                         <div className="space-y-2 max-h-32 overflow-y-auto">
                             {projects.length === 0 && <p className="text-sm text-gray-400 italic">No hay proyectos creados.</p>}
                             {projects.map(project => {
                                 const isAssigned = formData.assignedProjectIds.includes(project.id);
                                 return (
                                     <div 
                                        key={project.id} 
                                        onClick={() => toggleProjectAssignment(project.id)}
                                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer border transition-colors
                                            ${isAssigned 
                                                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' 
                                                : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}
                                        `}
                                     >
                                         <div className={`text-blue-600 dark:text-blue-400 ${isAssigned ? 'opacity-100' : 'opacity-40'}`}>
                                             {isAssigned ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                         </div>
                                         <span className={`text-sm ${isAssigned ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                             {project.nombre}
                                         </span>
                                     </div>
                                 );
                             })}
                         </div>
                     </div>
                 )}

                 {formData.role === 'Admin' && (
                     <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg flex gap-2 items-start text-xs text-purple-800 dark:text-purple-300 border border-purple-100 dark:border-purple-800">
                         <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                         <span>
                             Cuidado: Los administradores tienen acceso completo al sistema, incluyendo la bitácora y la gestión de otros usuarios.
                         </span>
                     </div>
                 )}

                 <div className="pt-4 flex gap-3">
                     <button 
                        type="button" 
                        onClick={() => setIsModalOpen(false)}
                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
                     >
                         Cancelar
                     </button>
                     <button 
                        type="submit" 
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                     >
                         <Check className="w-4 h-4" />
                         {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
                     </button>
                 </div>
             </form>
          </div>
        </div>
      )}

    </div>
  );
};
