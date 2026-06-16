import React from 'react';
import { Users, Settings, Building, Tag, ChevronDown, PlusCircle, PieChart, ClipboardList, Shield, Bell, Calculator, Download, LogOut, CheckSquare, TrendingUp } from 'lucide-react';
import { Project, User } from '../types';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: 'clients' | 'inventory' | 'prices' | 'create_project' | 'summary' | 'settings' | 'audit' | 'profile_admin' | 'quoter' | 'notifications' | 'downloads' | 'approvals' | 'performance') => void;
  projects: Project[];
  currentProjectId: string | null;
  onSelectProject: (id: string) => void;
  currentUser: User;
  unreadNotificationsCount?: number;
  pendingApprovalsCount?: number;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onChangeView,
  projects,
  currentProjectId,
  onSelectProject,
  currentUser,
  unreadNotificationsCount = 0,
  pendingApprovalsCount = 0,
  onLogout,
}) => {
  const menuItems = [
    { id: 'summary', label: 'Resumen', icon: PieChart, adminOnly: false },
    { id: 'quoter', label: 'Cotizador', icon: Calculator, adminOnly: false },
    { id: 'clients', label: 'Clientes', icon: Users, adminOnly: false },
    { id: 'inventory', label: 'Inventario', icon: Building, adminOnly: false },
    { id: 'prices', label: 'Lista de precios', icon: Tag, adminOnly: false },
    { id: 'audit', label: 'Bitácora', icon: ClipboardList, adminOnly: true },
  ];

  const adminItems = [
      { id: 'downloads', label: 'Descargas', icon: Download, adminOnly: true },
      { id: 'profile_admin', label: 'Admin. perfiles', icon: Shield, adminOnly: true },
  ];

  const isDisabled = !currentProjectId && projects.length === 0;

  return (
    <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 h-screen hidden md:flex flex-col fixed left-0 top-0 z-20">
      <div className="px-3 py-2 h-16 flex items-center">
        <div className="flex items-center justify-center px-2 py-1 bg-white rounded-lg h-14 overflow-hidden w-full">
          <img
            src="/Danacorp.png"
            alt="Danacorp"
            className="max-h-full max-w-full object-contain"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              img.parentElement!.innerHTML = '<span class="font-bold text-blue-600">DANACORP</span>';
            }}
          />
        </div>
      </div>

      <div className="px-4 pb-4 border-b border-gray-100 dark:border-gray-700">
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 block px-2">Proyecto actual</label>
        {projects.length > 0 ? (
          <div className="relative group">
            <select
              value={currentProjectId || ''}
              onChange={(e) => e.target.value === 'NEW' ? onChangeView('create_project') : onSelectProject(e.target.value)}
              className="w-full appearance-none bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-white text-sm font-bold rounded-lg pl-3 pr-8 py-2.5 outline-none cursor-pointer"
            >
              {projects.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option disabled>──────────</option>
              {currentUser.role === 'Admin' && <option value="NEW">+ Nuevo proyecto</option>}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        ) : (
           currentUser.role === 'Admin' && (
             <button onClick={() => onChangeView('create_project')} className="w-full bg-blue-600 text-white text-sm font-medium rounded-lg px-3 py-2.5 flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors">
               <PlusCircle className="w-4 h-4" /> Crear proyecto
             </button>
           )
        )}
      </div>

      <nav className="flex-1 p-4 flex flex-col overflow-y-auto">
        <div className="space-y-1">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-4 mt-2">Gestión</div>
            <button
                onClick={() => onChangeView('notifications')}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium rounded-lg transition-all ${currentView === 'notifications' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                <div className="flex items-center gap-3"><Bell className="w-5 h-5" /> Notificaciones</div>
                {unreadNotificationsCount > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{unreadNotificationsCount}</span>}
            </button>
            {menuItems.map((item) => {
              if (item.adminOnly && currentUser.role !== 'Admin') return null;
              if (currentUser.role === 'Ventas' && !['quoter', 'clients', 'prices', 'inventory'].includes(item.id)) return null;
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                  <button key={item.id} disabled={isDisabled} onClick={() => onChangeView(item.id as any)} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${isActive ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} /> {item.label}
                  </button>
              );
            })}
            {/* Approvals: visible para JefeSala, Supervisor (User), Admin */}
            {['JefeSala', 'Supervisor', 'Admin'].includes(currentUser.role) && (
              <button
                onClick={() => onChangeView('approvals')}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium rounded-lg transition-all ${currentView === 'approvals' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-3">
                  <CheckSquare className={`w-5 h-5 ${currentView === 'approvals' ? 'text-blue-600' : 'text-gray-400'}`} />
                  Aprobaciones
                </div>
                {pendingApprovalsCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>
            )}
            {/* Performance: visible para todos excepto Lectura */}
            {currentUser.role !== 'Lectura' && (
              <button
                onClick={() => onChangeView('performance')}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${currentView === 'performance' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <TrendingUp className={`w-5 h-5 ${currentView === 'performance' ? 'text-blue-600' : 'text-gray-400'}`} />
                Performance
              </button>
            )}
        </div>
        <div className="flex-1"></div>
        {currentUser.role === 'Admin' && (
             <div className="mt-4 space-y-1 border-t border-gray-100 pt-4">
                 <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-4">Administración</div>
                 {adminItems.map(item => {
                     const Icon = item.icon;
                     const isActive = currentView === item.id;
                     return (
                        <button key={item.id} onClick={() => onChangeView(item.id as any)} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${isActive ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                            <Icon className={`w-5 h-5 ${isActive ? 'text-purple-600' : 'text-gray-400'}`} /> {item.label}
                        </button>
                     );
                 })}
             </div>
        )}
      </nav>

      <div className="p-4 border-t border-gray-100 space-y-1">
        <button onClick={() => onChangeView('settings')} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg ${currentView === 'settings' ? 'bg-gray-100' : 'text-gray-600 hover:bg-gray-50'}`}>
          <div className="flex items-center gap-2 flex-1">
             <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">{currentUser.name.charAt(0)}</div>
             <div className="flex flex-col items-start overflow-hidden">
                 <span className="truncate text-xs font-bold w-32 text-left">{currentUser.name}</span>
                 <span className="text-[10px] text-gray-400">{currentUser.role}</span>
             </div>
          </div>
          <Settings className="w-4 h-4 text-gray-400" />
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg text-red-500 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </button>
        )}
      </div>
    </div>
  );
};
