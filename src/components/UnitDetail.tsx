import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RealEstateUnit, Client, PaymentItem, User, PaymentPlan, OcupacionEntry } from '../types';
import {
  ArrowLeft, Save, Trash2, Building2,
  AlertTriangle, CreditCard, RefreshCw,
  Wallet, Sparkles, Coins, ExternalLink,
  Calendar, Landmark, ClipboardList, Plus,
  Ruler, Layers, Bed, Bath, Compass, Info,
  Banknote, Percent, CheckCircle2, FileText,
  Key, Target, FileCheck, Clock, Tag,
  Car, Package, Scale, FileSignature, ChevronDown, Check, History, User as UserIcon,
  Search, X, UserPlus, MoreVertical
} from 'lucide-react';
import { AssetTagInput } from './AssetTagInput';
import { calcBonoPie } from '../utils/bonoPieCalc';

interface UnitDetailProps {
  unit: RealEstateUnit;
  client?: Client;
  onBack: () => void;
  onUpdate: (unit: RealEstateUnit) => void;
  allUnits?: RealEstateUnit[];
  currentUser: User;
  onSelectClient?: (clientId: string) => void;
  // Asignación desde UnitDetail
  clients?: Client[];
  onAssignClient?: (clientId: string, unitId: string) => void;
  onUnassignClient?: (unitId: string) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

// Formateador estricto: Miles con punto, 1 decimal con coma (Ej: 4.565,0)
const formatValueStandard = (val: number) => {
    return val.toLocaleString('es-CL', { 
        minimumFractionDigits: 1, 
        maximumFractionDigits: 1 
    });
};

const FormattedInput = ({ value, onChange, className, placeholder, disabled, format = 'UF', title }: { value: number, onChange: (val: number) => void, className?: string, placeholder?: string, disabled?: boolean, format?: 'UF' | 'CLP' | 'PERCENT', title?: string }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value?.toString() || '0');

    const formatValue = (val: number) => {
        if (format === 'CLP') {
            return val.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });
        }
        if (format === 'PERCENT') {
            return val.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
        }
        return formatValueStandard(val);
    };

    useEffect(() => {
        if (!isEditing) {
            setLocalValue(formatValue(value || 0));
        }
    }, [value, isEditing]);

    const handleBlur = () => {
        setIsEditing(false);
        let clean = localValue.replace(/[^\d,.-]/g, '');
        clean = clean.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(clean);
        if (!isNaN(num)) onChange(num);
        else setLocalValue(formatValue(value || 0));
    };

    return (
        <input
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onFocus={() => !disabled && setIsEditing(true)}
            className={`${className} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            placeholder={placeholder}
            disabled={disabled}
            title={title}
        />
    );
};

interface UnitDraft {
  id: string;
  clienteNombre: string;
  clienteRut: string;
  updated_at: string;
  estado?: string;
  fecha_generada?: string;
  data: Record<string, unknown>;
}

export const UnitDetail: React.FC<UnitDetailProps> = ({
  unit, client, onBack, onUpdate, allUnits = [], currentUser, onSelectClient,
  clients = [], onAssignClient, onUnassignClient, showToast,
}) => {
  const [formData, setFormData] = useState<RealEstateUnit>(unit);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientMenuRef = useRef<HTMLDivElement>(null);

  // ── Forma de Pago ──────────────────────────────────────────────────────────
  const [unitDrafts, setUnitDrafts] = useState<UnitDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [cantidadCuotasPie, setCantidadCuotasPie] = useState(36);
  const [fpPromesaPct, setFpPromesaPct] = useState(10);
  const [fpCuotasPct, setFpCuotasPct] = useState(20);
  const [fpEscrituraPct, setFpEscrituraPct] = useState(10);
  const fpCreditoPct = Math.max(0, 100 - fpPromesaPct - fpCuotasPct - fpEscrituraPct);
  const [fpSaving, setFpSaving] = useState(false);
  const [fpSaved, setFpSaved] = useState(false);

  // ── Panel de descuento ─────────────────────────────────────────────────────
  const [discountCfg, setDiscountCfg] = useState<{ jefeMaxPct: number; supervisorMaxPct: number }>({ jefeMaxPct: 3, supervisorMaxPct: 7 });
  const [discountInput, setDiscountInput] = useState('');
  const [discountError, setDiscountError] = useState('');
  const [discountPending, setDiscountPending] = useState(false);

  // ── Bono Pie ───────────────────────────────────────────────────────────────
  const [bonoPct, setBonoPct] = useState(0);
  const [hasBono, setHasBono] = useState(unit.aplicaBonoPie ?? false);

  useEffect(() => {
    const token = localStorage.getItem('dw_token');
    if (!token || !unit.projectId) return;
    fetch(`/api/projects/${unit.projectId}/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { discountConfig?: { jefeMaxPct?: number; supervisorMaxPct?: number; bonoPiePct?: number }; cantidadCuotasPie?: number } | null) => {
        if (d?.discountConfig) {
          setDiscountCfg({
            jefeMaxPct: d.discountConfig.jefeMaxPct ?? 3,
            supervisorMaxPct: d.discountConfig.supervisorMaxPct ?? 7,
          });
          setBonoPct(d.discountConfig.bonoPiePct ?? 10);
        } else {
          setBonoPct(10);
        }
        if (d?.cantidadCuotasPie != null) {
          setCantidadCuotasPie(d.cantidadCuotasPie);
        }
      })
      .catch(() => {});
  }, [unit.projectId]);

  const loadPaymentPlans = (rutFilter?: string) => {
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    const params = new URLSearchParams({ unitNumero: unit.numero, projectId: unit.projectId });
    if (rutFilter) params.set('clienteRut', rutFilter);
    fetch(`/api/payment-plans?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((plans: PaymentPlan[]) => {
        setPaymentPlans(plans);
        if (plans.length > 0) {
          const first = plans[0];
          setSelectedPlanId(first.id);
          setFpPromesaPct(first.promesaPct);
          setFpCuotasPct(first.cuotasPct);
          setFpEscrituraPct(first.escrituraPct);
          if (first.cuotasN > 0) setCantidadCuotasPie(first.cuotasN);
        }
      })
      .catch(() => {});
  };

  // Load payment plans when unit has a client
  useEffect(() => {
    if (!unit.clienteId) return;
    const rut = client?.rut;
    loadPaymentPlans(rut);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.numero, unit.projectId, unit.clienteId]);

  useEffect(() => {
    setDiscountInput(formData.descuentoPct?.toString() || '');
    setDiscountPending(formData.descuentoPendiente || false);
    setDiscountError('');
  }, [unit.id]);

  const applyUnitDiscount = async () => {
    const rawValue = parseFloat(discountInput);
    if (isNaN(rawValue) || rawValue < 0) {
      setDiscountError('Ingrese un número positivo entre 0 y el límite permitido.');
      return;
    }
    if (rawValue === 0) {
      setFormData(prev => ({ ...prev, descuentoPct: 0, precioVenta: prev.precioLista, descuentoPendiente: false }));
      setDiscountPending(false);
      setDiscountError('');
      return;
    }
    if (rawValue > discountCfg.supervisorMaxPct) {
      setDiscountError(`El descuento máximo permitido es ${discountCfg.supervisorMaxPct}%`);
      return;
    }
    setDiscountError('');
    const precioVenta = Math.round(formData.precioLista * (1 - rawValue / 100) * 100) / 100;
    const descuentoMonto = Math.round((formData.precioLista - precioVenta) * 100) / 100;

    if (['Admin', 'JefeSala', 'Supervisor'].includes(currentUser.role)) {
      const now = new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      setFormData(prev => ({
        ...prev,
        descuentoPct: rawValue,
        precioVenta,
        descuentoPendiente: false,
        observaciones: `[SISTEMA ${now} - ${currentUser.name}]\n• Descuento ${rawValue}% aplicado → Precio Venta: ${precioVenta} UF\n\n` + (prev.observaciones || ''),
      }));
      setDiscountPending(false);
    } else if (currentUser.role === 'Ventas') {
      const token = localStorage.getItem('dw_token');
      if (!token) return;
      try {
        const res = await fetch('/api/discount-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            projectId: unit.projectId, unitId: unit.id, unitNumero: unit.numero,
            precioOriginal: formData.precioLista, precioSolicitado: precioVenta,
            descuentoPct: rawValue, descuentoMonto,
            origen: 'UnitDetail', cotizacionId: null,
          }),
        });
        if (res.ok) {
          const dr = await res.json() as { id: string };
          setFormData(prev => ({ ...prev, descuentoPct: rawValue, descuentoPendiente: true, descuentoSolicitudId: dr.id }));
          setDiscountPending(true);
          const msg = rawValue > discountCfg.jefeMaxPct
            ? `Descuento ${rawValue}% — requiere aprobación de JefeSala y Supervisor.`
            : `Descuento ${rawValue}% — requiere aprobación de JefeSala.`;
          setDiscountError(msg);
        } else {
          setDiscountError('Error al enviar solicitud.');
        }
      } catch {
        setDiscountError('No se pudo conectar con el servidor.');
      }
    }
  };

  const handleSelectDraft = (draftId: string) => {
    setSelectedDraftId(draftId);
    const d = unitDrafts.find(x => x.id === draftId);
    if (!d) return;
    const data = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
    const adj = (data?.adjustments ?? []) as { key: string; value: unknown }[];
    const pc = adj.find(a => a.key === 'paymentConfig')?.value as Record<string, unknown> | undefined;
    if (pc) {
      setFpPromesaPct(parseFloat(String(pc.promesaPct ?? 10)));
      setFpCuotasPct(parseFloat(String(pc.cuotasPct ?? 20)));
      setFpEscrituraPct(parseFloat(String(pc.escrituraPct ?? 10)));
    }
  };

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    const plan = paymentPlans.find(p => p.id === planId);
    if (!plan) return;
    setFpPromesaPct(plan.promesaPct);
    setFpCuotasPct(plan.cuotasPct);
    setFpEscrituraPct(plan.escrituraPct);
    if (plan.cuotasN > 0) setCantidadCuotasPie(plan.cuotasN);
  };

  const saveFormaPago = async () => {
    if (!selectedDraftId || fpSaving) return;
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    const draft = unitDrafts.find(d => d.id === selectedDraftId);
    if (!draft) return;
    setFpSaving(true);
    try {
      const draftData = typeof draft.data === 'string' ? JSON.parse(draft.data) : draft.data;
      const adjustments = (draftData?.adjustments ?? []) as { key: string; value: unknown }[];
      const filtered = adjustments.filter(a => a.key !== 'paymentConfig');
      filtered.push({ key: 'paymentConfig', value: { promesaPct: fpPromesaPct, cuotasPct: fpCuotasPct, escrituraPct: fpEscrituraPct, creditoPct: fpCreditoPct } });
      await fetch('/api/quotation-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...draftData, id: draft.id, adjustments: filtered }),
      });
      setFpSaved(true);
      setTimeout(() => setFpSaved(false), 2500);
      showToast?.('Forma de pago guardada');
    } catch { /* ignore */ }
    setFpSaving(false);
  };

  const isReadOnly = currentUser.role === 'Lectura';
  const puedeReasignar = ['Admin', 'Supervisor', 'JefeSala'].includes(currentUser.role);
  const canAssign = currentUser.role !== 'Lectura' && (!formData.clienteId || puedeReasignar);

  // Cierra el menú al hacer clic fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) {
        setClientMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Clientes visibles según rol
  const assignableClients = useMemo(() => {
    if (!clients.length || !canAssign) return [];
    const projectClients = clients.filter(c => c.projectId === unit.projectId);
    switch (currentUser.role) {
      case 'Admin':
      case 'Supervisor':
        return projectClients;
      case 'JefeSala':
        if (!currentUser.assignedProjectIds?.includes(unit.projectId)) return [];
        return projectClients;
      case 'Ventas':
        return projectClients.filter(c => {
          if (c.estado === 'Activo') return c.ejecutivoId === currentUser.id;
          return ['Prospecto', 'Cerrado', 'Desistido'].includes(c.estado);
        });
      default:
        return [];
    }
  }, [clients, unit.projectId, currentUser, canAssign]);

  const searchedClients = useMemo(() => {
    const term = assignSearch.trim().toLowerCase();
    if (!term) return assignableClients;
    return assignableClients.filter(c =>
      c.nombre.toLowerCase().includes(term) || c.rut.toLowerCase().includes(term),
    );
  }, [assignableClients, assignSearch]);
  // Derivar cliente desde formData.clienteId (Fix C): se actualiza cuando formData sincroniza
  const currentClient = useMemo(
    () => clients.find(c => c.id === formData.clienteId) ?? client,
    [clients, formData.clienteId, client],
  );
  const hasClient = !!formData.clienteId;

  const linkedAssets = useMemo(() => {
      const parkings = allUnits.filter(u => u.type === 'Estacionamiento' && formData.estacionamientos.includes(u.numero));
      const storages = allUnits.filter(u => u.type === 'Bodega' && formData.bodegas.includes(u.numero));
      return { parkings, storages };
  }, [allUnits, formData.estacionamientos, formData.bodegas]);

  const totalPrecioListaAcumulado = useMemo(() => {
    const deptoPrice = formData.precioLista || 0;
    const parkingsPrice = linkedAssets.parkings.reduce((acc, p) => acc + (p.precioLista || 0), 0);
    const storagesPrice = linkedAssets.storages.reduce((acc, b) => acc + (b.precioLista || 0), 0);
    return deptoPrice + parkingsPrice + storagesPrice;
  }, [formData.precioLista, linkedAssets]);

  useEffect(() => {
    if (formData.precioVenta === 0 && totalPrecioListaAcumulado > 0) {
      setFormData(prev => ({ ...prev, precioVenta: totalPrecioListaAcumulado }));
    }
  }, [totalPrecioListaAcumulado]);

  // Cálculo bono pie para Estructura Financiera (usa util compartido con Quoter)
  const bonoCalc = useMemo(() => {
    const descuentoPct = formData.descuentoPct ?? 0;
    return calcBonoPie(
      totalPrecioListaAcumulado,
      descuentoPct,
      bonoPct > 0 ? bonoPct : 10,
      hasBono,
    );
  }, [hasBono, bonoPct, totalPrecioListaAcumulado, formData.descuentoPct]);


  // Sincronizar formData cuando cambian datos clave de la unidad (Fix A)
  useEffect(() => {
    setFormData(unit);
  }, [
    unit.id,
    unit.clienteId,
    unit.estado,
    unit.fechaAsignacion,
    unit.asignadoPor,
    unit.fechaReserva,
  ]);

  const handleChange = (field: keyof RealEstateUnit, value: any) => {
    if (isReadOnly) return;

    let updatedEstado = formData.estado;
    const extraUpdates: Partial<RealEstateUnit> = {};
    const hoy = new Date().toISOString().split('T')[0];

    if (field === 'estado') {
        if (value === 'Reservado' && !formData.fechaReserva) {
            extraUpdates.fechaReserva = hoy;
        }
        if (value === 'Promesado' && !formData.fechaPromesa) {
            extraUpdates.fechaPromesa = hoy;
        }
        if (value === 'Escriturado' && !formData.fechaEscritura) {
            extraUpdates.fechaEscritura = hoy;
        }
        // Cambio de estado es acción deliberada — persiste inmediatamente sin esperar "Guardar"
        const immediateUnit: RealEstateUnit = { ...formData, ...extraUpdates, estado: value };
        setFormData(immediateUnit);
        onUpdate(immediateUnit);
        showToast?.(`Estado actualizado a ${value}`);
        return;
    } else if (field === 'fechaReserva' && value) {
        updatedEstado = 'Reservado';
    } else if (field === 'fechaPromesa' && value) {
        updatedEstado = 'Promesado';
    } else if (field === 'fechaEscritura' && value) {
        updatedEstado = 'Escriturado';
    }

    setFormData(prev => ({
        ...prev,
        ...extraUpdates,
        [field]: value,
        estado: updatedEstado
    }));
  };

  const handleSaveWithLog = () => {
    const logs: string[] = [];
    const now = new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const userHeader = `[SISTEMA ${now} - ${currentUser.name}]`;

    // 1. Detectar Cambios de Estado
    if (unit.estado !== formData.estado) {
        logs.push(`Estado: ${unit.estado} → ${formData.estado}`);
    }

    // 2. Detectar Cambios en Hitos (Fechas)
    const dateFields: (keyof RealEstateUnit)[] = ['fechaReserva', 'fechaPromesa', 'fechaEscritura', 'fechaSolicitudCredito', 'fechaAprobacionCredito', 'fechaEntrega', 'fechaAlzamiento'];
    dateFields.forEach(f => {
        if (unit[f] !== formData[f]) {
            const label = f.replace('fecha', 'Fecha ');
            logs.push(`${label}: ${unit[f] || '(Vacío)'} → ${formData[f] || '(Eliminado)'}`);
        }
    });

    // 3. Detectar Cambios Financieros
    if (unit.precioVenta !== formData.precioVenta) logs.push(`P. Venta: ${unit.precioVenta} → ${formData.precioVenta} UF`);
    if ((unit.descuentoPct || 0) !== (formData.descuentoPct || 0)) logs.push(`Descuento: ${unit.descuentoPct || 0}% → ${formData.descuentoPct || 0}%`);
    if (unit.reservaMonto !== formData.reservaMonto) logs.push(`Reserva: ${unit.reservaMonto} → ${formData.reservaMonto} UF`);
    if (unit.pie !== formData.pie) logs.push(`Pie: ${unit.pie} → ${formData.pie} UF`);

    // 4. Detectar Cambios en Activos Vinculados
    if (JSON.stringify(unit.estacionamientos) !== JSON.stringify(formData.estacionamientos)) {
        logs.push(`Estacionamientos actualizados: [${formData.estacionamientos.join(', ')}]`);
    }
    if (JSON.stringify(unit.bodegas) !== JSON.stringify(formData.bodegas)) {
        logs.push(`Bodegas actualizadas: [${formData.bodegas.join(', ')}]`);
    }

    let finalObservaciones = formData.observaciones;
    if (logs.length > 0) {
        const autoLog = `${userHeader}\n• ${logs.join('\n• ')}\n\n`;
        finalObservaciones = autoLog + (formData.observaciones || '');
    }

    try {
      onUpdate({
          ...formData,
          observaciones: finalObservaciones
      });
      showToast?.('Cambios guardados');
    } catch {
      showToast?.('Error al guardar', 'error');
    }
  };

  const addManualPayment = () => {
      if (isReadOnly) return;
      setFormData(prev => {
          const nextId = `Cuota ${prev.planPagos.length + 1}`;

          let nextDate = '';
          if (prev.planPagos.length === 0) {
              // Lógica Tarea Puntual: Primer día hábil del siguiente mes
              const now = new Date();
              const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
              const dayOfWeek = d.getDay(); // 0=Domingo, 6=Sábado
              if (dayOfWeek === 0) d.setDate(2); // Mover a Lunes
              else if (dayOfWeek === 6) d.setDate(3); // Mover a Lunes
              nextDate = d.toISOString().split('T')[0];
          } else {
              // Lógica Tarea Puntual: El día 1 de los meses siguientes
              const lastPayment = prev.planPagos[prev.planPagos.length - 1];
              const lastDate = new Date(lastPayment.date + 'T00:00:00');
              const d = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);
              nextDate = d.toISOString().split('T')[0];
          }

          const newItem: PaymentItem = {
              id: nextId,
              date: nextDate,
              amount: '0',
              status: 'Pendiente',
              fechaPagoReal: '',
              observacion: ''
          };
          return { ...prev, planPagos: [...prev.planPagos, newItem] };
      });
  };

  const generatePaymentSchedule = () => {
    if (isReadOnly) return;

    // Precio base: bonoCalc.precioVenta (con descuento y bono aplicados), fallback a precioLista
    const precioVentaFinal = bonoCalc.precioVenta > 0 ? bonoCalc.precioVenta : (unit.precioLista || 0);
    if (precioVentaFinal === 0) return;

    // Usar cuotasN del plan de pago seleccionado, fallback al config del proyecto
    const planCuotasN = paymentPlans.find(p => p.id === selectedPlanId)?.cuotasN ?? 0;
    const cuotasN = planCuotasN > 0 ? planCuotasN : cantidadCuotasPie;

    // Calcular montos en UF (4 decimales para precisión)
    const round4 = (n: number) => Math.round(n * 10000) / 10000;
    const ufPromesa     = round4(precioVentaFinal * fpPromesaPct / 100);
    const ufCuotaUnit   = cuotasN > 0 ? round4(round4(precioVentaFinal * fpCuotasPct / 100) / cuotasN) : 0;
    const ufEscritura   = round4(precioVentaFinal * fpEscrituraPct / 100);
    const ufCredito     = round4(precioVentaFinal * fpCreditoPct / 100);

    console.log('[generatePaymentSchedule]', {
      fpPromesaPct, fpCuotasPct, fpEscrituraPct, fpCreditoPct,
      precioVentaFinal, cuotasN,
      ufPromesa, ufCuotaUnit, ufEscritura, ufCredito,
    });

    const today = new Date();
    let monthCursor = 1;
    const nuevasCuotas: PaymentItem[] = [];

    // 1. Promesa — primer día hábil del mes siguiente
    if (fpPromesaPct > 0 && ufPromesa > 0) {
      const d = new Date(today.getFullYear(), today.getMonth() + monthCursor, 1);
      const dow = d.getDay();
      if (dow === 0) d.setDate(2);
      else if (dow === 6) d.setDate(3);
      nuevasCuotas.push({ id: 'Promesa', date: d.toISOString().split('T')[0], amount: ufPromesa.toFixed(4), status: 'Pendiente' });
      monthCursor++;
    }

    // 2. Cuotas del pie — día 1 de cada mes consecutivo
    if (fpCuotasPct > 0 && cuotasN > 0 && ufCuotaUnit > 0) {
      for (let i = 1; i <= cuotasN; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + monthCursor, 1);
        nuevasCuotas.push({ id: `Cuota ${i}`, date: d.toISOString().split('T')[0], amount: ufCuotaUnit.toFixed(4), status: 'Pendiente' });
        monthCursor++;
      }
    }

    // 3. Escritura y Crédito — día 1 del mes siguiente a la última cuota
    const fechaFinal = new Date(today.getFullYear(), today.getMonth() + monthCursor, 1).toISOString().split('T')[0];

    if (fpEscrituraPct > 0 && ufEscritura > 0) {
      nuevasCuotas.push({ id: 'Escritura', date: fechaFinal, amount: ufEscritura.toFixed(4), status: 'Pendiente' });
    }
    if (fpCreditoPct > 0 && ufCredito > 0) {
      nuevasCuotas.push({ id: 'Crédito Hipotecario', date: fechaFinal, amount: ufCredito.toFixed(4), status: 'Pendiente', observacion: 'Financiamiento bancario' });
    }

    if (nuevasCuotas.length === 0) return;

    setFormData(prev => ({ ...prev, planPagos: [...(prev.planPagos || []), ...nuevasCuotas] }));
    showToast?.(`✓ ${nuevasCuotas.length} cuotas generadas en el cronograma`);
  };

  const totalPaidReal = formData.planPagos.filter(p => p.status === 'Pagado').reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
  const totalPlanificado = formData.planPagos.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
  const totalEstructuraFinanciera = (formData.reservaMonto || 0) + (formData.pie || 0);
  
  const saldoPorFinanciarEstructural = Math.max(0, formData.precioVenta - (formData.pie || 0));
  const percentPaid = formData.precioVenta > 0 ? (totalPaidReal / formData.precioVenta) * 100 : 0;

  const isDelayed = (dueStr: string, realStr?: string) => {
      if (!dueStr || !realStr) return false;
      return new Date(realStr) > new Date(dueStr);
  };

  return (
    <div className="animate-in slide-in-from-right duration-300 pb-20">
      
      {/* Cabecera Principal */}
      <div className="mb-6 pb-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{formData.type} {formData.numero}</h1>
                    <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">Expediente de Transacción</p>
                </div>
                <select
                    disabled={isReadOnly}
                    value={formData.estado}
                    onChange={(e) => handleChange('estado', e.target.value)}
                    className="ml-4 px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 bg-white shadow-sm outline-none cursor-pointer focus:ring-2 focus:ring-blue-100"
                >
                    {['Disponible', 'Reservado', 'Promesado', 'Escriturado'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>
            {!isReadOnly && (
                <button onClick={handleSaveWithLog} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 flex items-center gap-2 shadow-lg transition-all active:scale-95">
                    <Save className="w-4 h-4" /> Guardar Cambios
                </button>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        <div className="xl:col-span-8 space-y-6">
          
          {/* Tarjeta de Comprador y Activos */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
              <div>
                <h3 className="text-xs font-bold text-gray-400 mb-4 flex items-center gap-2 uppercase tracking-widest"><Building2 className="w-4 h-4" /> Titular de Operación</h3>
                {currentClient ? (
                  <div className="relative" ref={clientMenuRef}>
                    <div
                      className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between cursor-pointer hover:border-blue-200 hover:bg-blue-50/30 transition-all group"
                      title="Clic para gestionar"
                      onClick={() => setClientMenuOpen(v => !v)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-sm">{currentClient.nombre.charAt(0)}</div>
                        <div>
                          <div className="font-bold text-gray-900 text-base">{currentClient.nombre}</div>
                          <div className="text-xs text-gray-500 font-mono">{currentClient.rut} • {currentClient.email}</div>
                        </div>
                      </div>
                      <MoreVertical className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
                    </div>
                    {clientMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-xl w-52 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                        <button
                          onClick={() => { setClientMenuOpen(false); onSelectClient?.(currentClient.id); }}
                          className="w-full px-4 py-3 text-sm font-medium text-left hover:bg-gray-50 flex items-center gap-3"
                        >
                          <ExternalLink className="w-4 h-4 text-blue-500" /> Ver Expediente
                        </button>
                        {canAssign && onAssignClient && (
                          <button
                            onClick={() => { setClientMenuOpen(false); setAssignSearch(''); setIsAssignModalOpen(true); }}
                            className="w-full px-4 py-3 text-sm font-medium text-left hover:bg-gray-50 flex items-center gap-3"
                          >
                            <UserPlus className="w-4 h-4 text-green-500" /> Reasignar Cliente
                          </button>
                        )}
                        {canAssign && onUnassignClient && (
                          <button
                            onClick={() => { setClientMenuOpen(false); onUnassignClient(unit.id); }}
                            className="w-full px-4 py-3 text-sm font-medium text-left hover:bg-red-50 text-red-600 flex items-center gap-3"
                          >
                            <X className="w-4 h-4" /> Desasignar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={() => canAssign && onAssignClient && (setAssignSearch(''), setIsAssignModalOpen(true))}
                    title={canAssign ? 'Clic para asignar cliente' : ''}
                    className={`p-8 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 text-sm font-medium italic flex items-center justify-center gap-2 transition-all ${canAssign && onAssignClient ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 hover:text-blue-500' : ''}`}
                  >
                    {canAssign && onAssignClient ? (
                      <><UserPlus className="w-5 h-5" /> Clic para Asignar Cliente</>
                    ) : (
                      <><AlertTriangle className="w-5 h-5" /> Unidad sin Comprador Asignado</>
                    )}
                  </div>
                )}

                {/* Modal Asignar Cliente */}
                {isAssignModalOpen && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                      <div className="flex justify-between items-center p-5 border-b border-gray-100">
                        <h3 className="text-lg font-bold text-gray-900">
                          Asignar Cliente a {unit.type} {unit.numero}
                        </h3>
                        <button onClick={() => setIsAssignModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                          <X className="w-5 h-5 text-gray-500" />
                        </button>
                      </div>
                      <div className="p-4 border-b border-gray-100">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={assignSearch}
                            onChange={e => setAssignSearch(e.target.value)}
                            placeholder="Buscar por nombre o RUT…"
                            autoFocus
                            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1 p-3 space-y-2">
                        {searchedClients.length === 0 ? (
                          <p className="text-center text-gray-400 italic text-sm py-8">
                            {assignableClients.length === 0 ? 'Sin clientes disponibles para tu rol.' : 'Sin resultados.'}
                          </p>
                        ) : searchedClients.map(c => (
                          <button
                            key={c.id}
                            onClick={() => { onAssignClient?.(c.id, unit.id); setIsAssignModalOpen(false); loadPaymentPlans(c.rut); }}
                            className="w-full p-3 text-left border border-gray-100 rounded-xl hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center gap-3"
                          >
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
                              {c.nombre.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 text-sm truncate">{c.nombre}</div>
                              <div className="text-xs text-gray-500 font-mono">{c.rut}</div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.estado === 'Activo' ? 'bg-green-100 text-green-700' : c.estado === 'Prospecto' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                              {c.estado}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="p-4 border-t border-gray-100">
                        <button onClick={() => setIsAssignModalOpen(false)}
                          className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-6 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <AssetTagInput label="Estacionamientos" type="Estacionamiento" allUnits={allUnits} selectedUnits={formData.estacionamientos} onChange={(val) => handleChange('estacionamientos', val)} />
                    <AssetTagInput label="Bodegas" type="Bodega" allUnits={allUnits} selectedUnits={formData.bodegas} onChange={(val) => handleChange('bodegas', val)} />
              </div>
          </div>

          {/* Ficha Técnica */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-xs font-bold text-gray-400 mb-6 flex items-center gap-2 uppercase tracking-widest"><Info className="w-4 h-4" /> Especificaciones Técnicas</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">SUPERFICIE</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Ruler className="w-4 h-4 text-blue-500"/> {formData.superficie || '-'} m²</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">ORIENTACIÓN</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Compass className="w-4 h-4 text-blue-500"/> {formData.orientacion || '-'}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">PISO</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Layers className="w-4 h-4 text-blue-500"/> {formData.piso || '-'}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">DORMITORIOS</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Bed className="w-4 h-4 text-blue-500"/> {formData.dormitorios || '-'}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">BAÑOS</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Bath className="w-4 h-4 text-blue-500"/> {formData.banos || '-'}</div>
                </div>
            </div>
          </div>

          {/* Forma de Pago (PUNTO 3) — visible when unit has client */}
          {hasClient && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h3 className="text-xs font-bold text-gray-500 flex items-center gap-2 uppercase tracking-widest">
                  <CreditCard className="w-4 h-4 text-blue-600" /> Forma de Pago Cotizada
                </h3>
                {paymentPlans.length > 1 && (
                  <select
                    value={selectedPlanId}
                    onChange={e => handleSelectPlan(e.target.value)}
                    className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 bg-white"
                  >
                    {paymentPlans.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.clienteNombre || p.quotationId.slice(0, 8)} — {new Date(p.createdAt).toLocaleDateString('es-CL')}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="p-6 space-y-5">
                  {/* Informational note when no cotización exists in payment_plans */}
                  {paymentPlans.length === 0 && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Sin cotización generada con forma de pago. Los porcentajes son editables manualmente. Para pre-cargarlos, genera una cotización desde el Cotizador con "Incluir forma de pago".</span>
                    </div>
                  )}
                  {/* Editable percentages */}
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'Promesa', val: fpPromesaPct, set: setFpPromesaPct },
                      { label: `Cuotas (${cantidadCuotasPie}x)`, val: fpCuotasPct, set: setFpCuotasPct },
                      { label: 'Escritura', val: fpEscrituraPct, set: setFpEscrituraPct },
                    ].map(({ label, val, set }) => (
                      <div key={label}>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{label}</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={val}
                            onChange={e => { set(Number(e.target.value)); setFpSaved(false); }}
                            disabled={isReadOnly}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono text-right outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                          />
                          <span className="text-xs text-gray-400 shrink-0">%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Auto crédito */}
                  <div className="flex items-center justify-between px-3 py-2 bg-blue-50/40 rounded-xl border border-blue-100/60">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-tight">Crédito Hipotecario (auto)</span>
                    <span className="font-mono font-black text-blue-700 text-sm">{fpCreditoPct}%</span>
                  </div>
                  {/* Price breakdown */}
                  <div className="space-y-1.5">
                    {[
                      { label: 'Promesa', pct: fpPromesaPct },
                      { label: `Cuotas (${cantidadCuotasPie}x)`, pct: fpCuotasPct },
                      { label: 'Escritura', pct: fpEscrituraPct },
                      { label: 'Crédito', pct: fpCreditoPct },
                    ].map(({ label, pct }) => {
                      const uf = Math.round(bonoCalc.precioVenta * pct / 100 * 100) / 100;
                      return (
                        <div key={label} className="flex justify-between items-center text-xs">
                          <span className="text-gray-500">{label}</span>
                          <span className="font-mono font-bold text-gray-700">
                            {pct}% → {uf.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UF
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Total check */}
                  {(fpPromesaPct + fpCuotasPct + fpEscrituraPct + fpCreditoPct) !== 100 && (
                    <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" /> Los porcentajes no suman 100%
                    </p>
                  )}
                  {/* Generate button */}
                  {!isReadOnly && (
                    <button
                      onClick={generatePaymentSchedule}
                      className="w-full py-2 text-xs font-bold rounded-xl transition-colors bg-green-600 text-white hover:bg-green-700"
                    >
                      Generar Forma de Pago
                    </button>
                  )}
                </div>
            </div>
          )}

          {/* Cronograma de Recaudación */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-gray-500 flex items-center gap-2 uppercase tracking-widest"><Wallet className="w-4 h-4 text-blue-600"/> Cronograma de Recaudación</h3>
              {!isReadOnly && (
                  <div className="flex gap-2">
                    <button onClick={addManualPayment} className="text-[10px] bg-white border border-gray-200 text-gray-600 font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-all shadow-sm"><Plus className="w-3 h-3" /> AGREGAR CUOTA</button>
                  </div>
              )}
            </div>
            <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-sm table-fixed border-collapse">
                <thead>
                    <tr className="bg-gray-50/30 border-b border-gray-100 text-[9px] text-gray-400 font-black uppercase tracking-widest">
                        <th className="px-3 py-4 w-[14%]">Referencia</th>
                        <th className="px-2 py-4 w-[16%] text-center">Vencimiento</th>
                        <th className="px-2 py-4 w-[16%] text-center">Pago Real</th>
                        <th className="px-2 py-4 w-[16%] text-right">Monto (UF)</th>
                        <th className="px-2 py-4 w-[10%] text-center">Estado</th>
                        <th className="px-3 py-4 w-[23%]">Comentarios</th>
                        <th className="px-2 py-4 w-[5%] text-center"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {formData.planPagos.length === 0 ? (
                        <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400 italic text-xs font-medium">No se registran pagos pendientes or realizados.</td></tr>
                    ) : formData.planPagos.map((p, idx) => {
                    const delayed = isDelayed(p.date, p.fechaPagoReal);
                    return (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors group">
                        <td className="px-3 py-3"><input disabled={isReadOnly} type="text" value={p.id} onChange={(e) => { const next = [...formData.planPagos]; next[idx].id = e.target.value; setFormData({...formData, planPagos: next}); }} className="w-full bg-transparent border-none focus:ring-0 p-0 text-gray-900 font-bold text-xs truncate" /></td>
                        <td className="px-2 py-3 text-center"><input disabled={isReadOnly} type="date" value={p.date} onChange={(e) => { const next = [...formData.planPagos]; next[idx].date = e.target.value; setFormData({...formData, planPagos: next}); }} className="w-full bg-transparent border-none focus:ring-0 p-0 text-gray-600 text-[11px] font-bold text-center" /></td>
                        <td className="px-2 py-3 text-center">
                            <input 
                                disabled={isReadOnly} 
                                type="date" 
                                value={p.fechaPagoReal || ''} 
                                onChange={(e) => { const next = [...formData.planPagos]; next[idx].fechaPagoReal = e.target.value; setFormData({...formData, planPagos: next}); }} 
                                className={`w-full bg-transparent border-none focus:ring-0 p-0 text-[11px] font-bold text-center ${delayed ? 'text-red-600' : p.fechaPagoReal ? 'text-green-600' : 'text-gray-300'}`} 
                            />
                        </td>
                        <td className="px-2 py-3 text-right">
                            <FormattedInput disabled={isReadOnly} value={Number(p.amount)} onChange={(val) => { const next = [...formData.planPagos]; next[idx].amount = val.toString(); setFormData({...formData, planPagos: next}); }} className="w-full bg-transparent border-none focus:ring-0 p-0 text-right font-mono font-bold text-gray-900 text-sm" />
                        </td>
                        <td className="px-2 py-3 text-center">
                            <select 
                                disabled={isReadOnly} 
                                value={p.status} 
                                onChange={(e) => { 
                                    const nextValue = e.target.value as any;
                                    const next = [...formData.planPagos]; 
                                    next[idx].status = nextValue; 
                                    // Tarea Puntual: Registrar fecha actual al marcar como Pagado
                                    if (nextValue === 'Pagado' && !next[idx].fechaPagoReal) {
                                        next[idx].fechaPagoReal = new Date().toISOString().split('T')[0];
                                    }
                                    setFormData({...formData, planPagos: next}); 
                                }} 
                                className={`w-full text-[9px] font-black px-1.5 py-0.5 rounded-lg border-0 focus:ring-0 cursor-pointer appearance-none text-center ${p.status === 'Pagado' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}
                            >
                                <option value="Pendiente">PEND.</option><option value="Pagado">PAGADO</option>
                            </select>
                        </td>
                        <td className="px-3 py-3">
                            <input 
                                disabled={isReadOnly} 
                                type="text" 
                                value={p.observacion || ''} 
                                onChange={(e) => { const next = [...formData.planPagos]; next[idx].observacion = e.target.value; setFormData({...formData, planPagos: next}); }} 
                                placeholder="Nota..."
                                className="w-full bg-transparent border-none focus:ring-0 p-0 text-gray-600 text-[11px] font-medium placeholder:italic placeholder:text-gray-300 truncate" 
                            />
                        </td>
                        <td className="px-2 py-3 text-center">{!isReadOnly && <button onClick={() => setFormData({...formData, planPagos: formData.planPagos.filter((_, i) => i !== idx)})} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                    </tr>
                    )})}
                </tbody>
                </table>
            </div>
            <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Total Planificado: <span className={`ml-1 ${Math.abs(totalPlanificado - totalEstructuraFinanciera) < 0.1 ? 'text-green-600' : 'text-orange-600'}`}>{formatValueStandard(totalPlanificado)} UF</span></div>
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Total Estructura: <span className="ml-1 text-gray-700">{formatValueStandard(totalEstructuraFinanciera)} UF</span></div>
                </div>
            </div>
          </div>

          {/* Bitácora y Observaciones - REPARADA PARA REGISTRAR CAMBIOS */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-gray-500 flex items-center gap-2 uppercase tracking-widest"><ClipboardList className="w-4 h-4 text-blue-600" /> Bitácora y Observaciones</h3>
                  <div className="flex items-center gap-2 px-2 py-1 bg-green-50 rounded-lg border border-green-100">
                      <History className="w-3 h-3 text-green-600" />
                      <span className="text-[9px] font-black text-green-700 uppercase tracking-tighter">Registro Automático Activo</span>
                  </div>
              </div>
              <div className="p-6">
                <textarea 
                    disabled={isReadOnly}
                    value={formData.observaciones || ''}
                    onChange={(e) => handleChange('observaciones', e.target.value)}
                    placeholder="Escriba notas manuales aquí. Los cambios de estado y fechas se registrarán automáticamente al guardar."
                    className="w-full min-h-[160px] bg-gray-50 border border-gray-100 rounded-xl p-4 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all placeholder:italic leading-relaxed font-mono"
                />
                <p className="mt-3 text-[10px] text-gray-400 italic flex items-center gap-1.5"><Info className="w-3 h-3"/> El sistema antepone automáticamente los logs de cambios sobre las notas manuales al guardar.</p>
              </div>
          </div>

          {/* Hitos de Gestión */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-8">
            <div>
                <h3 className="text-xs font-bold text-gray-400 mb-6 flex items-center gap-2 uppercase tracking-widest"><Target className="w-4 h-4 text-purple-600" /> Hitos de Gestión</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Nuevo Campo: Trazabilidad de Asignación */}
                    <div className="md:col-span-2">
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Ejecutivo y Fecha de Asignación</label>
                        <div className="relative">
                            <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                            <input 
                                disabled
                                type="text" 
                                value={formData.asignadoPor ? `${formData.asignadoPor} - ${formData.fechaAsignacion}` : ''}
                                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 outline-none cursor-not-allowed" 
                                placeholder="Sin asignar a cliente"
                            />
                        </div>
                    </div>
                    <div className="hidden md:block"></div>

                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Reserva</label>
                        <div className="relative">
                            <Calendar className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!hasClient ? 'text-gray-200' : 'text-gray-300'}`} />
                            <input 
                                disabled={isReadOnly || !hasClient} 
                                type="date" 
                                title={!hasClient ? "Asigne un cliente para registrar reserva" : ""}
                                value={formData.fechaReserva || ''} 
                                onChange={(e) => handleChange('fechaReserva', e.target.value)} 
                                className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!hasClient ? 'cursor-not-allowed opacity-50' : ''}`} 
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Promesa</label>
                        <div className="relative">
                            <FileText className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!hasClient ? 'text-gray-200' : 'text-gray-300'}`} />
                            <input 
                                disabled={isReadOnly || !hasClient} 
                                type="date" 
                                title={!hasClient ? "Asigne un cliente para registrar promesa" : ""}
                                value={formData.fechaPromesa || ''} 
                                onChange={(e) => handleChange('fechaPromesa', e.target.value)} 
                                className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!hasClient ? 'cursor-not-allowed opacity-50' : ''}`} 
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Escritura</label>
                        <div className="relative">
                            <FileCheck className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!hasClient ? 'text-gray-200' : 'text-gray-300'}`} />
                            <input 
                                disabled={isReadOnly || !hasClient} 
                                type="date" 
                                title={!hasClient ? "Asigne un cliente para registrar escritura" : ""}
                                value={formData.fechaEscritura || ''} 
                                onChange={(e) => handleChange('fechaEscritura', e.target.value)} 
                                className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!hasClient ? 'cursor-not-allowed opacity-50' : ''}`} 
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Solicitud Crédito</label>
                        <div className="relative">
                            <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                            <input disabled={isReadOnly} type="date" value={formData.fechaSolicitudCredito || ''} onChange={(e) => handleChange('fechaSolicitudCredito', e.target.value)} className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Aprobación Crédito</label>
                        <div className="relative">
                            <CheckCircle2 className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!formData.fechaSolicitudCredito ? 'text-gray-200' : 'text-gray-300'}`} />
                            <input 
                                disabled={isReadOnly || !formData.fechaSolicitudCredito} 
                                title={!formData.fechaSolicitudCredito ? "Primero registre la fecha de solicitud" : ""}
                                type="date" 
                                value={formData.fechaAprobacionCredito || ''} 
                                onChange={(e) => handleChange('fechaAprobacionCredito', e.target.value)} 
                                className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!formData.fechaSolicitudCredito ? 'cursor-not-allowed opacity-50' : ''}`} 
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Monto Crédito (UF)</label>
                        <div className="relative">
                            <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                            <FormattedInput disabled={isReadOnly} value={formData.creditoHipotecario || 0} onChange={(val) => handleChange('creditoHipotecario', val)} className="w-full pl-9 pr-3 py-2 bg-blue-50/50 border border-blue-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Tasa de Financiamiento (%)</label>
                        <div className="relative">
                            <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                            <FormattedInput disabled={isReadOnly} format="PERCENT" value={formData.tasaFinanciamiento || 0} onChange={(val) => handleChange('tasaFinanciamiento', val)} className="w-full pl-9 pr-3 py-2 bg-blue-50/50 border border-blue-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Entrega</label>
                        <div className="relative">
                            <Key className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!formData.fechaEscritura ? 'text-gray-200' : 'text-gray-300'}`} />
                            <input 
                                disabled={isReadOnly || !formData.fechaEscritura} 
                                title={!formData.fechaEscritura ? "Primero registre la fecha de escritura" : ""}
                                type="date" 
                                value={formData.fechaEntrega || ''} 
                                onChange={(e) => handleChange('fechaEntrega', e.target.value)} 
                                className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!formData.fechaEscritura ? 'cursor-not-allowed opacity-50' : ''}`} 
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Alzamiento</label>
                        <div className="relative">
                            <RefreshCw className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!formData.fechaEscritura ? 'text-gray-200' : 'text-gray-300'}`} />
                            <input 
                                disabled={isReadOnly || !formData.fechaEscritura} 
                                title={!formData.fechaEscritura ? "Primero registre la fecha de escritura" : ""}
                                type="date" 
                                value={formData.fechaAlzamiento || ''} 
                                onChange={(e) => handleChange('fechaAlzamiento', e.target.value)} 
                                className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!formData.fechaEscritura ? 'cursor-not-allowed opacity-50' : ''}`} 
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="pt-6 border-t border-gray-100">
                <h3 className="text-xs font-bold text-gray-400 mb-6 flex items-center gap-2 uppercase tracking-widest"><Scale className="w-4 h-4 text-orange-500" /> Costos Operacionales (UF)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Gastos Operacionales</label>
                        <FormattedInput disabled={isReadOnly} value={formData.gastosOperacionales || 0} onChange={(val) => handleChange('gastosOperacionales', val)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Gastos Notariales</label>
                        <FormattedInput disabled={isReadOnly} value={formData.gastosNotariales || 0} onChange={(val) => handleChange('gastosNotariales', val)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Gastos Conservador</label>
                        <FormattedInput disabled={isReadOnly} value={formData.gastosConservador || 0} onChange={(val) => handleChange('gastosConservador', val)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                </div>
            </div>
          </div>

          {/* Historial de Ocupación */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-xs font-bold text-gray-500 flex items-center gap-2 uppercase tracking-widest"><History className="w-4 h-4 text-indigo-600" /> Historial de Ocupación</h3>
              </div>
              {(!unit.historialOcupacion || unit.historialOcupacion.length === 0) ? (
                <p className="text-xs text-gray-400 italic px-4 py-3">Sin historial de ocupación registrado.</p>
              ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      <th className="px-4 py-3 text-left">Tipo</th>
                      <th className="px-4 py-3 text-left">Cliente</th>
                      <th className="px-4 py-3 text-left">Vendedor</th>
                      <th className="px-4 py-3 text-left">Desde</th>
                      <th className="px-4 py-3 text-left">Hasta</th>
                      <th className="px-4 py-3 text-left">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...unit.historialOcupacion].reverse().map((entry: OcupacionEntry, idx: number) => {
                      const isActive = !entry.fechaFin;
                      return (
                        <tr key={idx} className={`${isActive ? 'bg-blue-50/40' : ''}`}>
                          <td className="px-4 py-3 font-bold text-gray-700">{entry.tipo}</td>
                          <td className="px-4 py-3 text-gray-600">{entry.clienteNombre}{entry.clienteRut && <span className="text-gray-400 ml-1 font-mono text-[10px]">{entry.clienteRut}</span>}</td>
                          <td className="px-4 py-3 text-gray-600">{entry.vendedorNombre}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono">{new Date(entry.fechaInicio).toLocaleDateString('es-CL')}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono">{entry.fechaFin ? new Date(entry.fechaFin).toLocaleDateString('es-CL') : <span className="text-blue-600 font-bold">Activo</span>}</td>
                          <td className="px-4 py-3 text-gray-400 italic">{entry.motivo || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
          </div>
        </div>

        {/* Desglose Financiero - COLUMNA DERECHA */}
        <div className="xl:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4 sticky top-8">
             <h3 className="text-xs font-bold text-gray-400 border-b border-gray-50 pb-3 flex items-center gap-2 uppercase tracking-widest">
                 <Coins className="w-4 h-4 text-blue-600" /> Estructura Financiera
             </h3>

             {/* ── Componentes del Precio Lista ── */}
             <div className="space-y-1.5">
               <div className="flex justify-between items-center text-xs p-2 bg-gray-50 rounded-lg border border-gray-100">
                 <span className="text-gray-500 font-bold uppercase flex items-center gap-1.5">
                   <Tag className="w-3 h-3" />
                   {unit.type === 'Departamento' ? `Depto ${formData.numero}` : `${unit.type} ${formData.numero}`}
                 </span>
                 <span className="font-mono font-bold text-gray-800">{formatValueStandard(formData.precioLista)} UF</span>
               </div>
               {linkedAssets.parkings.map(p => (
                 <div key={p.id} className="flex justify-between items-center text-[10px] p-2 bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                   <span className="text-gray-400 font-bold uppercase flex items-center gap-1.5"><Car className="w-3 h-3" /> Estac. {p.numero}</span>
                   <span className="font-mono font-bold text-gray-500">{formatValueStandard(p.precioLista)} UF</span>
                 </div>
               ))}
               {linkedAssets.storages.map(b => (
                 <div key={b.id} className="flex justify-between items-center text-[10px] p-2 bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                   <span className="text-gray-400 font-bold uppercase flex items-center gap-1.5"><Package className="w-3 h-3" /> Bodega {b.numero}</span>
                   <span className="font-mono font-bold text-gray-500">{formatValueStandard(b.precioLista)} UF</span>
                 </div>
               ))}
             </div>

             {/* ── Desglose: Precio Lista → descuento → bono → precio venta ── */}
             <div className="space-y-1 text-[11px]">

               {/* Precio Lista */}
               <div className="flex justify-between items-center py-1">
                 <span className="text-gray-500 font-bold uppercase">Precio Lista</span>
                 <span className="font-mono font-black text-gray-800">{formatValueStandard(bonoCalc.precioLista)} UF</span>
               </div>

               {/* Descuento (visible cuando hay cliente) */}
               {hasClient && (
                 <div className="space-y-1.5 py-1 px-3 bg-amber-50/60 rounded-xl border border-amber-200/70">
                   <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-1">
                     <Percent className="w-3 h-3" /> Descuento (%) — máx {discountCfg.supervisorMaxPct}%
                   </label>
                   <div className="flex gap-2">
                     <input
                       type="number" min="0" max={discountCfg.supervisorMaxPct} step="0.1"
                       placeholder={`ej: ${discountCfg.jefeMaxPct}`}
                       value={discountInput}
                       onChange={e => { setDiscountInput(e.target.value); setDiscountError(''); }}
                       disabled={isReadOnly || discountPending}
                       className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-amber-100 disabled:opacity-60"
                     />
                     <button
                       onClick={applyUnitDiscount}
                       disabled={isReadOnly || discountPending || !discountInput}
                       className="px-3 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-all active:scale-95"
                     >
                       {discountPending ? '…' : 'Aplicar'}
                     </button>
                   </div>
                   {discountError && (
                     <p className={`text-[10px] font-bold flex items-start gap-1 ${discountError.includes('requiere') ? 'text-amber-600' : 'text-red-600'}`}>
                       <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {discountError}
                     </p>
                   )}
                   {discountPending && (
                     <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-100 rounded-lg">
                       <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                       <span className="text-[10px] font-bold text-amber-700">Pend. Autorización</span>
                     </div>
                   )}
                   {bonoCalc.descuentoPct > 0 && (
                     <div className="flex justify-between text-[10px] text-amber-700">
                       <span>Descuento (-{bonoCalc.descuentoPct.toFixed(1)}%)</span>
                       <span className="font-mono">-{formatValueStandard(bonoCalc.descuentoMonto)} UF</span>
                     </div>
                   )}
                   {formData.descuentoPct && formData.descuentoPct > 0 && !discountPending && (
                     <div className="text-[10px] text-green-600 font-bold">✓ Descuento {formData.descuentoPct.toFixed(1)}% aplicado</div>
                   )}
                 </div>
               )}

               {/* Separador + Precio con Descuento */}
               <div className="border-t border-gray-200 pt-1 flex justify-between items-center">
                 <span className="text-gray-500 font-bold uppercase">Precio con Descuento</span>
                 <span className="font-mono font-bold text-gray-700">{formatValueStandard(bonoCalc.precioConDescuento)} UF</span>
               </div>

               {/* Bono Pie toggle + desglose */}
               {hasClient && (
                 <div className="space-y-1 py-1 px-3 bg-blue-50/50 rounded-xl border border-blue-100">
                   <div className="flex items-center justify-between">
                     <label className="flex items-center gap-2 text-xs font-bold text-blue-700 cursor-pointer select-none">
                       <input
                         type="checkbox"
                         checked={hasBono}
                         disabled={isReadOnly || currentUser.role === 'Ventas'}
                         onChange={e => {
                           const checked = e.target.checked;
                           setHasBono(checked);
                           const updated: RealEstateUnit = { ...formData, aplicaBonoPie: checked };
                           setFormData(updated);
                           onUpdate(updated);
                         }}
                         className="w-4 h-4 accent-blue-600 disabled:opacity-50"
                       />
                       Bono Pie {bonoPct > 0 ? bonoPct : 10}%
                     </label>
                   </div>
                   {hasBono && (
                     <>
                       <div className="flex justify-between text-[10px] text-blue-600 pt-1">
                         <span>Ajuste Bono Pie ({bonoPct > 0 ? bonoPct : 10}%)</span>
                         <span className="font-mono">+{formatValueStandard(bonoCalc.ajusteBonoMonto)} UF</span>
                       </div>
                       <div className="border-t border-blue-100 pt-1 flex justify-between text-[10px] text-blue-700 font-bold">
                         <span>Precio de Lista (publicado)</span>
                         <span className="font-mono">{formatValueStandard(bonoCalc.precioPublicado)} UF</span>
                       </div>
                       <div className="flex justify-between text-[10px] text-red-500">
                         <span>Bono Pie (-{bonoPct > 0 ? bonoPct : 10}%)</span>
                         <span className="font-mono">-{formatValueStandard(bonoCalc.bonificacionMonto)} UF</span>
                       </div>
                     </>
                   )}
                 </div>
               )}

               {/* Separador final */}
               <div className="border-t-2 border-gray-300 mt-1" />
             </div>

             {/* ── PRECIO DE VENTA ── */}
             <div className={`flex flex-col items-center py-4 rounded-2xl bg-gray-50 border border-gray-100 shadow-inner ${!hasClient ? 'opacity-60 grayscale-[0.5]' : ''}`}>
               <span className="text-[10px] text-gray-400 font-black uppercase mb-1 tracking-widest">Precio de Venta</span>
               <div className="flex items-center gap-1">
                 <FormattedInput
                   disabled={isReadOnly || !hasClient}
                   title={!hasClient ? "Asigne un cliente para modificar precio de venta" : ""}
                   value={formData.precioVenta}
                   onChange={(val) => handleChange('precioVenta', val)}
                   className="bg-transparent border-none p-0 text-3xl font-extrabold text-blue-700 text-center w-36 outline-none focus:ring-0"
                 />
                 <span className="text-sm font-normal text-gray-500">UF</span>
               </div>
             </div>

             {/* ── Reserva / Pie / Saldo ── */}
             <div className="grid grid-cols-1 gap-3">
               <div className={`bg-white p-4 rounded-2xl border border-gray-100 shadow-sm ${!hasClient ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                 <span className="text-[10px] font-black text-gray-400 uppercase block mb-2">Reserva Pactada</span>
                 <div className="flex items-center gap-1">
                   <FormattedInput
                     disabled={isReadOnly || !hasClient}
                     title={!hasClient ? "Asigne un cliente para modificar reserva" : ""}
                     value={formData.reservaMonto}
                     onChange={(val) => handleChange('reservaMonto', val)}
                     className="bg-transparent border-none focus:ring-0 p-0 text-2xl font-black text-gray-800 w-full"
                   />
                   <span className="text-xs font-bold text-gray-400">UF</span>
                 </div>
               </div>

               <div className={`bg-white p-4 rounded-2xl border border-gray-100 shadow-sm ${!hasClient ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                 <span className="text-[10px] font-black text-gray-400 uppercase block mb-2">Pie Acordado</span>
                 <div className="flex items-center gap-1">
                   <FormattedInput
                     disabled={isReadOnly || !hasClient}
                     title={!hasClient ? "Asigne un cliente para modificar pie" : ""}
                     value={formData.pie}
                     onChange={(val) => handleChange('pie', val)}
                     className="bg-transparent border-none focus:ring-0 p-0 text-2xl font-black text-gray-800 w-full"
                   />
                   <span className="text-xs font-bold text-gray-400">UF</span>
                 </div>
               </div>
             </div>

             <div className="p-5 bg-blue-50 rounded-2xl text-center shadow-sm border border-blue-100 relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity"><Landmark className="w-12 h-12" /></div>
               <span className="text-[9px] text-blue-500 font-black block mb-1 uppercase tracking-widest">Saldo por Financiar</span>
               <div className="text-2xl font-black text-blue-900 font-mono">
                 {formatValueStandard(saldoPorFinanciarEstructural)} <span className="text-xs font-normal">UF</span>
               </div>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};
