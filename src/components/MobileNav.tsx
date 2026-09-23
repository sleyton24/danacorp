import React, { useEffect, useState } from 'react';
import {
  Users, Building, Tag, PieChart, ClipboardList, Shield, Bell, Calculator,
  Download, LogOut, CheckSquare, TrendingUp, Archive, Settings, ChevronDown,
  PlusCircle, Menu, X,
} from 'lucide-react';
import { Project, User } from '../types';

type AppView =
  | 'clients' | 'inventory' | 'prices' | 'create_project' | 'manage_projects'
  | 'summary' | 'settings' | 'audit' | 'profile_admin' | 'quoter'
  | 'notifications' | 'downloads' | 'approvals' | 'performance';

interface MobileNavProps {
  currentView: string;
  onChangeView: (view: AppView) => void;
  projects: Project[];
  currentProjectId: string | null;
  onSelectProject: (id: string) => void;
  currentUser: User;
  unreadNotificationsCount?: number;
  pendingApprovalsCount?: number;
  onLogout?: () => void;
}

type NavItem = {
  id: AppView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PRIMARY: NavItem[] = [
  { id: 'inventory', label: 'Unidades', icon: Building },
  { id: 'quoter', label: 'Cotizar', icon: Calculator },
  { id: 'clients', label: 'Clientes', icon: Users },
];

/**
 * Misma visibilidad que Sidebar.tsx. No se extrajo de ahí para no tocar el markup
 * de escritorio; si cambia un rol en el sidebar, hay que reflejarlo acá.
 */
function canSee(role: string, id: string): boolean {
  if (['audit', 'downloads', 'profile_admin', 'manage_projects', 'create_project'].includes(id)) {
    return role === 'Admin';
  }
  if (id === 'approvals') return ['JefeSala', 'Supervisor', 'Admin'].includes(role);
  if (id === 'performance') return role !== 'Lectura';
  if (id === 'summary') return role !== 'Ventas';
  if (role === 'Ventas') {
    return ['quoter', 'clients', 'prices', 'inventory', 'notifications', 'settings'].includes(id);
  }
  return true;
}

export const MobileNav: React.FC<MobileNavProps> = ({
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [currentView, currentProjectId]);

  const go = (view: AppView) => {
    setMenuOpen(false);
    onChangeView(view);
  };

  const proyectosActivos = projects.filter(p => !p.archivado);
  const proyectosTerminados = projects.filter(p => p.archivado);
  const primary = PRIMARY.filter(item => canSee(currentUser.role, item.id));
  const onPrimary = primary.some(item => item.id === currentView);
  const moreBadge = unreadNotificationsCount + pendingApprovalsCount;

  const moreCatalog: Array<NavItem & { badge?: number }> = [
    { id: 'notifications', label: 'Notificaciones', icon: Bell, badge: unreadNotificationsCount },
    { id: 'summary', label: 'Resumen', icon: PieChart },
    { id: 'prices', label: 'Lista de precios', icon: Tag },
    { id: 'approvals', label: 'Aprobaciones', icon: CheckSquare, badge: pendingApprovalsCount },
    { id: 'performance', label: 'Performance', icon: TrendingUp },
    { id: 'audit', label: 'Bitácora', icon: ClipboardList },
    { id: 'downloads', label: 'Descargas', icon: Download },
    { id: 'profile_admin', label: 'Admin. perfiles', icon: Shield },
    { id: 'manage_projects', label: 'Admin. proyectos', icon: Archive },
  ];
  const moreItems = moreCatalog.filter(item => canSee(currentUser.role, item.id));

  return (
    <>
      <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-white border-b border-gray-200 pt-[env(safe-area-inset-top)]">
        <div className="h-14 px-3 flex items-center gap-2">
          <img
            src="/Danacorp.png"
            alt="Danacorp"
            className="h-8 w-auto max-w-[88px] object-contain shrink-0"
          />
          {projects.length > 0 ? (
            <div className="relative flex-1 min-w-0">
              <select
                aria-label="Proyecto actual"
                value={currentProjectId || ''}
                onChange={(e) => e.target.value === 'NEW' ? go('create_project') : onSelectProject(e.target.value)}
                className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-800 text-sm font-bold rounded-xl pl-3 pr-8 min-h-[44px] outline-none"
              >
                {proyectosActivos.length > 0 && (
                  <optgroup label="Activos">
                    {proyectosActivos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </optgroup>
                )}
                {proyectosTerminados.length > 0 && (
                  <optgroup label="Terminados (solo consulta)">
                    {proyectosTerminados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </optgroup>
                )}
                {currentUser.role === 'Admin' && <option value="NEW">+ Nuevo proyecto</option>}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          ) : currentUser.role === 'Admin' ? (
            <button
              onClick={() => go('create_project')}
              className="flex-1 min-h-[44px] bg-blue-600 text-white text-sm font-bold rounded-xl px-3 flex items-center justify-center gap-2"
            >
              <PlusCircle className="w-4 h-4" /> Crear proyecto
            </button>
          ) : (
            <span className="flex-1 text-sm text-gray-400 truncate">Sin proyecto</span>
          )}
        </div>
      </header>

      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 shrink-0">
              <span className="text-sm font-black text-gray-800 uppercase tracking-wider">Menú</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-500"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-2">
              {moreItems.map(item => {
                const Icon = item.icon;
                const active = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    className={`w-full min-h-[48px] flex items-center justify-between px-3 rounded-xl text-sm font-medium ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
                      {item.label}
                    </span>
                    {!!item.badge && item.badge > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{item.badge}</span>
                    )}
                  </button>
                );
              })}
              <div className="mt-2 border-t border-gray-100 pt-2">
                <button
                  type="button"
                  onClick={() => go('settings')}
                  className={`w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl text-sm font-medium ${currentView === 'settings' ? 'bg-gray-100' : 'text-gray-700'}`}
                >
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                    {currentUser.name.charAt(0)}
                  </div>
                  <span className="flex-1 text-left min-w-0">
                    <span className="block truncate font-bold">{currentUser.name}</span>
                    <span className="block text-[11px] text-gray-400">{currentUser.role}</span>
                  </span>
                  <Settings className="w-4 h-4 text-gray-400" />
                </button>
                {onLogout && (
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onLogout(); }}
                    className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-red-600"
                  >
                    <LogOut className="w-5 h-5" />
                    Cerrar sesión
                  </button>
                )}
              </div>
            </nav>
          </div>
        </div>
      )}

      <nav
        aria-label="Navegación principal"
        className="md:hidden fixed bottom-0 inset-x-0 z-[60] bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="h-16 grid" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
          {primary.map(item => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-bold ${active ? 'text-blue-600' : 'text-gray-500'}`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-bold ${menuOpen || !onPrimary ? 'text-blue-600' : 'text-gray-500'}`}
            aria-expanded={menuOpen}
          >
            <Menu className="w-5 h-5" />
            Más
            {moreBadge > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-22px)] min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {moreBadge > 9 ? '9+' : moreBadge}
              </span>
            )}
          </button>
        </div>
      </nav>
    </>
  );
};
