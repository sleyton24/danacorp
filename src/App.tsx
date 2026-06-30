import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Client, RealEstateUnit, Project, User, AuditLogEntry, Notification as AppNotification } from './types';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './components/LoginScreen';
import { ClientList } from './components/ClientList';
import { UnitList } from './components/UnitList';
import { UnitDetail } from './components/UnitDetail';
import { PriceManager } from './components/PriceManager';
import { ProjectCreationWizard } from './components/ProjectCreationWizard';
import { SummaryDashboard } from './components/SummaryDashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { NotificationsView } from './components/NotificationsView';

const AuditLogView = React.lazy(() =>
  import('./components/AuditLogView').then(m => ({ default: m.AuditLogView })));
const ProfileAdministration = React.lazy(() =>
  import('./components/ProfileAdministration').then(m => ({ default: m.ProfileAdministration })));
const DownloadsView = React.lazy(() =>
  import('./components/DownloadsView').then(m => ({ default: m.DownloadsView })));
const ApprovalsView = React.lazy(() =>
  import('./components/ApprovalsView').then(m => ({ default: m.ApprovalsView })));
const SalesPerformanceView = React.lazy(() =>
  import('./components/SalesPerformanceView').then(m => ({ default: m.SalesPerformanceView })));
import { Shield, User as UserIcon, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { ToastContainer, ToastMessage } from './components/Toast';

// Lazy-loaded heavy module — jsPDF only downloads when user opens the Quoter
const Quoter = React.lazy(() => import('./components/Quoter').then(m => ({ default: m.Quoter })));

const LazyFallback = () => (
  <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
    <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
    <span>Cargando...</span>
  </div>
);



const defaultUsers: User[] = [
  { id: 'u1', name: 'Administrador Principal', email: 'admin@danacorp.cl',     role: 'Admin',      company: 'Danacorp' },
  { id: 'u3', name: 'Jefe de Sala',            email: 'jefe@danacorp.cl',      role: 'JefeSala',   company: 'Sala de Ventas',  assignedProjectIds: ['p1'] },
  { id: 'u5', name: 'Supervisor Demo',          email: 'supervisor@danacorp.cl', role: 'Supervisor', company: 'Danacorp',        assignedProjectIds: ['p1'] },
  { id: 'u2', name: 'Vendedor Demo',            email: 'vendedor@danacorp.cl',  role: 'Ventas',     company: 'Danacorp Ventas', assignedProjectIds: ['p1'] },
];


const App: React.FC = () => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const tokenRef = useRef<string>('');

  // ── App State ─────────────────────────────────────────────────────────────
  const [currentView, setCurrentView] = useState<'clients' | 'inventory' | 'prices' | 'create_project' | 'summary' | 'settings' | 'audit' | 'profile_admin' | 'quoter' | 'notifications' | 'downloads' | 'approvals' | 'performance'>('summary');
  const [clients, setClients] = useState<Client[]>([]);
  const [units, setUnits] = useState<RealEstateUnit[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>(defaultUsers);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<RealEstateUnit | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [isSimulatorExpanded, setIsSimulatorExpanded] = useState(false);

  // ── Toast notifications ───────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = (message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev.slice(-2), { id, type, message }]);
  };
  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // ── Auth: Restaurar sesión al montar ─────────────────────────────────────
  useEffect(() => {
    const storedToken = localStorage.getItem('dw_token');
    if (!storedToken) { setAuthLoading(false); return; }
    tokenRef.current = storedToken;
    fetch('/api/me', { headers: { Authorization: `Bearer ${storedToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then((data: { user: User } | null) => {
        if (!data?.user) {
          localStorage.removeItem('dw_token');
          localStorage.removeItem('dw_user');
          tokenRef.current = '';
          setAuthLoading(false);
          return;
        }
        setCurrentUser(data.user);
        // data-loading effect handles setAuthLoading(false)
      })
      .catch(() => { setAuthLoading(false); });
  }, []);

  // ── Carga inicial: endpoints granulares en paralelo ──────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const tok = localStorage.getItem('dw_token');
    const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
    const loadData = async () => {
      try {
        setAuthLoading(true);
        const [projRes, clientRes, unitRes] = await Promise.all([
          fetch('/api/projects', { headers }),
          fetch('/api/clients', { headers }),
          fetch('/api/units', { headers }),
        ]);
        if (projRes.ok) {
          const projs = await projRes.json() as Project[];
          setProjects(projs);
          setCurrentProjectId(prev => prev ?? (projs[0]?.id ?? null));
        }
        if (clientRes.ok) setClients(await clientRes.json() as Client[]);
        if (unitRes.ok) setUnits(await unitRes.json() as RealEstateUnit[]);
      } catch (err) { console.error('[App] Error cargando datos:', err); }
      finally { setAuthLoading(false); }
    };
    loadData();
  }, [currentUser]);

  // ── BUG 4: Draft navigation guard ─────────────────────────────────────────
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [pendingOpenDraftId, setPendingOpenDraftId] = useState<string | null>(null);

  // ── UnitDetail unsaved-changes guard ──────────────────────────────────────
  const [unitDetailHasChanges, setUnitDetailHasChanges] = useState(false);
  const [pendingViewFromUnit, setPendingViewFromUnit] = useState<typeof currentView | null>(null);
  const unitDetailSaveRef = useRef<(() => void) | null>(null);
  const unitDetailHasChangesRef = useRef(false);
  useEffect(() => { unitDetailHasChangesRef.current = unitDetailHasChanges; }, [unitDetailHasChanges]);

  // Fix 2: Interceptar botón retroceder del navegador cuando UnitDetail está abierto
  useEffect(() => {
    if (!selectedUnit) return;
    window.history.pushState({ unitDetail: true }, '');
    const handlePopState = () => {
      if (unitDetailHasChangesRef.current) {
        setPendingViewFromUnit('inventory');
        window.history.pushState({ unitDetail: true }, '');
      } else {
        setSelectedUnit(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedUnit?.id]);

  const handleChangeView = (newView: typeof currentView) => {
    if (currentView === 'quoter' && newView !== 'quoter' && activeDraftId) {
      setPendingNavigation(newView);
      return;
    }
    if (unitDetailHasChanges && currentView === 'inventory' && selectedUnit) {
      setPendingViewFromUnit(newView);
      return;
    }
    setCurrentView(newView);
  };

  const handleDraftStateChange = (draftId: string | null) => {
    setActiveDraftId(draftId);
  };

  // ── Fix 1: Cambio de proyecto con guardia de datos ────────────────────────
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  const handleSelectProject = (newId: string) => {
    if (newId === currentProjectId) return;
    if (currentView === 'quoter' && activeDraftId) {
      setPendingProjectId(newId);
      return;
    }
    setCurrentProjectId(newId);
    setCurrentView('summary');
    setSelectedUnit(null);
  };

  // ── P6: Poll backend notifications every 15 s ─────────────────────────────
  useEffect(() => {
    if (!currentUser) return;

    const fetchNotifications = async () => {
      const tok = localStorage.getItem('dw_token');
      if (!tok) return;
      try {
        const res = await fetch('/api/notifications', {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) {
          type BN = { id: string; titulo: string; mensaje: string; tipo: string; leida: number; link_view?: string; related_id?: string; created_at: string };
          const data = await res.json() as BN[];
          setNotifications(data.map(n => ({
            id: n.id,
            date: new Date(n.created_at).toLocaleDateString('es-CL'),
            title: n.titulo,
            message: n.mensaje,
            type: (n.tipo === 'success' ? 'info' : n.tipo === 'error' ? 'alert' : 'info') as AppNotification['type'],
            read: Boolean(n.leida),
            targetUserRole: 'All' as AppNotification['targetUserRole'],
            linkToView: n.link_view,
            relatedId: n.related_id,
            emailSentTo: [],
          })));
        }
        // Also fetch pending approvals count
        if (['JefeSala', 'Supervisor', 'Admin'].includes(currentUser.role)) {
          const r2 = await fetch('/api/discount-requests/pending', {
            headers: { Authorization: `Bearer ${tok}` },
          });
          if (r2.ok) {
            type DR = { estado: string };
            const drs = await r2.json() as DR[];
            setPendingApprovalsCount(drs.filter(d => d.estado === 'Pendiente' || d.estado === 'AprobadoJefe').length);
          }
        }
      } catch { /* silencioso */ }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);

    return () => clearInterval(interval);
  }, [currentUser]);

  const handleLogin = (user: User, tok: string) => {
    tokenRef.current = tok;
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('dw_token');
    localStorage.removeItem('dw_user');
    tokenRef.current = '';
    setCurrentUser(null);
  };

  // Helper para centralizar la Bitácora
  const addAuditLog = (section: string, action: string, target: string, details: string) => {
      if (!currentUser) return;
      const newLog: AuditLogEntry = {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          userId: currentUser.id,
          userName: currentUser.name,
          section,
          action,
          target,
          details
      };
      setAuditLogs(prev => [newLog, ...prev]);
      const tok = tokenRef.current;
      if (tok) {
        fetch('/api/audit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            action: `${section}:${action}`,
            entityType: section,
            entityId: target,
            description: details,
          }),
        }).catch(() => {});
      }
  };

  // ── Helpers de persistencia granular ────────────────────────────────────
  const persistClient = async (client: Client) => {
    const tok = tokenRef.current;
    if (!tok) return;
    await fetch(`/api/clients/${client.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(client),
    }).catch(() => {});
  };

  const createClient = async (client: Client) => {
    const tok = tokenRef.current;
    if (!tok) return;
    await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(client),
    }).catch(() => {});
  };

  const persistUnit = async (unit: RealEstateUnit) => {
    const tok = tokenRef.current;
    if (!tok) return;
    await fetch(`/api/units/${unit.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(unit),
    }).catch(() => {});
  };

  const createUnit = async (unit: RealEstateUnit) => {
    const tok = tokenRef.current;
    if (!tok) return;
    await fetch('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(unit),
    }).catch(() => {});
  };

  const persistProject = async (project: Project) => {
    const tok = tokenRef.current;
    if (!tok) return;
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(project),
    }).catch(() => {});
  };

  const createProject = async (project: Project) => {
    const tok = tokenRef.current;
    if (!tok) return;
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(project),
    }).catch(() => {});
  };

  /**
   * Motor de Sincronización de Estados de Clientes
   */
  const syncClientsStates = useCallback((allUnits: RealEstateUnit[], allClients: Client[]): Client[] => {
    return allClients.map(client => {
      const clientUnits = allUnits.filter(u => u.clienteId === client.id);
      
      let newEstado: 'Prospecto' | 'Activo' | 'Cerrado' | 'Desistido' = client.estado;
      
      if (clientUnits.length === 0) {
        if (client.estado !== 'Cerrado' && client.estado !== 'Desistido') {
            newEstado = 'Prospecto';
        }
      } else {
        const allEscrituradas = clientUnits.every(u => u.estado === 'Escriturado');
        if (allEscrituradas) {
          newEstado = 'Cerrado';
        } else {
          newEstado = 'Activo';
        }
      }

      if (newEstado !== client.estado) {
        const historyEntry = {
            fecha: new Date().toLocaleDateString('es-CL'),
            tipo: 'Cambio Estado' as any,
            descripcion: `Sistema: Sincronización comercial. Estado previo: ${client.estado} → Nuevo: ${newEstado}`,
            usuario: 'Motor DW'
        };
        return { ...client, estado: newEstado, historial: [...client.historial, historyEntry] };
      }
      return client;
    });
  }, []);

  useEffect(() => {
    setClients(prev => syncClientsStates(units, prev));
  }, [units, syncClientsStates]);

  const handleUpdateUnit = (updatedUnit: RealEstateUnit) => {
    try {
      const oldUnit = units.find(u => u.id === updatedUnit.id);
      setUnits(prev => prev.map(u => u.id === updatedUnit.id ? updatedUnit : u));
      if (selectedUnit?.id === updatedUnit.id) setSelectedUnit(updatedUnit);
      persistUnit(updatedUnit);
      if (oldUnit && oldUnit.estado !== updatedUnit.estado) {
          addAuditLog('Inventario', 'Cambio Estado', `${updatedUnit.type} ${updatedUnit.numero}`, `Estado actualizado: ${oldUnit.estado} → ${updatedUnit.estado}`);
      } else {
          addAuditLog('Inventario', 'Actualización', `${updatedUnit.type} ${updatedUnit.numero}`, `Datos de la unidad modificados.`);
      }
      showToast('Unidad actualizada');
    } catch {
      showToast('Error al actualizar unidad', 'error');
    }
  };

  const refreshUnits = async () => {
    const tok = localStorage.getItem('dw_token');
    if (!tok) return;
    try {
      const res = await fetch('/api/units', { headers: { Authorization: `Bearer ${tok}` } });
      if (res.ok) setUnits(await res.json() as RealEstateUnit[]);
    } catch { /* silencioso */ }
  };

  const handleAddClient = (client: Client) => {
      try {
        const existingClient = clients.find(c => c.id === client.id || c.rut === client.rut);
        if (existingClient) {
            const merged = {
              ...existingClient,
              ...client,
              historial: [...(existingClient.historial || []), ...(client.historial || [])],
              documents: [...(existingClient.documents || []), ...(client.documents || [])],
            };
            setClients(prev => prev.map(c => c.id === existingClient.id ? merged : c));
            persistClient(merged);
            addAuditLog('Clientes', 'Actualización', client.nombre, `Prospecto actualizado con nuevos datos/documentos.`);
        } else {
            const clientWithProject = {
              ...client,
              projectId: currentProjectId || '',
              ejecutivoId: client.estado === 'Activo' ? currentUser.id : client.ejecutivoId
            };
            setClients(prev => [clientWithProject, ...prev]);
            createClient(clientWithProject);
            addAuditLog('Clientes', 'Creación', client.nombre, `Nuevo prospecto registrado.`);
        }
        showToast('Cliente creado');
      } catch {
        showToast('Error al crear cliente', 'error');
      }
  };

  const handleUpdateClient = (client: Client) => {
      try {
        setClients(prev => prev.map(c => c.id === client.id ? client : c));
        persistClient(client);
        addAuditLog('Clientes', 'Actualización', client.nombre, `Ficha de cliente modificada.`);
        showToast('Cliente actualizado');
      } catch {
        showToast('Error al actualizar cliente', 'error');
      }
  };

  const handleAssignUnit = (clientId: string, unitId: string) => {
    try {
      const nowDate = new Date();
      const isoDate = nowDate.toISOString().split('T')[0];
      const todayLocal = nowDate.toLocaleDateString('es-CL');

      // Fix B: función pura para aplicar los cambios de asignación
      const applyAssignment = (u: RealEstateUnit) => ({
        ...u,
        clienteId: clientId,
        estado: 'Reservado' as const,
        asignadoPor: currentUser.name,
        fechaAsignacion: todayLocal,
        fechaReserva: u.fechaReserva || isoDate,
        fechaPromesa: undefined,
        fechaSolicitudCredito: undefined,
        fechaAprobacionCredito: undefined,
        fechaEscritura: undefined,
        fechaTerminoPago: undefined,
        fechaAlzamiento: undefined,
        fechaEntrega: undefined,
        fechaPago: undefined,
      });

      setUnits(prev => prev.map(u => u.id === unitId ? applyAssignment(u) : u));
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, ejecutivoId: currentUser.id } : c));

      // Fix B: actualizar selectedUnit para que UnitDetail reciba props frescos inmediatamente
      if (selectedUnit?.id === unitId) {
        setSelectedUnit(prev => prev ? applyAssignment(prev) : null);
      }

      const unit = units.find(u => u.id === unitId);
      const client = clients.find(c => c.id === clientId);

      // persist
      const tok = tokenRef.current;
      if (tok) {
        fetch(`/api/units/${unitId}/assign`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ clienteId: clientId, asignadoPor: currentUser.name }),
        }).catch(() => {});
        if (client) persistClient({ ...client, ejecutivoId: currentUser.id });
      }

      if (unit && client) {
        addAuditLog('Clientes', 'Asignación', client.nombre, `Asignación de unidad ${unit.numero}. Ejecutivo: ${currentUser.name}.`);
      }
      showToast('Unidad asignada correctamente');
    } catch {
      showToast('Error al asignar unidad', 'error');
    }
  };

  const handleUnassignUnit = (unitId: string) => {
    try {
      const unit = units.find(u => u.id === unitId);
      const clearFields = (u: RealEstateUnit) => ({
        ...u, clienteId: undefined, estado: 'Disponible' as const,
        asignadoPor: undefined, fechaAsignacion: undefined,
      });
      setUnits(prev => prev.map(u => u.id === unitId ? clearFields(u) : u));
      if (selectedUnit?.id === unitId) {
        setSelectedUnit(prev => prev ? clearFields(prev) : null);
      }
      const tok = tokenRef.current;
      if (tok) {
        fetch(`/api/units/${unitId}/unassign`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${tok}` },
        }).catch(() => {});
      }
      if (unit) {
        addAuditLog('Inventario', 'Desasignación', `${unit.type} ${unit.numero}`, `Cliente desasignado por ${currentUser.name}.`);
      }
      showToast('Asignación removida');
    } catch {
      showToast('Error al remover asignación', 'error');
    }
  };

  const handleProcessDesist = (clientId: string, unitIds: string[], reason: string) => {
    const client = clients.find(c => c.id === clientId);
    const affectedUnits = units.filter(u => unitIds.includes(u.id));

    setUnits(prev => prev.map(u => unitIds.includes(u.id) ? { ...u, clienteId: undefined, estado: 'Disponible', asignadoPor: undefined, fechaAsignacion: undefined } : u));

    const updatedClient = client ? {
      ...client,
      historial: [...client.historial, { fecha: new Date().toLocaleDateString('es-CL'), tipo: 'Desistimiento' as const, descripcion: `Motivo: ${reason}`, usuario: currentUser.name }],
    } : null;
    setClients(prev => prev.map(c => c.id === clientId ? (updatedClient || c) : c));

    // persist
    const tok = tokenRef.current;
    if (tok) {
      for (const unitId of unitIds) {
        fetch(`/api/units/${unitId}/unassign`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${tok}` },
        }).catch(() => {});
      }
      if (updatedClient) persistClient(updatedClient);
    }

    if (client) {
        addAuditLog('Ventas', 'Desistimiento', client.nombre, `Desistimiento de ${affectedUnits.length} unidad(es).`);
    }
  };

  const handleCreateProject = (project: Project, newUnits: RealEstateUnit[]) => {
    try {
      setProjects(prev => [...prev, project]);
      setUnits(prev => [...prev, ...newUnits]);
      setCurrentProjectId(project.id);
      setCurrentView('summary');
      createProject(project);
      newUnits.forEach(u => createUnit(u));
      addAuditLog('Administración', 'Crear Proyecto', project.nombre, `Proyecto creado con ${newUnits.length} unidades.`);
      showToast('Proyecto creado');
    } catch {
      showToast('Error al crear proyecto', 'error');
    }
  };

  const handleSelectUnitFromClient = (unit: RealEstateUnit) => {
    setSelectedUnit(unit);
    setCurrentView('inventory');
  };

  const currentProjectUnits = useMemo(() => units.filter(u => u.projectId === currentProjectId), [units, currentProjectId]);
  
  const currentProjectClients = useMemo(() => {
    if (!currentUser) return [];
    const projectClients = clients.filter(c => c.projectId === currentProjectId);

    if (currentUser.role === 'Ventas') {
      return projectClients.filter(c => {
          if (c.estado === 'Activo') return c.ejecutivoId === currentUser.id;
          return c.estado === 'Prospecto' || c.estado === 'Cerrado';
      });
    }
    return projectClients;
  }, [clients, currentProjectId, currentUser]);

  // ── Render Guards ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm font-medium animate-pulse tracking-widest uppercase">
          Cargando DanaWorks...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className={`flex min-h-screen ${darkMode ? 'dark' : ''}`}>
      {/* BUG 4: Draft navigation modal */}
      {pendingNavigation && (
        <div className="fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-2">¿Qué hacemos con esta cotización?</h3>
              <p className="text-gray-500 text-sm">Hay una cotización en progreso guardada como borrador.</p>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => { setCurrentView(pendingNavigation as typeof currentView); setPendingNavigation(null); }}
                className="w-full py-3 px-5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all text-left">
                Conservar borrador
                <div className="text-xs font-normal opacity-80 mt-0.5">El borrador queda guardado para continuar después.</div>
              </button>
              <button
                onClick={async () => {
                  if (activeDraftId) {
                    const token = localStorage.getItem('dw_token');
                    if (token) {
                      await fetch(`/api/quotation-drafts/${activeDraftId}`, {
                        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
                      }).catch(() => {});
                    }
                    setActiveDraftId(null);
                  }
                  setCurrentView(pendingNavigation as typeof currentView);
                  setPendingNavigation(null);
                }}
                className="w-full py-3 px-5 bg-red-50 border border-red-100 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-all text-left">
                Descartar y salir
                <div className="text-xs font-normal opacity-80 mt-0.5">El borrador se elimina permanentemente.</div>
              </button>
              <button
                onClick={() => setPendingNavigation(null)}
                className="w-full py-3 px-5 bg-gray-50 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-100 transition-all">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix 1: Modal cambios sin guardar al navegar desde Sidebar o retroceder */}
      {pendingViewFromUnit && selectedUnit && (
        <div className="fixed inset-0 bg-black/50 z-[9997] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Cambios sin guardar</h3>
            <p className="text-sm text-gray-600">
              Tienes cambios sin guardar en {selectedUnit.type} {selectedUnit.numero}. ¿Qué quieres hacer?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  unitDetailSaveRef.current?.();
                  setCurrentView(pendingViewFromUnit);
                  setSelectedUnit(null);
                  setUnitDetailHasChanges(false);
                  setPendingViewFromUnit(null);
                }}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
              >Guardar y salir</button>
              <button
                onClick={() => {
                  setCurrentView(pendingViewFromUnit);
                  setSelectedUnit(null);
                  setUnitDetailHasChanges(false);
                  setPendingViewFromUnit(null);
                }}
                className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-colors border border-red-200"
              >Descartar cambios</button>
              <button
                onClick={() => setPendingViewFromUnit(null)}
                className="w-full py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors"
              >Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Fix 1: Modal confirmación cambio de proyecto cuando Quoter tiene datos */}
      {pendingProjectId && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-2">¿Cambiar de proyecto?</h3>
              <p className="text-gray-500 text-sm">Hay una cotización en progreso guardada como borrador.</p>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setCurrentProjectId(pendingProjectId);
                  setCurrentView('summary');
                  setSelectedUnit(null);
                  setPendingProjectId(null);
                }}
                className="w-full py-3 px-5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all text-left">
                Cambiar de proyecto
                <div className="text-xs font-normal opacity-80 mt-0.5">El borrador queda guardado para continuar después.</div>
              </button>
              <button
                onClick={async () => {
                  if (activeDraftId) {
                    const token = localStorage.getItem('dw_token');
                    if (token) {
                      await fetch(`/api/quotation-drafts/${activeDraftId}`, {
                        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
                      }).catch(() => {});
                    }
                    setActiveDraftId(null);
                  }
                  setCurrentProjectId(pendingProjectId);
                  setCurrentView('summary');
                  setSelectedUnit(null);
                  setPendingProjectId(null);
                }}
                className="w-full py-3 px-5 bg-red-50 border border-red-100 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-all text-left">
                Descartar borrador y cambiar
                <div className="text-xs font-normal opacity-80 mt-0.5">El borrador se elimina permanentemente.</div>
              </button>
              <button
                onClick={() => setPendingProjectId(null)}
                className="w-full py-3 px-5 bg-gray-50 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-100 transition-all">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <Sidebar
        currentView={currentView}
        onChangeView={handleChangeView}
        projects={projects}
        currentProjectId={currentProjectId}
        onSelectProject={handleSelectProject}
        currentUser={currentUser}
        unreadNotificationsCount={notifications.filter(n => !n.read).length}
        pendingApprovalsCount={pendingApprovalsCount}
        onLogout={handleLogout}
      />
      
      <main className="flex-1 ml-64 p-8 bg-gray-50 dark:bg-gray-900 min-h-screen overflow-auto">
        {selectedUnit && currentView === 'inventory' ? (
          <UnitDetail
            unit={selectedUnit}
            client={clients.find(c => c.id === selectedUnit.clienteId)}
            onBack={() => { setSelectedUnit(null); setUnitDetailHasChanges(false); }}
            onUpdate={handleUpdateUnit}
            allUnits={currentProjectUnits}
            currentUser={currentUser}
            clients={clients}
            onSelectClient={(id) => { setExpandedClientId(id); setCurrentView('clients'); setSelectedUnit(null); setUnitDetailHasChanges(false); }}
            onAssignClient={handleAssignUnit}
            onUnassignClient={handleUnassignUnit}
            showToast={showToast}
            onUnsavedChangesUpdate={setUnitDetailHasChanges}
            saveRef={unitDetailSaveRef}
          />
        ) : (
          <>
            {currentView === 'summary' && <SummaryDashboard units={currentProjectUnits} />}
            {currentView === 'clients' && (
              <ClientList
                clients={currentProjectClients}
                units={currentProjectUnits}
                onAddClient={handleAddClient}
                onUpdateClient={handleUpdateClient}
                onUpdateUnit={handleUpdateUnit}
                onAssignUnit={handleAssignUnit}
                onProcessDesist={handleProcessDesist}
                currentUser={currentUser}
                users={users}
                onSelectUnit={handleSelectUnitFromClient}
                initialExpandedId={expandedClientId}
                showToast={showToast}
                projects={projects}
                onOpenDraft={(draftId: string) => {
                  setPendingOpenDraftId(draftId);
                  setCurrentView('quoter');
                }}
              />
            )}
            {currentView === 'inventory' && <UnitList
              units={currentProjectUnits}
              clients={currentProjectClients}
              currentUser={currentUser}
              onSelectUnit={setSelectedUnit}
              onReleaseUnit={(unitId) => setUnits(prev => prev.map(u => u.id === unitId ? {
                ...u,
                estado: 'Disponible' as const,
                clienteId: undefined,
                asignadoPor: undefined,
                fechaAsignacion: undefined,
                fechaReserva: undefined,
                fechaPromesa: undefined,
                fechaEscritura: undefined,
                descuentoPct: 0,
                reservaVendedorId: undefined,
                reservaExpira: undefined,
              } : u))}
              showToast={showToast}
            />}
            {currentView === 'prices' && <PriceManager units={currentProjectUnits} onUpdateUnit={handleUpdateUnit} currentUser={currentUser} onRefreshUnits={refreshUnits} />}
            {currentView === 'create_project' && <ProjectCreationWizard onSave={handleCreateProject} onCancel={() => setCurrentView('summary')} />}
            {currentView === 'audit' && (
              <React.Suspense fallback={<LazyFallback />}>
                <AuditLogView logs={auditLogs} />
              </React.Suspense>
            )}
            {currentView === 'settings' && <SettingsPanel currentUser={currentUser} users={users} onAddUser={u => setUsers(p => [...p, u])} onDeleteUser={id => setUsers(p => p.filter(u => u.id !== id))} onUpdateUser={u => setUsers(p => p.map(x => x.id === u.id ? u : x))} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} />}
            {currentView === 'profile_admin' && (
              <React.Suspense fallback={<LazyFallback />}>
                <ProfileAdministration users={users} projects={projects} onAddUser={u => setUsers(p => [...p, u])} onUpdateUser={u => setUsers(p => p.map(x => x.id === u.id ? u : x))} onDeleteUser={id => setUsers(p => p.filter(u => u.id !== id))} currentUser={currentUser} showToast={showToast} />
              </React.Suspense>
            )}
            {currentView === 'notifications' && <NotificationsView
                notifications={notifications}
                onMarkAsRead={id => {
                  setNotifications(p => p.map(n => n.id === id ? { ...n, read: true } : n));
                }}
                onDelete={id => setNotifications(p => p.filter(n => n.id !== id))}
                onChangeView={v => setCurrentView(v as typeof currentView)}
                onMarkAllRead={() => {
                  const tok = localStorage.getItem('dw_token');
                  if (tok) fetch('/api/notifications/read-all', { method: 'POST', headers: { Authorization: `Bearer ${tok}` } }).catch(() => {});
                  setNotifications(p => p.map(n => ({ ...n, read: true })));
                }}
              />}
            {currentView === 'downloads' && (
              <React.Suspense fallback={<LazyFallback />}>
                <DownloadsView units={currentProjectUnits} clients={clients} project={projects.find(p => p.id === currentProjectId)} />
              </React.Suspense>
            )}
            {currentView === 'quoter' && (
              <React.Suspense fallback={
                <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="font-medium">Cargando Cotizador...</span>
                </div>
              }>
                <Quoter
                  units={currentProjectUnits}
                  clients={clients}
                  projects={projects}
                  currentProjectId={currentProjectId}
                  currentUser={currentUser}
                  onDraftStateChange={handleDraftStateChange}
                  openDraftId={pendingOpenDraftId}
                  onDraftOpened={() => setPendingOpenDraftId(null)}
                  onSaveProspect={(c, msg, _doc) => {
                    handleAddClient(c);
                    addAuditLog('Ventas', 'Cotización', c.nombre, msg);
                  }}
                />
              </React.Suspense>
            )}
            {currentView === 'approvals' && (
              <React.Suspense fallback={<LazyFallback />}>
                <ApprovalsView currentUser={currentUser} />
              </React.Suspense>
            )}
            {currentView === 'performance' && (
              <React.Suspense fallback={<LazyFallback />}>
                <SalesPerformanceView
                  currentUser={currentUser}
                  units={units}
                  clients={clients}
                  users={users}
                  projects={projects}
                  currentProjectId={currentProjectId}
                />
              </React.Suspense>
            )}
          </>
        )}
      </main>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {process.env.NODE_ENV === 'development' && (
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
          {isSimulatorExpanded ? (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden mb-3 animate-in slide-in-from-bottom-2 duration-200 w-64">
                  <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-black uppercase tracking-widest">Simulador UX</span>
                      </div>
                      <button onClick={() => setIsSimulatorExpanded(false)} className="hover:bg-white/10 p-1 rounded-lg">
                          <ChevronDown className="w-4 h-4" />
                      </button>
                  </div>
                  <div className="p-2 space-y-1">
                      {users.map(user => (
                          <button
                              key={user.id}
                              onClick={() => {
                                  setCurrentUser(user);
                                  setIsSimulatorExpanded(false);
                              }}
                              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${currentUser.id === user.id ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                          >
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${currentUser.id === user.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                  {user.name.charAt(0)}
                              </div>
                              <div className="text-left overflow-hidden">
                                  <div className={`text-xs font-bold truncate ${currentUser.id === user.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>{user.name}</div>
                                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{user.role}</div>
                              </div>
                          </button>
                      ))}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900/50 p-3 text-center border-t border-gray-100 dark:border-gray-700">
                      <p className="text-[9px] text-gray-400 font-bold italic uppercase tracking-tighter">Útil para validar visibilidad de prospectos</p>
                  </div>
              </div>
          ) : (
              <button 
                  onClick={() => setIsSimulatorExpanded(true)}
                  className="bg-gray-900 hover:bg-black text-white p-4 rounded-full shadow-2xl flex items-center gap-3 transition-all hover:scale-105 active:scale-95 group"
              >
                  <div className="flex -space-x-2">
                      <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-gray-900 flex items-center justify-center text-[10px] font-black">A</div>
                      <div className="w-6 h-6 rounded-full bg-purple-500 border-2 border-gray-900 flex items-center justify-center text-[10px] font-black">V</div>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest hidden group-hover:block animate-in fade-in slide-in-from-right-1">Cambiar Rol</span>
                  <ChevronUp className="w-4 h-4 text-gray-400" />
              </button>
          )}
      </div>
      )}
    </div>
  );
};

export default App;