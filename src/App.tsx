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
import { AuditLogView } from './components/AuditLogView';
import { ProfileAdministration } from './components/ProfileAdministration';
import { NotificationsView } from './components/NotificationsView';
import { DownloadsView } from './components/DownloadsView';
import { ApprovalsView } from './components/ApprovalsView';
import { Shield, User as UserIcon, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';

// Lazy-loaded heavy module — jsPDF only downloads when user opens the Quoter
const Quoter = React.lazy(() => import('./components/Quoter').then(m => ({ default: m.Quoter })));

const dummyPdfUrl = 'data:application/pdf;base64,JVBERi0xLjQKJdPr6eEKMSAwIG9iaiA8PC9UaXRsZSAoQ29udHJhdG8gRGVtbW8pL0NyZWF0b3IgKERhbmFXb3Jrcyk+PgplbmRvYmoKMiAwIG9iaiA8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMyAwIFI+PgplbmRvYmoKMyAwIG9iaiA8PC9UeXBlL1BhZ2VzL0tpZHNbNCAwIFJdL0NvdW50IDE+PgplbmRvYmoKNCAwIG9iaiA8PC9UeXBlL1BhZ2UvUGFyZW50IDMgMCBSL01lZGlhQm94WzAgMCA1OTUgODQyXS9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjUgMCBvYmogPDwvTGVuZ3RoIDY4Pj5zdHJlYW0KQlQKICAvRjEgMjQgVGYKICA3MiA3MjAgVGQKICAoRG9jdW1lbnRvIGRlIE11ZXN0cmEgLSBEYW5hV29ya3MpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNjkgMDAwMDAgbiAKMDAwMDAwMDExNiAwMDAwMCBuIAowMDAwMDAwMTczIDAwMDAwIG4gCjAwMDAwMDAwMjkyIDAwMDAwIG4gCHRyYWlsZXIgPDwvU2l6ZSA2L1Jvb3QgMiAwIFIvSW5mbyAxIDAgUj4+CnN0YXJ0eHJlZgowIDM2MQolJUVPRg==';

const initialClients: Client[] = [
  { 
    id: '1', 
    projectId: 'p1',
    tipoPersona: 'Natural',
    nombre: 'Rolando Fabio Bahamondes Rojas', 
    rut: '18.555.261-6', 
    nacionalidad: 'Chilena',
    profesion: 'Ingeniero Civil',
    fechaNacimiento: '1985-05-20',
    email: 'rolandofabio@hotmail.com', 
    telefono: '9 8815 5086', 
    direccion: 'Av. Chacabuco 123, Depto 404',
    ciudad: 'CONCEPCION', 
    comuna: 'CONCEPCION', 
    region: 'Biobío',
    estado: 'Activo', 
    fechaRegistro: '14-02-2024',
    ejecutivoId: 'u2',
    documents: [],
    historial: [
        { fecha: '14-02-2024', tipo: 'Creación', descripcion: 'Cliente registrado en sistema', usuario: 'Admin' },
        { fecha: '15-02-2024', tipo: 'Cambio Estado', descripcion: 'Cambio a Activo por reserva de Depto 204', etapa: 'Reserva' },
        { fecha: '25-03-2024', tipo: 'Pago', descripcion: 'Pago de Pie realizado (228.25 UF)', etapa: 'Promesa' }
    ]
  },
  { 
    id: '2', 
    projectId: 'p1',
    tipoPersona: 'Natural',
    nombre: 'S.Silva-Paulina Figueroa', 
    rut: '12.345.678-9', 
    nacionalidad: 'Chilena',
    profesion: 'Abogada',
    fechaNacimiento: '1990-11-15',
    email: 'paulina.silva@example.com', 
    telefono: '9 1234 5678', 
    direccion: 'Calle Falsa 123',
    ciudad: 'SANTIAGO',
    comuna: 'LAS CONDES',
    region: 'Metropolitana',
    estado: 'Cerrado', 
    fechaRegistro: '15-02-2024',
    ejecutivoId: 'u1',
    documents: [],
    historial: [
        { fecha: '15-02-2024', tipo: 'Creación', descripcion: 'Registro inicial' },
        { fecha: '20-05-2024', tipo: 'Cambio Estado', descripcion: 'Escrituración finalizada', etapa: 'Escritura' }
    ]
  },
];

const defaultProjects: Project[] = [
  { id: 'p1', nombre: 'Edificio Valle Real', fechaCreacion: '2024-01-01' }
];

const defaultUsers: User[] = [
  { id: 'u1', name: 'Administrador Principal', email: 'admin@danacorp.cl',     role: 'Admin',      company: 'Danacorp' },
  { id: 'u3', name: 'Jefe de Sala',            email: 'jefe@danacorp.cl',      role: 'JefeSala',   company: 'Sala de Ventas',  assignedProjectIds: ['p1'] },
  { id: 'u5', name: 'Supervisor Demo',          email: 'supervisor@danacorp.cl', role: 'Supervisor', company: 'Danacorp',        assignedProjectIds: ['p1'] },
  { id: 'u2', name: 'Vendedor Demo',            email: 'vendedor@danacorp.cl',  role: 'Ventas',     company: 'Danacorp Ventas', assignedProjectIds: ['p1'] },
];

const initialUnits: RealEstateUnit[] = [
  {
    id: 'u1', projectId: 'p1', type: 'Departamento', numero: '204', estado: 'Promesado',
    superficie: 65.5, orientacion: 'Norte', piso: 2, dormitorios: 2, banos: 2, gastoComun: 125000,
    bodegas: ['B-233', 'B-234'], estacionamientos: ['E-12', 'E-13'], clienteId: '1',
    precioLista: 4565.00, precioVenta: 4565.00, pie: 4495.00, pieFormaPago: 'Contado', pieCuotas: 3, bonoDescuento: 70.00,
    reservaMonto: 50, reservaFormaPago: 'Contado', creditoHipotecario: 4108.50, totalPagado: 4565.00, saldoPorPagar: 0.00,
    banco: 'CHILE', notaria: 'GUTIERREZ', repertorio: '7,124', canalVenta: 'Corredor', intermediario: 'Propiedades Concepción Ltda.',
    fechaReserva: '2024-02-14', fechaPromesa: '2024-03-23', fechaSolicitudCredito: '2024-04-01', fechaAprobacionCredito: '2024-04-15',
    fechaEscritura: '2024-05-23', fechaTerminoPago: '2024-05-30', fechaEntrega: '2024-06-17', facturaNumero: '136', facturaFecha: '2024-05-22',
    cbrFojas: '50206', cbrNumero: '70458', cbrAno: '2024',
    planPagos: [
        { id: 'F.1', date: '2024-02-14', amount: '16.34', status: 'Pagado', observacion: 'Cheque al día', fechaPagoReal: '2024-02-14' },
        { id: 'F.2', date: '2024-03-25', amount: '228.25', status: 'Pagado', observacion: 'Transferencia', fechaPagoReal: '2024-03-25' },
        { id: 'F.3', date: '2024-05-24', amount: '19.46', status: 'Pagado', fechaPagoReal: '2024-05-24' },
    ],
    observaciones: '***NOTA ESPECIAL OFERTA: SOBRE ESTACIONAMIENTO DE VISITA...',
    documents: [
      { id: 'd1', name: 'Contrato Promesa Unidad 204.pdf', type: 'pdf', category: 'Legal', url: dummyPdfUrl, date: '23-03-2024', size: '1.2 MB' }
    ]
  },
  {
    id: 'u2', projectId: 'p1', type: 'Departamento', numero: '305', estado: 'Disponible',
    superficie: 54.0, orientacion: 'Poniente', piso: 3, dormitorios: 3, banos: 2,
    precioLista: 3200.00, precioVenta: 3200.00, planPagos: [], bodegas: ['B-305'], estacionamientos: [], observaciones: '',
    pie: 0, bonoDescuento: 0, reservaMonto: 0, creditoHipotecario: 0, totalPagado: 0, saldoPorPagar: 0
  }
];

const App: React.FC = () => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const tokenRef = useRef<string>('');

  // ── App State ─────────────────────────────────────────────────────────────
  const [currentView, setCurrentView] = useState<'clients' | 'inventory' | 'prices' | 'create_project' | 'summary' | 'settings' | 'audit' | 'profile_admin' | 'quoter' | 'notifications' | 'downloads' | 'approvals'>('summary');
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [units, setUnits] = useState<RealEstateUnit[]>(initialUnits);
  const [projects, setProjects] = useState<Project[]>(defaultProjects);
  const [users, setUsers] = useState<User[]>(defaultUsers);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(defaultProjects[0]?.id || null);
  const [selectedUnit, setSelectedUnit] = useState<RealEstateUnit | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [isSimulatorExpanded, setIsSimulatorExpanded] = useState(false);

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
          return null;
        }
        setCurrentUser(data.user);
        return fetch('/api/sync/app_state', {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
      })
      .then(r => r?.ok ? r.json() : null)
      .then((sync: { value: { clients?: Client[]; units?: RealEstateUnit[]; projects?: Project[] } } | null) => {
        if (sync?.value) {
          const { clients: c, units: u, projects: p } = sync.value;
          if (Array.isArray(c) && c.length > 0) setClients(c);
          if (Array.isArray(u) && u.length > 0) setUnits(u);
          if (Array.isArray(p) && p.length > 0) setProjects(p);
        }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  // ── Persistencia: Sincronizar estado con backend ─────────────────────────
  useEffect(() => {
    if (!currentUser || !tokenRef.current) return;
    const t = setTimeout(() => {
      fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ key: 'app_state', value: { clients, units, projects } }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [clients, units, projects, currentUser]);

  // ── BUG 4: Draft navigation guard ─────────────────────────────────────────
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  const handleChangeView = (newView: typeof currentView) => {
    if (currentView === 'quoter' && newView !== 'quoter' && activeDraftId) {
      setPendingNavigation(newView);
      return;
    }
    setCurrentView(newView);
  };

  const handleDraftStateChange = (draftId: string | null) => {
    setActiveDraftId(draftId);
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
    const oldUnit = units.find(u => u.id === updatedUnit.id);
    setUnits(prev => prev.map(u => u.id === updatedUnit.id ? updatedUnit : u));
    if (selectedUnit?.id === updatedUnit.id) setSelectedUnit(updatedUnit);
    
    if (oldUnit && oldUnit.estado !== updatedUnit.estado) {
        addAuditLog('Inventario', 'Cambio Estado', `${updatedUnit.type} ${updatedUnit.numero}`, `Estado actualizado: ${oldUnit.estado} → ${updatedUnit.estado}`);
    } else {
        addAuditLog('Inventario', 'Actualización', `${updatedUnit.type} ${updatedUnit.numero}`, `Datos de la unidad modificados.`);
    }
  };

  const handleAddClient = (client: Client) => {
      const existingClientIdx = clients.findIndex(c => c.id === client.id || c.rut === client.rut);
      if (existingClientIdx > -1) {
          setClients(prev => prev.map((c, i) => i === existingClientIdx ? { 
              ...c, 
              ...client, 
              historial: [...(c.historial || []), ...(client.historial || [])],
              documents: [...(c.documents || []), ...(client.documents || [])]
          } : c));
          addAuditLog('Clientes', 'Actualización', client.nombre, `Prospecto actualizado con nuevos datos/documentos.`);
      } else {
          const clientWithProject = { 
            ...client, 
            projectId: currentProjectId || '',
            ejecutivoId: client.estado === 'Activo' ? currentUser.id : client.ejecutivoId 
          };
          setClients(prev => [clientWithProject, ...prev]);
          addAuditLog('Clientes', 'Creación', client.nombre, `Nuevo prospecto registrado.`);
      }
  };

  const handleUpdateClient = (client: Client) => {
      setClients(prev => prev.map(c => c.id === client.id ? client : c));
      addAuditLog('Clientes', 'Actualización', client.nombre, `Ficha de cliente modificada.`);
  };

  const handleAssignUnit = (clientId: string, unitId: string) => {
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
    });

    setUnits(prev => prev.map(u => u.id === unitId ? applyAssignment(u) : u));
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, ejecutivoId: currentUser.id } : c));

    // Fix B: actualizar selectedUnit para que UnitDetail reciba props frescos inmediatamente
    if (selectedUnit?.id === unitId) {
      setSelectedUnit(prev => prev ? applyAssignment(prev) : null);
    }

    const unit = units.find(u => u.id === unitId);
    const client = clients.find(c => c.id === clientId);
    if (unit && client) {
      addAuditLog('Clientes', 'Asignación', client.nombre, `Asignación de unidad ${unit.numero}. Ejecutivo: ${currentUser.name}.`);
    }
  };

  const handleUnassignUnit = (unitId: string) => {
    const unit = units.find(u => u.id === unitId);
    const clearFields = (u: RealEstateUnit) => ({
      ...u, clienteId: undefined, estado: 'Disponible' as const,
      asignadoPor: undefined, fechaAsignacion: undefined,
    });
    setUnits(prev => prev.map(u => u.id === unitId ? clearFields(u) : u));
    if (selectedUnit?.id === unitId) {
      setSelectedUnit(prev => prev ? clearFields(prev) : null);
    }
    if (unit) {
      addAuditLog('Inventario', 'Desasignación', `${unit.type} ${unit.numero}`, `Cliente desasignado por ${currentUser.name}.`);
    }
  };

  const handleProcessDesist = (clientId: string, unitIds: string[], reason: string) => {
    const client = clients.find(c => c.id === clientId);
    const affectedUnits = units.filter(u => unitIds.includes(u.id));
    
    setUnits(prev => prev.map(u => unitIds.includes(u.id) ? { ...u, clienteId: undefined, estado: 'Disponible', asignadoPor: undefined, fechaAsignacion: undefined } : u));
    setClients(prev => prev.map(c => c.id === clientId ? {
      ...c,
      historial: [...c.historial, { fecha: new Date().toLocaleDateString('es-CL'), tipo: 'Desistimiento', descripcion: `Motivo: ${reason}`, usuario: currentUser.name }]
    } : c));

    if (client) {
        addAuditLog('Ventas', 'Desistimiento', client.nombre, `Desistimiento de ${affectedUnits.length} unidad(es).`);
    }
  };

  const handleCreateProject = (project: Project, newUnits: RealEstateUnit[]) => {
    setProjects(prev => [...prev, project]);
    setUnits(prev => [...prev, ...newUnits]);
    setCurrentProjectId(project.id);
    setCurrentView('summary');
    addAuditLog('Administración', 'Crear Proyecto', project.nombre, `Proyecto creado con ${newUnits.length} unidades.`);
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

      <Sidebar
        currentView={currentView}
        onChangeView={handleChangeView}
        projects={projects}
        currentProjectId={currentProjectId}
        onSelectProject={setCurrentProjectId}
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
            onBack={() => setSelectedUnit(null)}
            onUpdate={handleUpdateUnit}
            allUnits={currentProjectUnits}
            currentUser={currentUser}
            clients={clients}
            onSelectClient={(id) => { setExpandedClientId(id); setCurrentView('clients'); setSelectedUnit(null); }}
            onAssignClient={handleAssignUnit}
            onUnassignClient={handleUnassignUnit}
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
              />
            )}
            {currentView === 'inventory' && <UnitList units={currentProjectUnits} clients={currentProjectClients} onSelectUnit={setSelectedUnit} />}
            {currentView === 'prices' && <PriceManager units={currentProjectUnits} onUpdateUnit={handleUpdateUnit} currentUser={currentUser} />}
            {currentView === 'create_project' && <ProjectCreationWizard onSave={handleCreateProject} onCancel={() => setCurrentView('summary')} />}
            {currentView === 'audit' && <AuditLogView logs={auditLogs} />}
            {currentView === 'settings' && <SettingsPanel currentUser={currentUser} users={users} onAddUser={u => setUsers(p => [...p, u])} onDeleteUser={id => setUsers(p => p.filter(u => u.id !== id))} onUpdateUser={u => setUsers(p => p.map(x => x.id === u.id ? u : x))} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} />}
            {currentView === 'profile_admin' && <ProfileAdministration users={users} projects={projects} onAddUser={u => setUsers(p => [...p, u])} onUpdateUser={u => setUsers(p => p.map(x => x.id === u.id ? u : x))} onDeleteUser={id => setUsers(p => p.filter(u => u.id !== id))} currentUser={currentUser} />}
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
            {currentView === 'downloads' && <DownloadsView units={currentProjectUnits} clients={clients} project={projects.find(p => p.id === currentProjectId)} />}
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
                  onSaveProspect={(c, msg, _doc) => {
                    handleAddClient(c);
                    addAuditLog('Ventas', 'Cotización', c.nombre, msg);
                  }}
                />
              </React.Suspense>
            )}
            {currentView === 'approvals' && (
              <ApprovalsView currentUser={currentUser} />
            )}
          </>
        )}
      </main>

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