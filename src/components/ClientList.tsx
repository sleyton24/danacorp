import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Client, RealEstateUnit, User, ClientDocument, ClientHistory, Project } from '../types';
import {
  Search, Plus, User as UserIcon, Phone, Mail, MoreVertical,
  MapPin, Home, Car, Package, ChevronDown, ChevronUp,
  Clock, FileText, Ban, Building, UserCheck, Briefcase,
  FolderOpen, Download, CloudUpload, Edit, Calendar,
  X, CheckSquare, Square, Save, ArrowRight, FileCheck, ArrowUpRight, ExternalLink, Trash2, AlertTriangle, Landmark, Link, FileSpreadsheet, Upload,
  Lock, XCircle, Info, CheckCircle2, UserPlus, Globe
} from 'lucide-react';

// ── RUT Chileno validator ────────────────────────────────────────────────────
function isValidRut(rut: string): boolean {
  if (!rut) return false;
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  let sum = 0; let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const expected = 11 - (sum % 11);
  const expectedChar = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);
  return dv === expectedChar;
}
import * as XLSX from 'xlsx';

interface ClientListProps {
  clients: Client[];
  units: RealEstateUnit[];
  onAddClient: (client: Client) => void;
  onUpdateClient: (client: Client) => void;
  onUpdateUnit: (unit: RealEstateUnit) => void;
  onAssignUnit?: (clientId: string, unitId: string) => void;
  onProcessDesist?: (clientId: string, unitIds: string[], reason: string) => void;
  currentUser: User;
  users?: User[];
  onSelectUnit?: (unit: RealEstateUnit) => void;
  initialExpandedId?: string | null;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
  projects?: Project[];
  onOpenDraft?: (draftId: string) => void;
}

const parseDate = (dateStr: string): number => {
    if (!dateStr) return 0;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return 0;
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
};

const getLastUpdateTimestamp = (client: Client): number => {
    let maxDate = parseDate(client.fechaRegistro);
    if (client.historial && client.historial.length > 0) {
        client.historial.forEach(h => {
            const hDate = parseDate(h.fecha);
            if (hDate > maxDate) maxDate = hDate;
        });
    }
    return maxDate;
};

const CLIENT_TEMPLATE_HEADERS = [
  'Tipo Persona (Natural/Juridica)',
  'Nombre / Razon Social',
  'RUT',
  'Email',
  'Telefono',
  'Direccion',
  'Comuna',
  'Ciudad',
  'Region',
  'Profesion',
  'Rango Sueldo',
  'Fecha Nacimiento (DD-MM-AAAA)',
  'Nacionalidad',
  'Nombre Representante (Si es Juridica)',
  'RUT Representante',
  'Nacionalidad Representante'
];

export const ClientList: React.FC<ClientListProps> = ({
  clients,
  units,
  onAddClient,
  onUpdateClient,
  onUpdateUnit,
  onAssignUnit,
  onProcessDesist,
  currentUser,
  users = [],
  onSelectUnit,
  initialExpandedId,
  showToast,
  projects = [],
  onOpenDraft,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('Todos');
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [openMenuClientId, setOpenMenuClientId] = useState<string | null>(null);

  // ── Cotizaciones por cliente (ACCIÓN 5) ─────────────────────────────────
  interface ClientQuotation {
    id: string;
    projectId: string;
    clienteRut: string | null;
    clienteNombre: string | null;
    fechaGenerada: string | null;
    generadaPor: string | null;
    pdfPath?: string | null;
    selectedUnits: Array<{ id: string; numero: string; type: string }>;
    data: Record<string, unknown>;
  }
  const [clientQuotations, setClientQuotations] = useState<Record<string, ClientQuotation[]>>({});
  const [quotationsLoading, setQuotationsLoading] = useState<Record<string, boolean>>({});
  const [expandedQuotationId, setExpandedQuotationId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isDesistModalOpen, setIsDesistModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
      docId: string;
      docName: string;
      source: 'client' | 'unit';
      sourceId: string;
  } | null>(null);
  
  const [editingClient, setEditingClient] = useState<Partial<Client> | null>(null);
  const [bulkParsedClients, setBulkParsedClients] = useState<Client[]>([]);
  const [clientToDesist, setClientToDesist] = useState<Client | null>(null);
  const [clientForAssignment, setClientForAssignment] = useState<Client | null>(null);
  const [assignSearchTerm, setAssignSearchTerm] = useState('');
  const [selectedDesistUnits, setSelectedDesistUnits] = useState<string[]>([]);
  const [desistReason, setDesistReason] = useState('');

  useEffect(() => {
    if (initialExpandedId) {
      setExpandedClientId(initialExpandedId);
    }
  }, [initialExpandedId]);

  // Carga cotizaciones cuando se expande un cliente (ACCIÓN 5)
  useEffect(() => {
    if (!expandedClientId) return;
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    setQuotationsLoading(prev => ({ ...prev, [expandedClientId]: true }));
    fetch(`/api/clients/${expandedClientId}/quotations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        setClientQuotations(prev => ({ ...prev, [expandedClientId]: data as ClientQuotation[] }));
      })
      .catch(() => {
        setClientQuotations(prev => ({ ...prev, [expandedClientId]: [] }));
      })
      .finally(() => {
        setQuotationsLoading(prev => ({ ...prev, [expandedClientId]: false }));
      });
  }, [expandedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cierra el menú al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuClientId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredClients = useMemo(() => {
      return clients.filter(c => {
        const matchesStatus = filterStatus === 'Todos' || c.estado === filterStatus;
        const term = searchTerm.toLowerCase();
        const matchesName = c.nombre.toLowerCase().includes(term);
        const matchesRut = c.rut.toLowerCase().includes(term);
        const clientUnits = units.filter(u => u.clienteId === c.id);
        const matchesUnit = clientUnits.some(u => u.numero.toLowerCase().includes(term));
        return matchesStatus && (matchesName || matchesRut || matchesUnit);
      });
  }, [clients, searchTerm, filterStatus, units]);

  const sortedClients = useMemo(() => {
      const statusPriority: Record<string, number> = { 'Activo': 1, 'Prospecto': 2, 'Cerrado': 3, 'Desistido': 4 };
      return [...filteredClients].sort((a, b) => {
          const prioA = statusPriority[a.estado] || 99;
          const prioB = statusPriority[b.estado] || 99;
          if (prioA !== prioB) return prioA - prioB;
          return getLastUpdateTimestamp(b) - getLastUpdateTimestamp(a);
      });
  }, [filteredClients]);

  const availableUnitsForAssignment = useMemo(() => {
    return units.filter(u => 
      u.estado === 'Disponible' && 
      u.numero.toLowerCase().includes(assignSearchTerm.toLowerCase())
    );
  }, [units, assignSearchTerm]);

  const getDirectClientAssets = (clientId: string) => units.filter(u => u.clienteId === clientId);

  // Ajustado para coincidir con getStatusColor de UnitList
  const getStatusStyle = (status: string) => {
      switch(status) {
          case 'Activo': return 'bg-green-100 text-green-800 border border-green-200';
          case 'Prospecto': return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
          case 'Cerrado': return 'bg-blue-100 text-blue-800 border border-blue-200';
          case 'Desistido': return 'bg-red-100 text-red-800 border border-red-200';
          default: return 'bg-gray-100 text-gray-800 border border-gray-200';
      }
  };

  const getUnitIcon = (type: string) => {
    switch(type) {
        case 'Bodega': return <Package className="w-3 h-3 text-orange-600" />;
        case 'Estacionamiento': return <Car className="w-3 h-3 text-gray-600" />;
        default: return <Home className="w-3 h-3 text-blue-600" />;
    }
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      CLIENT_TEMPLATE_HEADERS,
      ['Natural', 'Juan Perez', '12.345.678-9', 'juan@ejemplo.com', '912345678', 'Av Siempre Viva 123', 'Providencia', 'Santiago', 'Metropolitana', 'Ingeniero', '$1.000.000 - $2.000.000', '15-05-1985', 'Chilena', '', '', ''],
      ['Juridica', 'Inversiones ABC SpA', '77.123.456-0', 'contacto@abc.cl', '222334455', 'Calle Centrica 500', 'Santiago', 'Santiago', 'Metropolitana', 'Inversiones', '>$4.500.000', '', 'Chilena', 'Carlos Perez', '8.123.456-7', 'Chilena']
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, "Plantilla_Carga_Clientes.xlsx");
  };

  const handleBulkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];
          
          const newClients: Client[] = jsonData.map((row, idx) => ({
            id: Math.random().toString(36).substr(2, 9) + idx,
            projectId: '', 
            tipoPersona: row['Tipo Persona (Natural/Juridica)'] === 'Juridica' ? 'Juridica' : 'Natural',
            nombre: row['Nombre / Razon Social'] || 'Sin Nombre',
            rut: row['RUT'] || '0-0',
            email: row['Email'] || '',
            telefono: row['Telefono'] || '',
            direccion: row['Direccion'] || '',
            comuna: row['Comuna'] || '',
            ciudad: row['Ciudad'] || '',
            region: row['Region'] || '',
            profesion: row['Profesion'] || '',
            sueldoRange: row['Rango Sueldo'] || '',
            fechaNacimiento: row['Fecha Nacimiento (DD-MM-AAAA)'] || '',
            nacionalidad: row['Nacionalidad'] || 'Chilena',
            representanteNombre: row['Nombre Representante (Si es Juridica)'] || '',
            representanteRut: row['RUT Representante'] || '',
            representanteNacionalidad: row['Nacionalidad Representante'] || 'Chilena',
            estado: 'Prospecto',
            fechaRegistro: new Date().toLocaleDateString('es-CL'),
            historial: [{ fecha: new Date().toLocaleDateString('es-CL'), tipo: 'Creación', descripcion: 'Carga Masiva Excel', usuario: currentUser.name }],
            documents: []
          }));
          
          setBulkParsedClients(newClients);
        } catch (err) {
          showToast?.('Error al leer el archivo Excel. Verifique el formato.', 'error');
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleConfirmBulkUpload = async () => {
    const tok = localStorage.getItem('dw_token');
    if (!tok) { showToast?.('Sin sesión activa', 'error'); return; }

    try {
      const res = await fetch('/api/clients/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ clients: bulkParsedClients }),
      });
      const result = await res.json() as { success: number; errors: string[] };

      // Actualizar UI con los clientes parseados del Excel
      bulkParsedClients.forEach(c => onAddClient(c));

      setBulkParsedClients([]);
      setIsBulkModalOpen(false);
      showToast?.(
        `${result.success} prospectos importados` + (result.errors.length > 0 ? ` (${result.errors.length} errores)` : ''),
        result.errors.length > 0 ? 'warning' : 'success'
      );
    } catch {
      showToast?.('Error en la importación masiva', 'error');
    }
  };

  const handleTriggerUpload = () => { if (fileInputRef.current) fileInputRef.current.click(); };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && expandedClientId) {
        const client = clients.find(c => c.id === expandedClientId);
        if (!client) return;
        const newDoc: ClientDocument = { id: Math.random().toString(36).substr(2, 9), name: file.name, type: file.type || 'application/octet-stream', category: 'General', url: URL.createObjectURL(file), date: new Date().toLocaleDateString('es-CL'), size: `${(file.size / (1024 * 1024)).toFixed(2)} MB` };
        const updatedClient: Client = { ...client, documents: [...(client.documents || []), newDoc], historial: [ ...client.historial, { fecha: new Date().toLocaleDateString('es-CL'), tipo: 'Nota', descripcion: `Documento cargado: ${file.name}`, usuario: currentUser.name } ] };
        onUpdateClient(updatedClient);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadDoc = (doc: ClientDocument) => {
    if (doc.url && doc.url !== '#') {
        const link = document.createElement('a'); 
        link.href = doc.url; 
        link.setAttribute('download', doc.name); 
        link.style.display = 'none'; 
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link);
    } else { showToast?.(`Error: La URL del documento ${doc.name} no es válida.`, 'error'); }
  };

  const openDeleteModal = (docId: string, docName: string, source: 'client' | 'unit', sourceId: string) => {
    setDeleteConfirmation({ docId, docName, source, sourceId });
  };

  const handleDeleteDoc = () => {
    if (!deleteConfirmation) return;
    const { docId, source, sourceId } = deleteConfirmation;

    if (source === 'client') {
      const client = clients.find(c => c.id === sourceId);
      if (client) {
        const updatedDocs = (client.documents || []).filter(d => d.id !== docId);
        onUpdateClient({ ...client, documents: updatedDocs });
      }
    } else {
      const unit = units.find(u => u.id === sourceId);
      if (unit && unit.documents) {
        const updatedDocs = unit.documents.filter(d => d.id !== docId);
        onUpdateUnit({ ...unit, documents: updatedDocs });
      }
    }
    setDeleteConfirmation(null);
  };

  const handleSaveClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingClient) {
      try {
        if (editingClient.id) {
          onUpdateClient(editingClient as Client);
          showToast?.('Cliente guardado');
        } else {
          const newClient: Client = {
            ...(editingClient as Client),
            id: Math.random().toString(36).substr(2, 9),
            fechaRegistro: new Date().toLocaleDateString('es-CL'),
            historial: [{ fecha: new Date().toLocaleDateString('es-CL'), tipo: 'Creación', descripcion: 'Cliente registrado manualmente', usuario: currentUser.name }],
            documents: []
          };
          onAddClient(newClient);
          showToast?.('Prospecto creado');
        }
        setIsClientModalOpen(false);
        setEditingClient(null);
      } catch {
        showToast?.('Error al guardar cliente', 'error');
      }
    }
  };

  const handleToggleMenu = (clientId: string) => {
    setOpenMenuClientId(openMenuClientId === clientId ? null : clientId);
  };

  const handleCloseProspect = (client: Client) => {
    const updatedClient: Client = {
      ...client,
      estado: 'Cerrado',
      historial: [...client.historial, {
        fecha: new Date().toLocaleDateString('es-CL'),
        tipo: 'Cambio Estado',
        descripcion: 'Cierre manual del prospecto.',
        usuario: currentUser.name
      }]
    };
    onUpdateClient(updatedClient);
    setOpenMenuClientId(null);
  };

  const openAssignModal = (client: Client) => {
    setClientForAssignment(client);
    setIsAssignModalOpen(true);
    setOpenMenuClientId(null);
  };

  const openDesistModal = (client: Client) => {
    setClientToDesist(client);
    setSelectedDesistUnits([]);
    setIsDesistModalOpen(true);
    setOpenMenuClientId(null);
  };

  const handleConfirmAssignment = (unitId: string) => {
    if (clientForAssignment && onAssignUnit) {
      onAssignUnit(clientForAssignment.id, unitId);
      setIsAssignModalOpen(false);
      setClientForAssignment(null);
      setAssignSearchTerm('');
    }
  };

  const handleConfirmDesist = () => {
    if (clientToDesist && selectedDesistUnits.length > 0 && onProcessDesist) {
      onProcessDesist(clientToDesist.id, selectedDesistUnits, desistReason);
      setIsDesistModalOpen(false);
      setClientToDesist(null);
      setSelectedDesistUnits([]);
      setDesistReason('');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Cartera de Clientes</h2>
          <p className="text-gray-500 text-sm mt-1">Gestión de prospectos y clientes activos.</p>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={() => {
                    setBulkParsedClients([]);
                    setIsBulkModalOpen(true);
                }}
                className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm hover:bg-gray-50"
            >
                <FileSpreadsheet className="w-4 h-4 text-green-600" /> Carga Masiva
            </button>
            <button 
                onClick={() => {
                    setEditingClient({ tipoPersona: 'Natural', estado: 'Prospecto', nacionalidad: 'Chilena' });
                    setIsClientModalOpen(true);
                }}
                className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg hover:bg-blue-700"
            >
                <Plus className="w-4 h-4" /> Nuevo Prospecto
            </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Buscar por nombre, RUT o unidad..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 transition-all"
          />
        </div>
        <div className="flex bg-white p-1 rounded-xl border border-gray-200">
          {['Todos', 'Activo', 'Prospecto', 'Cerrado', 'Desistido'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterStatus === status ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="overflow-visible">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50/50 border-b border-gray-100">
              <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                <th className="px-6 py-4">Cliente</th>
                <th className="px-6 py-4">Contacto</th>
                <th className="px-6 py-4 text-center">Estado Comercial</th>
                <th className="px-6 py-4">Unidades</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedClients.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic">No se encontraron clientes para mostrar.</td></tr>
              ) : sortedClients.map(client => {
                const clientUnits = getDirectClientAssets(client.id);
                const isExpanded = expandedClientId === client.id;
                const isMenuOpen = openMenuClientId === client.id;
                
                return (
                  <React.Fragment key={client.id}>
                    <tr className={`hover:bg-blue-50/30 transition-colors group ${isExpanded ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm ${client.estado === 'Activo' ? 'bg-green-600' : 'bg-blue-600'}`}>
                            {client.nombre.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900">{client.nombre}</div>
                            <div className="text-xs text-gray-500 font-mono font-medium">{client.rut}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-gray-600 text-[11px] font-medium"><Mail className="w-3.5 h-3.5 text-gray-400" /> {client.email}</div>
                          <div className="flex items-center gap-1.5 text-gray-600 text-[11px] font-medium"><Phone className="w-3.5 h-3.5 text-gray-400" /> {client.telefono}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${getStatusStyle(client.estado)}`}>
                          {client.estado}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {clientUnits.map(u => (
                            <span 
                              key={u.id} 
                              onClick={() => onSelectUnit && onSelectUnit(u)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 text-[10px] font-black border border-blue-100 hover:bg-blue-600 hover:text-white cursor-pointer transition-colors"
                            >
                              {getUnitIcon(u.type)}{u.numero}
                            </span>
                          ))}
                          {clientUnits.length === 0 && <span className="text-gray-300 italic text-[11px] font-medium">Sin asignar</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end items-center gap-2 overflow-visible">
                          <div className="relative" ref={isMenuOpen ? menuRef : null}>
                            <button 
                              onClick={() => handleToggleMenu(client.id)}
                              className={`p-2 rounded-lg transition-all ${isMenuOpen ? 'bg-blue-100 text-blue-600 shadow-sm' : 'text-gray-400 hover:bg-gray-100'}`}
                            >
                              <MoreVertical className="w-5 h-5" />
                            </button>
                            
                            {isMenuOpen && (
                              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[100] py-2 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
                                <button 
                                  onClick={() => openAssignModal(client)}
                                  className="w-full text-left px-4 py-2 text-xs font-bold text-gray-700 hover:bg-blue-50 flex items-center gap-2"
                                >
                                  <UserPlus className="w-4 h-4 text-blue-600" /> Asignar Unidad
                                </button>
                                {client.estado === 'Prospecto' && (
                                  <button 
                                    onClick={() => handleCloseProspect(client)}
                                    className="w-full text-left px-4 py-2 text-xs font-bold text-gray-700 hover:bg-blue-50 flex items-center gap-2"
                                  >
                                    <FileCheck className="w-4 h-4 text-purple-600" /> Cerrar Prospecto
                                  </button>
                                )}
                                {clientUnits.length > 0 && (
                                  <button 
                                    onClick={() => openDesistModal(client)}
                                    className="w-full text-left px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2"
                                  >
                                    <Ban className="w-4 h-4" /> Desistimiento
                                  </button>
                                )}
                                <div className="border-t border-gray-50 my-1"></div>
                                <button 
                                  onClick={() => { setEditingClient(client); setIsClientModalOpen(true); setOpenMenuClientId(null); }}
                                  className="w-full text-left px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50 flex items-center gap-2"
                                >
                                  <Edit className="w-4 h-4" /> Editar Ficha
                                </button>
                              </div>
                            )}
                          </div>

                          <button 
                            onClick={() => setExpandedClientId(isExpanded ? null : client.id)}
                            className={`p-2 rounded-lg transition-all ${isExpanded ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-100'}`}
                          >
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    
                    {isExpanded && (
                      <tr className="bg-white">
                        <td colSpan={5} className="px-8 py-8 border-b border-blue-100/50">
                          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                            <div className="space-y-6">
                              <div>
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><UserIcon className="w-4 h-4 text-blue-600" /> Perfil Detallado</h4>
                                <div className="space-y-4 bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                                  <div><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Profesión</p><p className="text-[13px] font-bold text-gray-700">{client.profesion || '-'}</p></div>
                                  <div><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Nacionalidad</p><p className="text-[13px] font-bold text-gray-700">{client.nacionalidad || 'Chilena'}</p></div>
                                  <div><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Dirección</p><p className="text-[13px] font-bold text-gray-700">{client.direccion || '-'}, {client.comuna || ''}</p></div>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-6">
                              <div>
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-blue-600" /> Carpeta Digital</h4>
                                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                                  {(client.documents || []).map(doc => (
                                    <div key={doc.id} className="p-3 bg-white border border-gray-100 rounded-xl flex items-center justify-between group hover:border-blue-300 transition-colors">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><FileText className="w-4 h-4" /></div>
                                        <div><p className="text-xs font-bold text-gray-800 truncate w-32">{doc.name}</p><p className="text-[9px] text-gray-400 font-bold uppercase tracking-tight">{doc.date} • {doc.size}</p></div>
                                      </div>
                                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleDownloadDoc(doc)} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"><Download className="w-4 h-4" /></button>
                                        <button onClick={() => openDeleteModal(doc.id, doc.name, 'client', client.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                      </div>
                                    </div>
                                  ))}
                                  {(client.documents || []).length === 0 && <p className="text-center py-4 text-gray-300 italic text-[11px] font-medium">Sin documentos cargados</p>}
                                </div>
                                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                                <button onClick={handleTriggerUpload} className="w-full mt-3 py-2.5 border-2 border-dashed border-gray-200 text-gray-500 text-[11px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 hover:bg-gray-50 hover:border-blue-300 transition-all">
                                  <CloudUpload className="w-4 h-4" /> Cargar Documento
                                </button>
                              </div>
                            </div>

                            <div className="space-y-6">
                              <div>
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-600" /> Bitácora Histórica</h4>
                                <div className="space-y-4 max-h-[250px] overflow-y-auto pr-2 scrollbar-hide">
                                  {(client.historial || []).map((h, i) => (
                                    <div key={i} className="relative pl-6 border-l-2 border-gray-100 pb-4 last:pb-0">
                                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-2 border-blue-500"></div>
                                      <div className="flex justify-between items-start mb-1">
                                        <span className="text-[9px] font-black text-blue-600 uppercase tracking-tighter bg-blue-50 px-1.5 rounded">{h.tipo}</span>
                                        <span className="text-[9px] font-bold text-gray-400">{h.fecha}</span>
                                      </div>
                                      <p className="text-[11px] text-gray-700 font-bold leading-relaxed">{h.descripcion}</p>
                                      <p className="text-[9px] text-gray-400 mt-1 flex items-center gap-1 font-medium"><UserCheck className="w-3 h-3 text-gray-300" /> {h.usuario || 'Sistema'}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* ── Sección Cotizaciones (ACCIÓN 5) ─────────────────────────────── */}
                          <div className="mt-8 pt-8 border-t border-gray-100">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-blue-600" /> Cotizaciones Generadas
                            </h4>
                            {quotationsLoading[client.id] ? (
                              <p className="text-center py-4 text-gray-400 text-[11px] font-medium italic">Cargando cotizaciones…</p>
                            ) : !clientQuotations[client.id] || clientQuotations[client.id].length === 0 ? (
                              <p className="text-center py-4 text-gray-300 italic text-[11px] font-medium">Sin cotizaciones generadas</p>
                            ) : (
                              <>
                                <div className="overflow-x-auto rounded-xl border border-gray-100">
                                  <table className="min-w-full text-left text-xs">
                                    <thead className="bg-gray-50/80 border-b border-gray-100">
                                      <tr className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                        <th className="px-4 py-3">Proyecto</th>
                                        <th className="px-4 py-3">Unidades</th>
                                        <th className="px-4 py-3">Fecha</th>
                                        <th className="px-4 py-3 text-right">PDF</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {clientQuotations[client.id].map((q) => {
                                        const depto = q.selectedUnits?.find(u => u.type === 'Departamento');
                                        const accesorios = (q.selectedUnits?.filter(u => u.type !== 'Departamento') ?? [])
                                          .map(u => `${u.type === 'Bodega' ? 'Bod' : 'Est'} ${u.numero}`)
                                          .join(' · ');
                                        const fechaFmt = q.fechaGenerada
                                          ? (() => { try { const d = new Date(q.fechaGenerada); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; } catch { return q.fechaGenerada; } })()
                                          : '—';
                                        const projectName = projects.find(p => p.id === q.projectId)?.nombre ?? q.projectId ?? '—';
                                        const isReservada = q.selectedUnits?.some(su => {
                                          const u = units.find(u2 => u2.numero === su.numero);
                                          return u && ['Reservado', 'Promesado', 'Escriturado'].includes(u.estado);
                                        });
                                        return (
                                          <tr key={q.id} className="hover:bg-blue-50/20 transition-colors">
                                            <td className="px-4 py-3 font-bold text-gray-700">{projectName}</td>
                                            <td className="px-4 py-3">
                                              {depto ? (
                                                <div>
                                                  <div className="font-medium text-gray-800">Depto {depto.numero}</div>
                                                  {accesorios && <div className="text-[10px] text-gray-400 mt-0.5">{accesorios}</div>}
                                                </div>
                                              ) : q.selectedUnits.length > 0 ? (
                                                <div className="text-gray-600">{q.selectedUnits.map(u => `${u.type} ${u.numero}`).join(', ')}</div>
                                              ) : (
                                                <span className="text-gray-300 italic">—</span>
                                              )}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500">{fechaFmt}</td>
                                            <td className="px-4 py-3">
                                              <div className="flex items-center justify-end gap-2">
                                                <button
                                                  onClick={() => {
                                                    if (!q.pdfPath) return;
                                                    const tok = localStorage.getItem('dw_token');
                                                    if (!tok) return;
                                                    fetch(`/uploads/${q.pdfPath}`, { headers: { Authorization: `Bearer ${tok}` } })
                                                      .then(r => r.blob())
                                                      .then(blob => { const url = URL.createObjectURL(blob); window.open(url, '_blank'); })
                                                      .catch(() => { /* silencioso */ });
                                                  }}
                                                  disabled={!q.pdfPath}
                                                  title={q.pdfPath ? 'Descargar PDF' : 'PDF no disponible'}
                                                  className={`p-1.5 rounded-lg transition-colors ${q.pdfPath ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 cursor-pointer' : 'text-gray-300 bg-gray-50 cursor-not-allowed'}`}
                                                >
                                                  <Download className="w-3.5 h-3.5" />
                                                </button>
                                                <span
                                                  title={isReservada ? 'Unidad reservada' : 'Sin reserva'}
                                                  style={{ backgroundColor: isReservada ? '#639922' : '#888780' }}
                                                  className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                                                />
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-400 font-medium px-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#639922' }} />
                                    Unidad reservada
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#888780' }} />
                                    Sin reserva
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Asignación de Unidad */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-900">Asignar Unidad a {clientForAssignment?.nombre}</h3>
              <button onClick={() => setIsAssignModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input 
                  type="text" 
                  placeholder="Buscar unidad disponible..." 
                  value={assignSearchTerm}
                  onChange={(e) => setAssignSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {availableUnitsForAssignment.map(unit => (
                  <button 
                    key={unit.id}
                    onClick={() => handleConfirmAssignment(unit.id)}
                    className="p-4 bg-white border border-gray-200 rounded-2xl text-left hover:border-blue-500 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-2 bg-blue-50 rounded-lg text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        {getUnitIcon(unit.type)}
                      </div>
                      <span className="font-bold text-gray-900">{unit.numero}</span>
                    </div>
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{unit.type}</div>
                    <div className="text-xs font-black text-blue-600 mt-1 uppercase tracking-tighter">{unit.precioLista} UF</div>
                  </button>
                ))}
                {availableUnitsForAssignment.length === 0 && (
                  <div className="col-span-full py-12 text-center text-gray-400 italic">No hay unidades disponibles que coincidan con la búsqueda.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Desistimiento */}
      {isDesistModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-900">Procesar Desistimiento</h3>
              <button onClick={() => setIsDesistModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-8 space-y-6">
              <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                <p className="text-sm text-red-800 font-medium">Esta acción liberará las unidades seleccionadas y las volverá a poner en estado <strong>Disponible</strong>.</p>
              </div>
              
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase block mb-3 tracking-widest">Unidades a Liberar</label>
                <div className="space-y-2">
                  {getDirectClientAssets(clientToDesist?.id || '').map(unit => (
                    <label key={unit.id} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-white transition-all">
                      <input 
                        type="checkbox" 
                        checked={selectedDesistUnits.includes(unit.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedDesistUnits([...selectedDesistUnits, unit.id]);
                          else setSelectedDesistUnits(selectedDesistUnits.filter(id => id !== unit.id));
                        }}
                        className="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500" 
                      />
                      <div>
                        <span className="font-bold text-gray-900">{unit.type} {unit.numero}</span>
                        <span className="text-[10px] text-gray-400 block font-bold uppercase tracking-tight">Precio Venta: {unit.precioVenta} UF</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase block mb-2 tracking-widest">Motivo del Desistimiento</label>
                <textarea 
                  required
                  value={desistReason}
                  onChange={(e) => setDesistReason(e.target.value)}
                  placeholder="Ej: Problemas con el crédito hipotecario, cambio de opinión, etc."
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-red-100 transition-all min-h-[100px]"
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={() => setIsDesistModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl uppercase tracking-widest text-[11px]">Cancelar</button>
                <button 
                  disabled={selectedDesistUnits.length === 0 || !desistReason}
                  onClick={handleConfirmDesist} 
                  className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 uppercase tracking-widest text-[11px]"
                >
                  Confirmar Desistimiento
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ficha Cliente — Puntos 4+5: formulario completo iguales al Cotizador */}
      {isClientModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-900">{editingClient?.id ? 'Editar Ficha' : 'Nuevo Prospecto'}</h3>
              <button onClick={() => setIsClientModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleSaveClient} className="p-6 space-y-5 overflow-y-auto">

              {/* Perfil legal + Estado */}
              <div className="flex gap-4 items-start">
                <div className="flex-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Perfil Legal</label>
                  <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                    {(['Natural', 'Juridica'] as const).map(t => (
                      <button key={t} type="button"
                        onClick={() => setEditingClient({...editingClient, tipoPersona: t})}
                        className={`flex-1 px-4 py-2 rounded-lg font-bold text-xs transition-all ${editingClient?.tipoPersona === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>
                        {t === 'Natural' ? 'Persona Natural' : 'Persona Jurídica'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="w-40">
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Estado</label>
                  <select value={editingClient?.estado || 'Prospecto'}
                    onChange={e => setEditingClient({...editingClient, estado: e.target.value as Client['estado']})}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100">
                    <option value="Prospecto">Prospecto</option>
                    <option value="Activo">Activo</option>
                    <option value="Cerrado">Cerrado</option>
                    <option value="Desistido">Desistido</option>
                  </select>
                </div>
              </div>

              {/* Datos básicos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Nombre Completo / Razón Social *</label>
                  <input required type="text" value={editingClient?.nombre || ''}
                    onChange={e => setEditingClient({...editingClient, nombre: e.target.value})}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">
                    RUT * {editingClient?.rut && !isValidRut(editingClient.rut) && (
                      <span className="text-red-500 ml-1 normal-case">inválido</span>
                    )}
                  </label>
                  <input required type="text" value={editingClient?.rut || ''}
                    onChange={e => setEditingClient({...editingClient, rut: e.target.value})}
                    placeholder="12.345.678-9"
                    className={`w-full p-2.5 bg-gray-50 border rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-100 ${editingClient?.rut && !isValidRut(editingClient.rut) ? 'border-red-300' : 'border-gray-200'}`} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Nacionalidad</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                    <input type="text" value={editingClient?.nacionalidad || 'Chilena'}
                      onChange={e => setEditingClient({...editingClient, nacionalidad: e.target.value})}
                      className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Email *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                    <input required type="email" value={editingClient?.email || ''}
                      onChange={e => setEditingClient({...editingClient, email: e.target.value})}
                      className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Teléfono *</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                    <input required type="text" value={editingClient?.telefono || ''}
                      onChange={e => setEditingClient({...editingClient, telefono: e.target.value})}
                      className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
              </div>

              {/* Campos Persona Natural */}
              {editingClient?.tipoPersona !== 'Juridica' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-gray-100">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Profesión / Oficio</label>
                    <div className="relative">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                      <input type="text" value={editingClient?.profesion || ''}
                        onChange={e => setEditingClient({...editingClient, profesion: e.target.value})}
                        className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Rango de Sueldo</label>
                    <div className="relative">
                      <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                      <select value={editingClient?.sueldoRange || ''}
                        onChange={e => setEditingClient({...editingClient, sueldoRange: e.target.value})}
                        className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 appearance-none">
                        <option value="">Seleccionar…</option>
                        {['<$1.0M','$1.0M - $2.0M','$2.0M - $3.5M','$3.5M - $5.0M','>$5.0M'].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Fecha Nacimiento</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                      <input type="date" value={editingClient?.fechaNacimiento || ''}
                        onChange={e => setEditingClient({...editingClient, fechaNacimiento: e.target.value})}
                        className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                  </div>
                </div>
              )}

              {/* Campos Persona Jurídica */}
              {editingClient?.tipoPersona === 'Juridica' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-gray-100">
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-black text-blue-600 uppercase block mb-1.5 tracking-widest flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" /> Representante Legal
                    </label>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Nombre Representante</label>
                    <input type="text" value={editingClient?.representanteNombre || ''}
                      onChange={e => setEditingClient({...editingClient, representanteNombre: e.target.value})}
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">RUT Representante</label>
                    <input type="text" value={editingClient?.representanteRut || ''}
                      onChange={e => setEditingClient({...editingClient, representanteRut: e.target.value})}
                      placeholder="12.345.678-9"
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
              )}

              {/* Ubicación */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-gray-100">
                <div className="md:col-span-3">
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Dirección</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                    <input type="text" value={editingClient?.direccion || ''}
                      onChange={e => setEditingClient({...editingClient, direccion: e.target.value})}
                      placeholder="Calle, número, depto…"
                      className="w-full pl-8 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Comuna</label>
                  <input type="text" value={editingClient?.comuna || ''}
                    onChange={e => setEditingClient({...editingClient, comuna: e.target.value})}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Ciudad</label>
                  <input type="text" value={editingClient?.ciudad || ''}
                    onChange={e => setEditingClient({...editingClient, ciudad: e.target.value})}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase block mb-1.5 tracking-widest">Región</label>
                  <input type="text" value={editingClient?.region || ''}
                    onChange={e => setEditingClient({...editingClient, region: e.target.value})}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button type="button" onClick={() => setIsClientModalOpen(false)}
                  className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl uppercase tracking-widest text-[11px]">
                  Cancelar
                </button>
                <button type="submit"
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[11px]">
                  <Save className="w-5 h-5" /> Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Upload Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50"><h3 className="text-xl font-bold text-gray-900">Carga Masiva de Prospectos</h3><button onClick={() => setIsBulkModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6" /></button></div>
            <div className="p-8 space-y-6">
              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4">
                <div className="p-2 bg-blue-600 text-white rounded-lg"><Info className="w-6 h-6" /></div>
                <div><h4 className="font-bold text-blue-900">Instrucciones de Carga</h4><p className="text-sm text-blue-700 mt-1">Descarga la plantilla, completa los datos de tus prospectos y sube el archivo Excel (.xlsx).</p><button onClick={handleDownloadTemplate} className="mt-4 text-xs font-black bg-white text-blue-600 px-4 py-2 rounded-lg border border-blue-200 flex items-center gap-2 hover:bg-blue-50 shadow-sm uppercase tracking-widest"><Download className="w-4 h-4" /> Descargar Plantilla</button></div>
              </div>
              <div onClick={() => bulkFileInputRef.current?.click()} className="border-3 border-dashed border-gray-200 rounded-3xl p-12 flex flex-col items-center justify-center gap-4 hover:border-blue-400 hover:bg-blue-50/10 cursor-pointer transition-all">
                <input type="file" ref={bulkFileInputRef} onChange={handleBulkFileChange} className="hidden" accept=".xlsx, .xls" />
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-400"><Upload className="w-10 h-10" /></div>
                <div className="text-center"><p className="text-lg font-bold text-gray-700">{bulkParsedClients.length > 0 ? `${bulkParsedClients.length} prospectos listos` : 'Sube tu Excel aquí'}</p><p className="text-xs text-gray-400 mt-1">{bulkParsedClients.length > 0 ? 'Haz clic para cambiar archivo' : 'Soporta formatos .xlsx y .xls'}</p></div>
              </div>
              <div className="flex gap-4"><button onClick={() => setIsBulkModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl uppercase tracking-widest text-[11px]">Cancelar</button><button disabled={bulkParsedClients.length === 0} onClick={handleConfirmBulkUpload} className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg hover:bg-green-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[11px]"><CheckSquare className="w-5 h-5" /> Importar Prospectos</button></div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Eliminación Documento */}
      {deleteConfirmation && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto shadow-sm"><Trash2 className="w-8 h-8" /></div>
            <div><h3 className="text-xl font-bold text-gray-900">¿Eliminar Documento?</h3><p className="text-sm text-gray-500 mt-2">Estás por eliminar <strong>{deleteConfirmation.docName}</strong>. Esta acción no se puede deshacer.</p></div>
            <div className="flex gap-3"><button onClick={() => setDeleteConfirmation(null)} className="flex-1 py-3 bg-gray-50 text-gray-600 font-bold rounded-xl hover:bg-gray-100 transition-colors uppercase tracking-widest text-[11px]">Cancelar</button><button onClick={handleDeleteDoc} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg hover:bg-red-700 transition-all uppercase tracking-widest text-[11px]">Eliminar</button></div>
          </div>
        </div>
      )}

    </div>
  );
};
