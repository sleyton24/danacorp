import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RealEstateUnit, Client, PaymentItem, User, PaymentPlan, OcupacionEntry, PriceHistoryEntry } from '../types';
import {
  ordenarPorVencimiento, fechaCuota, DIA_PAGO_DEFAULT, normalizarDiaPago,
  type OrdenVencimiento,
} from '../utils/cronogramaUtils';
import { formatUF, formatPct, r2 as r2fmt } from '../utils/format';
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
import {
  calcResumenUnidad, calcFormaPagoFija,
  descuentoDesdePrecio, redistribuirPctReales, PROMESA_PCT_MIN,
} from '../utils/pricingUtils';
import {
  aplicaCredito, limpiarCamposCredito, porcentajeFinanciamiento, validarOrdenCBR,
  type ErrorCBR,
} from '../utils/hitosCredito';

// Normaliza el cronograma al cargar: asegura un uid estable en cada fila (backfill en
// memoria de filas legacy; se persiste al próximo guardado, ya que planPagos es un blob
// JSON). NO ordena: el orden guardado es el que el usuario dejó al hacer click en el
// encabezado "Vencimiento", y reordenarlo al cargar se lo borraría en silencio.
function normalizarPlanPagos(filas: PaymentItem[]): PaymentItem[] {
  return filas.map(p => (p.uid ? p : { ...p, uid: crypto.randomUUID() }));
}

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
  users?: User[];
  onAssignClient?: (clientId: string, unitId: string) => void;
  onUnassignClient?: (unitId: string) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'warning') => void;
  onUnsavedChangesUpdate?: (hasChanges: boolean) => void;
  saveRef?: React.MutableRefObject<(() => void) | null>;
  /** Proyecto terminado: solo consulta. El backend igual rechaza con 409. */
  proyectoTerminado?: boolean;
}

// Miles con punto, 2 decimales con coma (Ej: 4.565,00). Ver utils/format.ts:
// la regla de 2 decimales para precios y descuentos es transversal a la app.
const formatValueStandard = formatUF;

const FormattedInput = ({ value, onChange, className, placeholder, disabled, format = 'UF', title }: { value: number, onChange: (val: number) => void, className?: string, placeholder?: string, disabled?: boolean, format?: 'UF' | 'CLP' | 'PERCENT', title?: string }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value?.toString() || '0');

    const formatValue = (val: number) => {
        if (format === 'CLP') {
            return val.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });
        }
        if (format === 'PERCENT') {
            return formatPct(val) + ' %';
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

// Celda numérica del cuadro financiero (precio y descuento). Mientras está enfocada
// conserva EXACTAMENTE lo que se teclea; al perder el foco vuelve a mostrar el valor
// vigente redondeado a 2 decimales.
//
// Ese doble estado es el que hace posible la edición cruzada precio ↔ descuento: al
// tipear un precio, el descuento derivado se guarda con toda su precisión (16,666…%)
// pero en pantalla se lee "16,67". Sin el buffer local, el valor controlado pisaría lo
// tecleado a media escritura y no se podrían escribir decimales.
const NumberCell = ({ value, onCommit, disabled, className, step = '0.01', title }: {
    value: number;
    onCommit: (n: number) => void;
    disabled?: boolean;
    className?: string;
    step?: string;
    title?: string;
}) => {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            type="number"
            step={step}
            title={title}
            disabled={disabled}
            value={draft ?? String(Math.round(value * 100) / 100)}
            onChange={e => {
                setDraft(e.target.value);
                const n = parseFloat(e.target.value);
                onCommit(isNaN(n) ? 0 : n);
            }}
            onBlur={() => setDraft(null)}
            className={className}
        />
    );
};

// Etiqueta del ajuste aplicado a una unidad. Un valor negativo NO es un descuento sino un
// recargo (precio sobre el de lista): la app lo permite y se marca en verde, sin el signo
// menos y sin pasar por el flujo de aprobación de descuentos.
const ajusteBadge = (dctoPct: number, ufAjuste: number, mode: '%' | 'UF') => {
    if (Math.abs(dctoPct) < 0.005) return null;
    const esRecargo = dctoPct < 0;
    const texto = mode === '%' ? `${formatPct(Math.abs(dctoPct))}%` : `${formatUF(Math.abs(ufAjuste))}UF`;
    return (
        <span className={`text-[9px] font-bold px-1 rounded shrink-0 ${esRecargo ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}`}>
            {esRecargo ? '+' : '-'}{texto}
        </span>
    );
};

// Selector de una componente de la forma de pago (Promesa / Cuotas / Escritura). Apagarla
// la deja en 0 UF y su parte se redistribuye entre las que quedan activas.
const ComponenteToggle = ({ activa, onToggle, disabled, etiqueta }: {
    activa: boolean;
    onToggle: () => void;
    disabled?: boolean;
    etiqueta: string;
}) => (
    <button
        type="button"
        role="switch"
        aria-checked={activa}
        aria-label={`${activa ? 'Desactivar' : 'Activar'} ${etiqueta}`}
        title={activa ? `Desactivar ${etiqueta}: su parte se reparte entre las componentes activas` : `Activar ${etiqueta}`}
        onClick={onToggle}
        disabled={disabled}
        className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${activa ? 'bg-blue-600 border-blue-600' : 'border-gray-300 hover:border-blue-400'}`}
    >
        {activa && <Check className="w-2.5 h-2.5 text-white" />}
    </button>
);

// Input de % que muestra coma como separador decimal (es-CL) y parsea con punto internamente.
// Mantiene estado local de string para permitir escribir decimales (ej: "10,5") sin que
// el valor numérico controlado borre la coma a medio escribir.
const PercentInput = ({ value, onChange, disabled, className, max }: { value: number, onChange: (n: number) => void, disabled?: boolean, className?: string, max?: number }) => {
    const [editing, setEditing] = useState(false);
    const [localValue, setLocalValue] = useState(String(value).replace('.', ','));
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!editing) setLocalValue(String(value).replace('.', ','));
    }, [value, editing]);

    // onInput captura TODOS los tipos de input (teclado principal/numérico, pegar, autocompletar)
    const handleInput = () => {
        if (!inputRef.current) return;
        const raw = inputRef.current.value;
        const normalized = raw
            .replace(/[.,·]/g, ',')      // cualquier separador → coma
            .replace(/[^0-9,\-]/g, '')   // solo dígitos, coma, negativo
            .replace(/^,/, '')           // no empezar con coma
            .replace(/(,.*),/g, '$1');   // solo una coma
        // Actualizar el DOM directamente para evitar lag del state de React
        if (inputRef.current.value !== normalized) {
            inputRef.current.value = normalized;
        }
        setLocalValue(normalized);
        const numeric = parseFloat(normalized.replace(',', '.'));
        if (!isNaN(numeric)) onChange(numeric);
        else if (normalized === '' || normalized === '-') onChange(0);
    };

    return (
        <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={localValue}
            disabled={disabled}
            max={max}
            className={className}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onInput={handleInput}
            onChange={handleInput}
        />
    );
};


export const UnitDetail: React.FC<UnitDetailProps> = ({
  unit, client, onBack, onUpdate, allUnits = [], currentUser, onSelectClient,
  clients = [], users = [], onAssignClient, onUnassignClient, showToast,
  onUnsavedChangesUpdate, saveRef, proyectoTerminado,
}) => {
  // Backfill de uid + orden cronológico una sola vez al montar (Bloque C).
  const [formData, setFormData] = useState<RealEstateUnit>(() => ({
    ...unit,
    planPagos: normalizarPlanPagos(unit.planPagos ?? []),
  }));
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientMenuRef = useRef<HTMLDivElement>(null);

  // ── Forma de Pago ──────────────────────────────────────────────────────────
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [cantidadCuotasPie, setCantidadCuotasPie] = useState(unit.pieCuotas ?? 36);
  const [fpPromesaPct, setFpPromesaPct] = useState(PROMESA_PCT_MIN); // Bloque E: piso 3% por defecto
  const [fpCuotasPct, setFpCuotasPct] = useState(20);
  const [fpEscrituraPct, setFpEscrituraPct] = useState(10);
  const [fpCreditoPct, setFpCreditoPct] = useState(80);
  // Bloque E: error inline al intentar bajar Promesa del piso 3% (patrón Bloque B).
  const [promesaError, setPromesaError] = useState<string | null>(null);
  // Componentes activables de la forma de pago. Apagar una la deja en 0 y su parte se
  // redistribuye sola entre las que quedan activas (ver calcFormaPagoFija).
  const [fpPromesaOn, setFpPromesaOn] = useState(true);
  const [fpCuotasOn, setFpCuotasOn] = useState(true);
  const [fpEscrituraOn, setFpEscrituraOn] = useState(true);
  // Bloque E: Promesa tiene piso 3% — se rechaza (no se clampea) cualquier intento de bajarlo.
  // El piso solo aplica con la componente activa: apagada aporta 0 y el piso no tiene sentido.
  const handlePromesaChange = (n: number) => {
    if (!Number.isFinite(n)) { setPromesaError('Ingresa un porcentaje válido.'); return; }
    if (n < PROMESA_PCT_MIN) { setPromesaError(`La Promesa no puede ser menor a ${PROMESA_PCT_MIN}% (piso mínimo).`); return; }
    setPromesaError(null);
    reajustarPctReales({ promesa: n }, 'promesa');
  };
  const [pendingEstado, setPendingEstado] = useState<string | null>(null);
  // Hitos: error inline del orden de las fechas CBR (mismo patrón rechazar+error que
  // promesaError). Se rechaza el guardado, no se autocorrige la fecha.
  const [cbrError, setCbrError] = useState<ErrorCBR | null>(null);

  // ── Panel de descuento ─────────────────────────────────────────────────────
  const [discountCfg, setDiscountCfg] = useState<{ jefeMaxPct: number; supervisorMaxPct: number }>({ jefeMaxPct: 3, supervisorMaxPct: 7 });
  const [discountInput, setDiscountInput] = useState('');
  const [discountError, setDiscountError] = useState('');
  const [discountPending, setDiscountPending] = useState(false);

  // ── Bono Pie ───────────────────────────────────────────────────────────────
  const [bonoPct, setBonoPct] = useState(0);
  const [hasBono, setHasBono] = useState(unit.aplicaBonoPie ?? false);

  // ── Forma de pago / modos descuento / UF hoy ──────────────────────────────
  const [includePaymentPlan, setIncludePaymentPlan] = useState(false);
  const [unitDiscountModes, setUnitDiscountModes] = useState<Record<string, '%'|'UF'>>({});
  const [ufHoy, setUfHoy] = useState<number | null>(null);

  // ── Fix 4: Cronograma paginación ───────────────────────────────────────────
  const [showAllPayments, setShowAllPayments] = useState(false);

  // ── Cronograma: día de pago + orden manual ────────────────────────────────
  // diaPago (1..31) alimenta al generador: todas las filas caen en ese día del mes.
  // Se persiste con la unidad, así que al reabrir el detalle vuelve el último usado.
  const [diaPago, setDiaPago] = useState<number>(normalizarDiaPago(unit.diaPago ?? DIA_PAGO_DEFAULT));
  // Última dirección de orden aplicada, solo para dibujar la flecha del encabezado.
  // El orden en sí vive en formData.planPagos, que es lo que se guarda.
  const [ordenVencimiento, setOrdenVencimiento] = useState<OrdenVencimiento | null>(null);

  // ── Fix 2: Popup cambios pendientes ───────────────────────────────────────
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);

  // ── Cotización cargada (verificación de precio) ────────────────────────────
  const [todosLosPlanesCargados, setTodosLosPlanesCargados] = useState<PaymentPlan[]>([]);
  const [planCargado, setPlanCargado] = useState(false);

  // ── Modales descuento override / carga cotización ──────────────────────────
  const [showSaveOverrideModal, setShowSaveOverrideModal] = useState(false);
  const [showLoadCotizacionModal, setShowLoadCotizacionModal] = useState(false);
  const [pendingCotizacion, setPendingCotizacion] = useState<PaymentPlan | null>(null);

  // ── Historial de precios ───────────────────────────────────────────────────
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);

  useEffect(() => {
    const tok = localStorage.getItem('dw_token');
    if (!tok) return;
    fetch(`/api/units/${unit.id}/price-history`, { headers: { Authorization: `Bearer ${tok}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: PriceHistoryEntry[]) => setPriceHistory(data))
      .catch(() => {});
  }, [unit.id]);

  // ── Fix 3: Descuentos/bono por unidad vinculada ────────────────────────────
  const [linkedDiscounts, setLinkedDiscounts] = useState<Record<string, number>>({});
  const [linkedDiscountInputs, setLinkedDiscountInputs] = useState<Record<string, string>>({});
  const [linkedBono, setLinkedBono] = useState<Record<string, boolean>>({});

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
          setBonoPct(d.discountConfig.bonoPiePct ?? 0);
        } else {
          setBonoPct(0);
        }
        // FIX 2: el default por proyecto SOLO se aplica si la unidad no tiene un
        // valor persistido (unit.pieCuotas). Si lo tiene, ese valor manda y no se clobbea.
        if (unit.pieCuotas == null && d?.cantidadCuotasPie != null) {
          setCantidadCuotasPie(d.cantidadCuotasPie);
        }
      })
      .catch(() => {});
  }, [unit.projectId, unit.pieCuotas]);

  useEffect(() => {
    const token = localStorage.getItem('dw_token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    fetch('/api/uf-hoy', { headers })
      .then(r => r.ok ? r.json() : null)
      .then((d: { uf: number } | null) => { if (d) setUfHoy(d.uf); })
      .catch(() => {});
  }, []);

  const loadPaymentPlans = (rutFilter?: string) => {
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    const params = new URLSearchParams({ unitNumero: unit.numero, projectId: unit.projectId });
    if (rutFilter) params.set('clienteRut', rutFilter);
    fetch(`/api/payment-plans?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((plans: PaymentPlan[]) => {
        setPaymentPlans(plans);
        console.log('[loadPaymentPlans] planes encontrados:', plans.length, 'para unidad:', unit.numero);
        if (plans.length > 0) {
          const first = plans[0];
          setSelectedPlanId(first.id);
          setFpPromesaPct(first.promesaPct);
          setFpCuotasPct(first.cuotasPct);
          setFpEscrituraPct(first.escrituraPct);
          setFpCreditoPct(first.creditoPct);
          if (first.cuotasN > 0) setCantidadCuotasPie(first.cuotasN);
        }
      })
      .catch(() => {});
  };

  // Load payment plans when unit has a client — sin filtrar por RUT para mostrar todos los planes
  useEffect(() => {
    if (!formData.clienteId) return;
    loadPaymentPlans();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.numero, unit.projectId, formData.clienteId]);

  useEffect(() => {
    if (paymentPlans.length > 0) setIncludePaymentPlan(true);
  }, [paymentPlans.length]);

  useEffect(() => {
    const pm = (unit.precioListaOriginal && unit.precioLista && unit.precioListaOriginal !== unit.precioLista)
      ? Math.round((1 - unit.precioLista / unit.precioListaOriginal) * 100 * 10) / 10
      : 0;
    const initial = (unit.descuentoCliente != null && unit.descuentoCliente > 0)
      ? unit.descuentoCliente
      : pm;
    setDiscountInput(String(initial));
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

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    const plan = paymentPlans.find(p => p.id === planId);
    if (!plan) return;
    setFpPromesaPct(plan.promesaPct);
    setFpCuotasPct(plan.cuotasPct);
    setFpEscrituraPct(plan.escrituraPct);
    setFpCreditoPct(plan.creditoPct);
    if (plan.cuotasN > 0) setCantidadCuotasPie(plan.cuotasN);
  };

  const cargarDesdeCotizacion = async (plan: PaymentPlan) => {
    const tok = localStorage.getItem('dw_token');
    if (!tok) return;

    const res = await fetch(
      `/api/payment-plans?quotationId=${plan.quotationId}`,
      { headers: { Authorization: `Bearer ${tok}` } }
    );
    const todosLosPlanes: PaymentPlan[] = res.ok ? await res.json() : [plan];

    // Forma de pago (igual para todas las unidades del draft)
    setFpPromesaPct(plan.promesaPct);
    setFpCuotasPct(plan.cuotasPct);
    setFpEscrituraPct(plan.escrituraPct);
    setFpCreditoPct(plan.creditoPct);
    if (plan.cuotasN > 0) setCantidadCuotasPie(plan.cuotasN);

    // Descuento y bono del departamento actual
    const planDepto = todosLosPlanes.find(p => p.unitNumero === unit.numero) ?? plan;
    if (planDepto.descuentoPct > 0) {
      setFormData(prev => ({ ...prev, descuentoPct: planDepto.descuentoPct, aplicaBonoPie: planDepto.aplicaBonoPie, descuentoCliente: planDepto.descuentoPct }));
      setDiscountInput(String(planDepto.descuentoPct));
    } else {
      // descuentoPct === 0: precio_lista ya tiene el implícito del PM, no se limpia
      setFormData(prev => ({ ...prev, aplicaBonoPie: planDepto.aplicaBonoPie }));
      setDiscountInput(String(descuentoPMDepto || 0));
    }
    setHasBono(planDepto.aplicaBonoPie);

    // Descuento y bono por bodega/estacionamiento vinculados
    const newLinkedDiscounts: Record<string, number> = {};
    const newLinkedBono: Record<string, boolean> = {};
    linkedAssets.storages.forEach(bodega => {
      const p = todosLosPlanes.find(q => q.unitNumero === bodega.numero);
      if (p) { newLinkedDiscounts[bodega.id] = p.descuentoPct; newLinkedBono[bodega.id] = p.aplicaBonoPie; }
    });
    linkedAssets.parkings.forEach(estac => {
      const p = todosLosPlanes.find(q => q.unitNumero === estac.numero);
      if (p) { newLinkedDiscounts[estac.id] = p.descuentoPct; newLinkedBono[estac.id] = p.aplicaBonoPie; }
    });
    setLinkedDiscounts(prev => ({ ...prev, ...newLinkedDiscounts }));
    setLinkedBono(prev => ({ ...prev, ...newLinkedBono }));

    setTodosLosPlanesCargados(todosLosPlanes);
    setPlanCargado(true);
    showToast?.('✓ Cotización cargada correctamente');
  };

  // ── Fix 1: Unidad asociada a padre ────────────────────────────────────────
  const parentUnit = useMemo(() => {
    if (unit.type === 'Departamento') return null;
    return allUnits.find(u => {
      if (u.type !== 'Departamento') return false;
      const bodegas = Array.isArray(u.bodegas)
        ? u.bodegas
        : (() => { try { return JSON.parse(u.bodegas as any || '[]'); } catch { return []; } })();
      const estacs = Array.isArray(u.estacionamientos)
        ? u.estacionamientos
        : (() => { try { return JSON.parse(u.estacionamientos as any || '[]'); } catch { return []; } })();
      return bodegas.includes(unit.numero) || estacs.includes(unit.numero);
    }) ?? null;
  }, [unit, allUnits]);
  const isAssociatedToParent = parentUnit !== null;

  // ── Fix 2: Cambios pendientes ──────────────────────────────────────────────
  const hasUnsavedChanges = useMemo(() => {
    // El uid (identidad interna) y el reordenamiento cronológico NO son cambios del
    // usuario: canonizamos planPagos sin uid y ordenado por fecha en ambos lados, para
    // que abrir un cronograma legacy (backfill de uid + orden) no marque "sin guardar".
    const canonPlan = (filas?: PaymentItem[]) =>
      (filas ?? [])
        .map(p => ({ id: p.id, date: p.date, amount: p.amount, status: p.status, fechaPagoReal: p.fechaPagoReal, observacion: p.observacion }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const normalize = (obj: any) => {
      if (!obj) return obj;
      const { planPagos, ...rest } = obj;
      const base = Object.keys(rest).sort().reduce((acc, key) => {
        acc[key] = rest[key];
        return acc;
      }, {} as any);
      base.planPagos = canonPlan(planPagos);
      return base;
    };
    return JSON.stringify(normalize(formData)) !== JSON.stringify(normalize(unit));
  }, [formData, unit]);

  // Fix 1: Notificar al padre cuando cambien los unsaved changes
  useEffect(() => {
    onUnsavedChangesUpdate?.(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  // Fix 1: Exponer handleSaveWithLog al padre vía ref
  useEffect(() => {
    if (saveRef) saveRef.current = handleSaveWithLog;
  });

  // ── Fix 5: Edición de fechas por rol ──────────────────────────────────────
  const canEditDates = ['Admin', 'JefeSala', 'Supervisor'].includes(currentUser.role);
  const formatDateDisplay = (d?: string) =>
    d ? new Date(d + 'T00:00:00').toLocaleDateString('es-CL') : '—';

  // Un proyecto terminado congela la ficha completa: reutiliza el mismo isReadOnly que
  // ya gobierna el rol Lectura y las unidades asociadas a un padre.
  const isReadOnly = currentUser.role === 'Lectura' || isAssociatedToParent || proyectoTerminado === true;
  const puedeReasignar = ['Admin', 'Supervisor', 'JefeSala'].includes(currentUser.role);

  // Cambio 2: reasignación de ejecutivo (solo Admin/Supervisor/JefeSala, cualquier estado)
  // FIX 4: editable para todos excepto Ventas y Lectura (Admin/Supervisor/JefeSala)
  const canEditEjecutivo = currentUser.role !== 'Ventas' && currentUser.role !== 'Lectura';
  // FIX 3: vendedores del proyecto. Filtra por rol Ventas + proyecto asignado;
  // si ninguno coincide (o no hay info de proyecto), cae a TODOS los Ventas como fallback.
  const projectVendors = useMemo(() => {
    const ventas = users.filter(u => u.role === 'Ventas');
    const matching = ventas.filter(u => u.assignedProjectIds?.includes(unit.projectId));
    return matching.length > 0 ? matching : ventas;
  }, [users, unit.projectId]);
  const ejecutivoActualNombre = useMemo(() => {
    const found = users.find(u => u.id === formData.ejecutivoId);
    return found?.name || formData.asignadoPor || '';
  }, [users, formData.ejecutivoId, formData.asignadoPor]);

  // Cambio 3: estilo del selector de estado por estado
  const estadoStyles: Record<string, string> = {
    Disponible:  'bg-white border-green-500 text-green-700',
    Reservado:   'bg-yellow-50 border-yellow-500 text-yellow-700',
    Promesado:   'bg-blue-50 border-blue-500 text-blue-700',
    Escriturado: 'bg-purple-50 border-purple-500 text-purple-700',
  };
  // isReadOnly, no solo el rol: con el proyecto terminado tampoco se asigna ni reasigna.
  const canAssign = !isReadOnly && (!formData.clienteId || puedeReasignar);
  const canAssignClient = !isAssociatedToParent || parentUnit?.estado === 'Disponible';

  // NUEVA REGLA: permisos del cuadro financiero (descuentos, bono pie, forma de pago) por estado.
  //  Disponible/Reservado → permisos normales de rol.
  //  Promesado            → solo Admin/Supervisor.
  //  Escriturado          → nadie (read-only total).
  const canEditFinanciero = isReadOnly
    ? false
    : (formData.estado === 'Disponible' || formData.estado === 'Reservado')
      ? true
      : formData.estado === 'Promesado'
        ? ['Admin', 'Supervisor'].includes(currentUser.role)
        : false;

  // NUEVA REGLA: cronograma de pagos.
  //  Lectura → read-only. Admin/Supervisor → edición completa siempre.
  //  JefeSala/Ventas → editar pagos existentes directo; agregar/eliminar requiere aprobación
  //  cuando la unidad está Escriturada (canEditCronogramaEstructura=false en ese caso).
  const cronogramaReadOnly = isReadOnly; // Lectura / unidad asociada
  const canEditCronogramaEstructura = isReadOnly
    ? false
    : ['Admin', 'Supervisor'].includes(currentUser.role)
      ? true
      : formData.estado !== 'Escriturado'; // JefeSala/Ventas: libre salvo Escriturado

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
    () => formData.clienteId ? (clients.find(c => c.id === formData.clienteId) ?? client) : null,
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

  // Fix 3: inicializar descuentos de unidades vinculadas cuando cambian los activos
  useEffect(() => {
    const discounts: Record<string, number> = {};
    const inputs: Record<string, string> = {};
    const bono: Record<string, boolean> = {};
    [...linkedAssets.storages, ...linkedAssets.parkings].forEach(u => {
      const pm = (u.precioListaOriginal && u.precioLista && u.precioListaOriginal !== u.precioLista)
        ? Math.round((1 - u.precioLista / u.precioListaOriginal) * 100 * 10) / 10
        : 0;
      const eff = (u.descuentoCliente != null && u.descuentoCliente > 0) ? u.descuentoCliente : pm;
      discounts[u.id] = eff;
      inputs[u.id] = String(eff);
      bono[u.id] = u.aplicaBonoPie ?? false;
    });
    setLinkedDiscounts(discounts);
    setLinkedDiscountInputs(inputs);
    setLinkedBono(bono);
  }, [linkedAssets.storages.map(u => u.id).join(','), linkedAssets.parkings.map(u => u.id).join(',')]);

  // Descuento del Price Manager para el depto (informativo; base de cálculo si no hay override cliente)
  const descuentoPMDepto = useMemo(() => {
    if (!unit.precioListaOriginal || !unit.precioLista || unit.precioListaOriginal === unit.precioLista) return 0;
    return Math.round((1 - unit.precioLista / unit.precioListaOriginal) * 100 * 10) / 10;
  }, [unit.precioLista, unit.precioListaOriginal]);

  // Descuento efectivo del depto: lo que tiene el input (override o PM precargado)
  const descuentoInputNum = parseFloat(discountInput);
  const descuentoEfectivoDepto = !isNaN(descuentoInputNum) ? descuentoInputNum : descuentoPMDepto;

  const bonoCalcDepto = useMemo(() => calcResumenUnidad({
    precioListaOriginal: unit.precioListaOriginal ?? formData.precioLista,
    dctoPct: descuentoEfectivoDepto,
    bonoPct,
    aplicaBono: hasBono,
  }), [hasBono, bonoPct, unit.precioListaOriginal, formData.precioLista, descuentoEfectivoDepto]);

  // Precio de venta total: suma de valorTotal de cada unidad (cuando bono activo, valorTotal > precioConDescuento)
  const totalPrecioVentaNuevo = useMemo(() => {
    const r2l = (v: number) => Math.round(v * 100) / 100;
    const deptoVenta = bonoCalcDepto.valorTotal;
    const storagesVenta = linkedAssets.storages.reduce((acc, b) => {
      const orig = b.precioListaOriginal ?? b.precioLista;
      const d = linkedDiscounts[b.id] ?? b.descuentoPct ?? 0;
      return acc + r2l(calcResumenUnidad({ precioListaOriginal: orig, dctoPct: d, bonoPct, aplicaBono: linkedBono[b.id] ?? false }).valorTotal);
    }, 0);
    const parkingsVenta = linkedAssets.parkings.reduce((acc, p) => {
      const orig = p.precioListaOriginal ?? p.precioLista;
      const d = linkedDiscounts[p.id] ?? p.descuentoPct ?? 0;
      return acc + r2l(calcResumenUnidad({ precioListaOriginal: orig, dctoPct: d, bonoPct, aplicaBono: linkedBono[p.id] ?? false }).valorTotal);
    }, 0);
    return r2l(deptoVenta + storagesVenta + parkingsVenta);
  }, [bonoCalcDepto, linkedAssets, linkedDiscounts, linkedBono, bonoPct]);

  const canEditBono = ['Admin', 'Supervisor'].includes(currentUser.role);

  // Compra Segura = el bono pie, sumado POR UNIDAD con la fórmula canónica: el precio de
  // cada unidad se divide por (1 − bono%) y al resultado se le aplica el bono%. Eso es
  // justamente lo que devuelve calcResumenUnidad().bonificacion, la misma función que usa
  // el cuadro de arriba, así que no se recalcula a mano.
  //
  // Cubre TODAS las unidades con bono activo, no solo el depto: el precio de venta ya
  // incluye la inflación de cada una (totalPrecioVentaNuevo suma valorTotal), así que dejar
  // fuera la bodega colaba su bono dentro de Cuotas y Escritura.
  const compraSeguraUF = useMemo(() => {
    const r2l = (v: number) => Math.round(v * 100) / 100;
    let total = hasBono ? bonoCalcDepto.bonificacion : 0;
    for (const u of [...linkedAssets.storages, ...linkedAssets.parkings]) {
      if (!(linkedBono[u.id] ?? false)) continue;
      const orig = u.precioListaOriginal ?? u.precioLista;
      const d = linkedDiscounts[u.id] ?? u.descuentoPct ?? 0;
      total += calcResumenUnidad({ precioListaOriginal: orig, dctoPct: d, bonoPct, aplicaBono: true }).bonificacion;
    }
    return r2l(total);
  }, [hasBono, bonoCalcDepto.bonificacion, linkedAssets, linkedBono, linkedDiscounts, bonoPct]);

  // Hay Compra Segura si CUALQUIER unidad tiene bono, no solo el depto.
  const aplicaCompraSegura = compraSeguraUF > 0;

  // ── Coherencia de los % de la forma de pago ────────────────────────────────
  // SIN Compra Segura, los campos son porcentajes REALES y tienen que sumar 100 junto con
  // el Crédito: por eso no llevan badge dorado y se reescriben solos. Con Compra Segura no
  // pueden serlo (ella se lleva una tajada fija), así que siguen siendo pesos y el % real
  // se muestra en el badge. `fijada` es la componente que el usuario acaba de escribir.
  const reajustarPctReales = (
    cambios: Partial<{ promesa: number; cuotas: number; escritura: number; credito: number;
                       promesaOn: boolean; cuotasOn: boolean; escrituraOn: boolean }>,
    fijada?: 'promesa' | 'cuotas' | 'escritura',
  ) => {
    const promesaOn   = cambios.promesaOn   ?? fpPromesaOn;
    const cuotasOn    = cambios.cuotasOn    ?? fpCuotasOn;
    const escrituraOn = cambios.escrituraOn ?? fpEscrituraOn;
    const credito     = cambios.credito     ?? fpCreditoPct;

    if (cambios.promesaOn   !== undefined) setFpPromesaOn(cambios.promesaOn);
    if (cambios.cuotasOn    !== undefined) setFpCuotasOn(cambios.cuotasOn);
    if (cambios.escrituraOn !== undefined) setFpEscrituraOn(cambios.escrituraOn);
    if (cambios.credito     !== undefined) setFpCreditoPct(cambios.credito);

    const bruto = {
      promesaPct:   cambios.promesa   ?? fpPromesaPct,
      cuotasPct:    cambios.cuotas    ?? fpCuotasPct,
      escrituraPct: cambios.escritura ?? fpEscrituraPct,
    };

    // Con bono el campo es un peso libre: se guarda tal cual, sin normalizar.
    if (aplicaCompraSegura) {
      setFpPromesaPct(bruto.promesaPct);
      setFpCuotasPct(bruto.cuotasPct);
      setFpEscrituraPct(bruto.escrituraPct);
      return;
    }

    const r = redistribuirPctReales({
      actual: bruto, promesaActiva: promesaOn, cuotasActiva: cuotasOn,
      escrituraActiva: escrituraOn, creditoPct: credito, fijada,
    });
    setFpPromesaPct(r.promesaPct);
    setFpCuotasPct(r.cuotasPct);
    setFpEscrituraPct(r.escrituraPct);
  };

  // Red de seguridad: sin Compra Segura los campos SIEMPRE tienen que ser porcentajes
  // reales coherentes. Hace falta para los valores que no pasan por reajustarPctReales:
  // los defaults al abrir la unidad (3/20/10 con Crédito 80 sumarían 113), los que carga
  // una cotización y el momento en que se apaga el bono y los pesos dejan de ser válidos.
  //
  // No cicla: redistribuirPctReales es idempotente — aplicarla a un reparto ya coherente
  // devuelve los mismos números, y React corta el re-render al ver valores idénticos.
  useEffect(() => {
    if (!aplicaCompraSegura) reajustarPctReales({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aplicaCompraSegura, fpCreditoPct, fpPromesaPct, fpCuotasPct, fpEscrituraPct,
      fpPromesaOn, fpCuotasOn, fpEscrituraOn]);

  // Compra Segura como % del total de venta (0 si no hay bono)
  const compraSeguraPctOnTotal = () => {
    const r2l = (v: number) => Math.round(v * 100) / 100;
    if (!aplicaCompraSegura) return 0;
    const total = totalPrecioVentaNuevo > 0 ? totalPrecioVentaNuevo : (unit.precioLista || 0);
    return total > 0 ? r2l(compraSeguraUF / total * 100) : 0;
  };

  // Bloque E: Crédito Banco es un input fijo del usuario — ya no es pivote de redistribución.
  // Al togglear el bono ya NO se redistribuye: Compra Segura entra fija por config y
  // Cuotas+Escritura absorben el remanente automáticamente vía calcFormaPagoFija.

  // Sincronizar formData cuando cambian datos clave de la unidad (Fix A).
  // Bloque C: se salta el primer render (el init lazy ya normalizó el cronograma; volver
  // a setear pisaría los uid y el orden, y el doble render con uid nuevos causaría flicker).
  // En re-sincronizaciones (cambio de unidad/estado) se normaliza igual que en el init.
  const didMountSync = useRef(false);
  useEffect(() => {
    if (!didMountSync.current) { didMountSync.current = true; return; }
    setFormData({ ...unit, planPagos: normalizarPlanPagos(unit.planPagos ?? []) });
  }, [
    unit.id,
    unit.clienteId,
    unit.estado,
    unit.fechaAsignacion,
    unit.asignadoPor,
    unit.fechaReserva,
  ]);

  // FIX 2: al cambiar de unidad, re-aplicar el N° de cuotas persistido si existe
  useEffect(() => {
    if (unit.pieCuotas != null) setCantidadCuotasPie(unit.pieCuotas);
  }, [unit.id, unit.pieCuotas]);

  const handleChange = (field: keyof RealEstateUnit, value: any) => {
    if (isReadOnly) return;

    let updatedEstado = formData.estado;
    const extraUpdates: Partial<RealEstateUnit> = {};
    const hoy = new Date().toISOString().split('T')[0];

    if (field === 'estado') {
        // Nueva regla: no avanzar desde Disponible sin cliente
        if ((value === 'Reservado' || value === 'Promesado') && formData.estado === 'Disponible' && !formData.clienteId) {
            setPendingEstado(value);
            setAssignSearch('');
            setIsAssignModalOpen(true);
            return;
        }
        if (value === 'Reservado' && formData.clienteId && !formData.fechaReserva) {
            extraUpdates.fechaReserva = hoy;
        }
        if (value === 'Promesado' && !formData.fechaPromesa) {
            extraUpdates.fechaPromesa = hoy;
        }
        if (value === 'Escriturado' && !formData.fechaEscritura) {
            extraUpdates.fechaEscritura = hoy;
        }
        // ISSUE 2: Rollback — clear downstream dates when going to a lower estado
        if (value === 'Reservado') {
            extraUpdates.fechaPromesa = undefined;
            extraUpdates.fechaEscritura = undefined;
            extraUpdates.fechaSolicitudCredito = undefined;
            extraUpdates.fechaAprobacionCredito = undefined;
            extraUpdates.fechaTerminoPago = undefined;
            extraUpdates.fechaAlzamiento = undefined;
            extraUpdates.fechaEntrega = undefined;
            extraUpdates.fechaPago = undefined;
        }
        if (value === 'Promesado') {
            extraUpdates.fechaEscritura = undefined;
            extraUpdates.fechaSolicitudCredito = undefined;
            extraUpdates.fechaAprobacionCredito = undefined;
            extraUpdates.fechaTerminoPago = undefined;
            extraUpdates.fechaAlzamiento = undefined;
            extraUpdates.fechaEntrega = undefined;
            extraUpdates.fechaPago = undefined;
        }
        // Fix 2: cambio de estado es local — persiste al presionar "Guardar Cambios"
        if (value === 'Disponible') {
            // Limpiar datos de cliente y transacción visualmente
            setFormData(prev => ({
                ...prev,
                estado: 'Disponible',
                clienteId: null as any,
                asignadoPor: undefined,
                fechaReserva: undefined,
                fechaPromesa: undefined,
                fechaEscritura: undefined,
                fechaAsignacion: undefined,
                descuentoPct: 0,
                descuentoCliente: null as any,
                reservaMonto: 0,
                pie: 0,
                reservaVendedorId: undefined,
                reservaExpira: undefined,
                aplicaBonoPie: false,
                planPagos: [],
            }));
            setHasBono(false);
            setLinkedBono({});
            // FIX 2: descuentos a 0 al desasignar (vía cambio a Disponible)
            setLinkedDiscounts(prev => Object.fromEntries(Object.keys(prev).map(k => [k, 0])));
            setLinkedDiscountInputs(prev => Object.fromEntries(Object.keys(prev).map(k => [k, '0'])));
            setDiscountInput('0');
            setFpPromesaPct(PROMESA_PCT_MIN);
            setFpCuotasPct(20);
            setFpEscrituraPct(10);
            setFpCreditoPct(80);
            setPromesaError(null);
        } else {
            setFormData(prev => ({ ...prev, ...extraUpdates, estado: value }));
        }
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

  // FIX 2: deja todos los descuentos en 0 (al asignar/reasignar/desasignar cliente)
  const zeroAllDiscounts = () => {
    setDiscountInput('0');
    setLinkedDiscounts(prev => Object.fromEntries(Object.keys(prev).map(k => [k, 0])));
    setLinkedDiscountInputs(prev => Object.fromEntries(Object.keys(prev).map(k => [k, '0'])));
  };

  // FIX 1: en Escriturado no aplica Forma de Pago — apagar el checkbox si quedó activo
  useEffect(() => {
    if (formData.estado === 'Escriturado' && includePaymentPlan) setIncludePaymentPlan(false);
  }, [formData.estado, includePaymentPlan]);

  // REGLA: todo cambio en UnitDetail debe pasar por performSave(). El fieldMap en
  // server.ts debe incluir TODOS los campos editables. Nunca eliminar campos del
  // fieldMap sin verificar que no hay UI que los use. Verificar el modal
  // conservar/descartar después de cualquier cambio en el componente.
  const performSave = () => {
    // Hitos: el orden de las fechas CBR se valida ANTES de cualquier otra cosa y aborta
    // el guardado completo. Se rechaza en vez de autocorregir; el backend lo revalida.
    const errorCBR = validarOrdenCBR(formData);
    if (errorCBR) {
      setCbrError(errorCBR);
      showToast?.(errorCBR.mensaje, 'error');
      return;
    }
    setCbrError(null);

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

    // Guardar el override de descuento cliente si difiere del PM.
    // Si no hay cliente asignado, enviar null explícitamente para que el backend
    // limpie descuento_cliente en la BD (undefined se omite en JSON.stringify).
    const inputVal = parseFloat(discountInput);
    const descuentoClienteValue = formData.clienteId && !isNaN(inputVal) && inputVal > 0
      ? inputVal
      : (formData.clienteId ? undefined : null);

    // FIX 5: JefeSala/Ventas con la unidad Escriturada → modificar una cuota existente
    // también requiere aprobación (agregar/eliminar ya la requerían). Se difiere en el
    // guardado: las filas modificadas se revierten a su valor original y se dispara una
    // solicitud de aprobación por cada una, en vez de aplicar el cambio directo.
    let planPagosToSend = formData.planPagos;
    if (formData.estado === 'Escriturado' && !canEditCronogramaEstructura) {
      const originalByUid = new Map<string, PaymentItem>(unit.planPagos.map(p => [p.uid, p]));
      let diffCount = 0;
      planPagosToSend = formData.planPagos.map(p => {
        const original = originalByUid.get(p.uid);
        if (!original) return p; // fila nueva: no es responsabilidad de este guardado
        const changed = original.id !== p.id || original.date !== p.date || original.amount !== p.amount ||
          original.status !== p.status || (original.fechaPagoReal || '') !== (p.fechaPagoReal || '') ||
          (original.observacion || '') !== (p.observacion || '');
        if (changed) {
          diffCount++;
          void requestCronogramaApproval('modificar', p);
          return original;
        }
        return p;
      });
      if (diffCount > 0) {
        showToast?.(`${diffCount} cambio(s) de cronograma enviados a aprobación`, 'success');
      }
    }

    // Hitos: con Contado, el bloque de crédito no aplica y tampoco se guarda con datos.
    // El backend lo normaliza igual (defensa en profundidad), pero limpiarlo acá deja el
    // formData coherente con lo que se acaba de enviar.
    const aEnviar = {
      ...formData,
      planPagos: planPagosToSend,
      descuentoCliente: descuentoClienteValue as any,
      pieCuotas: cantidadCuotasPie,
      diaPago,
      observaciones: finalObservaciones,
    };
    const payload = aplicaCredito(formData.formaFinanciamiento) ? aEnviar : limpiarCamposCredito(aEnviar);

    try {
      onUpdate(payload as RealEstateUnit);
      showToast?.('Cambios guardados');
    } catch {
      showToast?.('Error al guardar', 'error');
    }
  };

  const handleSaveWithLog = () => {
    // Si hay cliente y el descuento difiere del PM guardado, pedir confirmación
    const inputVal = parseFloat(discountInput);
    const savedValue = unit.descuentoCliente ?? descuentoPMDepto;
    if (hasClient && !isNaN(inputVal) && inputVal !== savedValue) {
      setShowSaveOverrideModal(true);
      return;
    }
    performSave();
  };

  // Fix 2: navegar atrás con check de cambios pendientes
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedModal(true);
    } else {
      onBack();
    }
  };

  const addManualPayment = () => {
      if (isReadOnly) return;
      setFormData(prev => {
          const nextId = `Cuota ${prev.planPagos.length + 1}`;

          // Fecha sugerida: un mes después de la última fila, en el día de pago vigente.
          // Es solo una sugerencia — el usuario la edita libremente y nada más se mueve.
          let nextDate: string;
          if (prev.planPagos.length === 0) {
              const now = new Date();
              nextDate = fechaCuota(now.getFullYear(), now.getMonth() + 1, 1, diaPago);
          } else {
              const last = prev.planPagos[prev.planPagos.length - 1];
              const [ly, lm] = last.date.split('-').map(Number);
              nextDate = fechaCuota(ly, lm, 1, diaPago);
          }

          const newItem: PaymentItem = {
              uid: crypto.randomUUID(),
              id: nextId,
              date: nextDate,
              amount: '0',
              status: 'Pendiente',
              fechaPagoReal: '',
              observacion: ''
          };
          // Se agrega al final, sin reordenar nada. Ordenar es decisión del usuario
          // (click en el encabezado "Vencimiento").
          return { ...prev, planPagos: [...prev.planPagos, newItem] };
      });
  };

  /**
   * Hitos: cambio de forma de financiamiento. Al pasar a Contado se limpian los campos
   * de crédito en el acto (no recién al guardar): el bloque desaparece de pantalla, y
   * dejar datos invisibles listos para persistirse sería un dato fantasma.
   */
  const handleFormaFinanciamientoChange = (valor: string) => {
    if (isReadOnly) return;
    const forma = valor === '' ? null : (valor as 'Contado' | 'Financiamiento');
    setFormData(prev => {
      const conForma = { ...prev, formaFinanciamiento: forma };
      return aplicaCredito(forma) ? conForma : limpiarCamposCredito(conForma);
    });
  };

  const handleLimpiarCronograma = () => {
    if (isReadOnly) return;
    setFormData(prev => ({ ...prev, planPagos: [] }));
  };

  // FIX 3: JefeSala/Ventas con la unidad Escriturada → agregar/eliminar pago crea una
  // solicitud de aprobación (no aplica el cambio localmente) en vez de editar directo.
  const requestCronogramaApproval = async (accion: 'agregar' | 'eliminar' | 'modificar', pago: PaymentItem) => {
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    try {
      const res = await fetch('/api/approval-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tipo: 'cronograma_pago',
          unitId: unit.id,
          projectId: unit.projectId,
          descripcion: `Solicitud de ${accion} pago en cronograma de unidad ${unit.numero}`,
          datos: { accion, pago, unitId: unit.id, estadoAntes: formData.planPagos },
        }),
      });
      showToast?.(res.ok ? 'Solicitud enviada para aprobación' : 'Error al enviar solicitud', res.ok ? 'success' : 'error');
    } catch { showToast?.('Error al enviar solicitud', 'error'); }
  };

  const requestAgregarCuota = () => {
    const hoy = new Date().toISOString().split('T')[0];
    const nuevo: PaymentItem = { uid: crypto.randomUUID(), id: `Cuota ${formData.planPagos.length + 1}`, date: hoy, amount: '0', status: 'Pendiente', fechaPagoReal: '', observacion: '' };
    void requestCronogramaApproval('agregar', nuevo);
  };

  const generatePaymentSchedule = () => {
    if (isReadOnly) return;

    // Fix 3: usar precio total (depto + bodegas + estacs)
    const precioVentaFinal = totalPrecioVentaNuevo > 0 ? totalPrecioVentaNuevo : (unit.precioLista || 0);
    if (precioVentaFinal === 0) return;

    // Usar cuotasN del plan de pago seleccionado, fallback al config del proyecto
    const planCuotasN = paymentPlans.find(p => p.id === selectedPlanId)?.cuotasN ?? 0;
    const cuotasN = planCuotasN > 0 ? planCuotasN : cantidadCuotasPie;

    // Bloque E: montos vía la MISMA función que el display (calcFormaPagoFija), sin duplicar lógica.
    const formaPlan = calcFormaPagoFija({
      precioVenta: precioVentaFinal,
      compraSeguraUF,
      creditoPct: fpCreditoPct,
      cuotasPct: fpCuotasPct,
      escrituraPct: fpEscrituraPct,
      numCuotas: cuotasN,
      promesaPct: fpPromesaPct,
      promesaActiva: fpPromesaOn,
      cuotasActiva: fpCuotasOn,
      escrituraActiva: fpEscrituraOn,
    });
    // Todos los montos del cronograma se guardan con 2 decimales, igual que se muestran
    // (antes eran 4). El redondeo de la cuota individual deja un residuo de céntimos que
    // alguien tiene que absorber para que el Total Planificado cuadre con el Precio de Venta.
    const ufPromesa   = r2fmt(formaPlan.promesaUF);
    const ufCuotaUnit = cuotasN > 0 ? r2fmt(formaPlan.cuotasUF / cuotasN) : 0;
    const ufCredito   = r2fmt(formaPlan.creditoUF);
    // La condición mira el MONTO, no el peso: con Escritura apagada, Cuotas pasa a ser el
    // plug y recibe todo el remanente aunque su peso ingresado sea 0.
    const cuotasReales = (fpCuotasOn && cuotasN > 0 && ufCuotaUnit > 0) ? cuotasN : 0;
    const residuoCuotas = r2fmt(r2fmt(formaPlan.cuotasUF) - r2fmt(ufCuotaUnit * cuotasReales));
    // Escritura absorbe el residuo cuando está activa; si no, se lo lleva la última cuota.
    const ufEscritura = fpEscrituraOn ? r2fmt(formaPlan.escrituraUF + residuoCuotas) : 0;
    const ajusteUltimaCuota = fpEscrituraOn ? 0 : residuoCuotas;

    const today = new Date();
    // El día de pago manda sobre TODAS las filas: el mes avanza, el día no cambia
    // (salvo clamp a fin de mes y ajuste de fin de semana, que resuelve fechaCuota).
    const anio = today.getFullYear();
    const mes = today.getMonth() + 1; // fechaCuota espera 1..12
    let monthCursor = 1;
    const nuevasCuotas: PaymentItem[] = [];

    // 1. Promesa — mes siguiente. Con la componente apagada, ufPromesa es 0 y no se emite fila.
    if (ufPromesa > 0) {
      nuevasCuotas.push({ uid: crypto.randomUUID(), id: 'Promesa', date: fechaCuota(anio, mes, monthCursor, diaPago), amount: ufPromesa.toFixed(2), status: 'Pendiente' });
      monthCursor++;
    }

    // 2. Cuotas del pie — meses consecutivos
    for (let i = 1; i <= cuotasReales; i++) {
      const monto = i === cuotasReales ? r2fmt(ufCuotaUnit + ajusteUltimaCuota) : ufCuotaUnit;
      nuevasCuotas.push({ uid: crypto.randomUUID(), id: `Cuota ${i}`, date: fechaCuota(anio, mes, monthCursor, diaPago), amount: monto.toFixed(2), status: 'Pendiente' });
      monthCursor++;
    }

    // 3. Escritura y Crédito — mes siguiente a la última cuota
    const fechaFinal = fechaCuota(anio, mes, monthCursor, diaPago);

    // Bloque E: Escritura es el plug. Se guarda según el MONTO calculado (no el peso), para que
    // el remanente nunca se pierda del plan aunque el peso de Escritura sea 0 (p.ej. ambos pesos 0).
    if (ufEscritura > 0) {
      nuevasCuotas.push({ uid: crypto.randomUUID(), id: 'Escritura', date: fechaFinal, amount: ufEscritura.toFixed(2), status: 'Pendiente' });
    }
    if (fpCreditoPct > 0 && ufCredito > 0) {
      nuevasCuotas.push({ uid: crypto.randomUUID(), id: 'Crédito Hipotecario', date: fechaFinal, amount: ufCredito.toFixed(2), status: 'Pendiente', observacion: 'Financiamiento bancario' });
    }

    if (nuevasCuotas.length === 0) return;

    const pagadosExistentes = formData.planPagos?.filter(p => p.status === 'Pagado').length ?? 0;
    if (pagadosExistentes > 0) {
      if (!confirm(
        `Hay ${pagadosExistentes} pago${pagadosExistentes > 1 ? 's' : ''} marcado${pagadosExistentes > 1 ? 's' : ''} como Pagado. ` +
        `¿Seguro que quieres reemplazar el cronograma completo?`
      )) return;
    }

    // Orden natural del plan (Promesa → Cuota 1..N → Escritura → Crédito), sin ordenar
    // por fecha: si el usuario quiere otro orden, hace click en el encabezado.
    setFormData(prev => ({ ...prev, planPagos: normalizarPlanPagos(nuevasCuotas) }));
    setOrdenVencimiento(null);
    showToast?.(`✓ ${nuevasCuotas.length} cuotas generadas en el cronograma`);
  };

  const totalPaidReal = formData.planPagos.filter(p => p.status === 'Pagado').reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
  const totalPlanificado = formData.planPagos.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);
  const totalEstructuraFinanciera = (formData.reservaMonto || 0) + (formData.pie || 0);
  
  const percentPaid = totalPrecioVentaNuevo > 0 ? (totalPaidReal / totalPrecioVentaNuevo) * 100 : 0;

  const precioBaseForma = totalPrecioVentaNuevo > 0 ? totalPrecioVentaNuevo : (unit.precioLista || 0);

  const formaDisplay = useMemo(() => calcFormaPagoFija({
    precioVenta: precioBaseForma,
    compraSeguraUF,
    creditoPct: fpCreditoPct,
    promesaPct: fpPromesaPct,
    cuotasPct: fpCuotasPct,
    escrituraPct: fpEscrituraPct,
    numCuotas: cantidadCuotasPie,
    promesaActiva: fpPromesaOn,
    cuotasActiva: fpCuotasOn,
    escrituraActiva: fpEscrituraOn,
  }), [precioBaseForma, compraSeguraUF, fpCreditoPct, fpPromesaPct, fpCuotasPct, fpEscrituraPct, cantidadCuotasPie, fpPromesaOn, fpCuotasOn, fpEscrituraOn]);
  const ufPromesaDisplay      = formaDisplay.promesaUF;
  const ufCuotasDisplay       = formaDisplay.cuotasUF;
  const ufCuotaUnitDisplay    = formaDisplay.cuotaIndividualUF;
  const ufEscrituraDisplay    = formaDisplay.escrituraUF;
  const ufCreditoDisplay      = formaDisplay.creditoUF;
  const ufCompraSeguraDisplay = formaDisplay.compraSeguraUF;
  const compraSeguaPctDisplay = formaDisplay.compraSeguraPct;
  const totalFormaDisplay     = formaDisplay.totalUF;
  const promesaPctDisplay     = formaDisplay.promesaPct;
  const cuotasPctDisplay      = formaDisplay.cuotasPct;
  const escrituraPctDisplay   = formaDisplay.escrituraPct;
  const creditoPctDisplay     = formaDisplay.creditoPct;

  const r2pct = (v: number) => Math.round(v * 100) / 100;
  // Bloque E: los % reales (sobre el precio de venta) siempre suman 100 cuando hay remanente.
  // Los fp*Pct crudos son ahora pesos (no suman 100), así que el totalizador usa los % reales.
  const totalPctRaw = r2pct(promesaPctDisplay + cuotasPctDisplay + escrituraPctDisplay + compraSeguaPctDisplay + creditoPctDisplay);

  const isDelayed = (dueStr: string, realStr?: string) => {
      if (!dueStr || !realStr) return false;
      return new Date(realStr) > new Date(dueStr);
  };

  return (
    <div className="animate-in slide-in-from-right duration-300 pb-20">

      {/* Fix 2: Modal cambios pendientes */}
      {showUnsavedModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Cambios sin guardar</h3>
            <p className="text-sm text-gray-600">
              Tienes cambios sin guardar en {formData.type} {formData.numero}. ¿Qué quieres hacer?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { handleSaveWithLog(); setShowUnsavedModal(false); onBack(); }}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
              >
                Guardar y salir
              </button>
              <button
                onClick={() => { setFormData({ ...unit, planPagos: normalizarPlanPagos(unit.planPagos ?? []) }); setShowUnsavedModal(false); onBack(); }}
                className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-colors border border-red-200"
              >
                Descartar cambios
              </button>
              <button
                onClick={() => setShowUnsavedModal(false)}
                className="w-full py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar override descuento cliente */}
      {showSaveOverrideModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Confirmar descuento cliente</h3>
            <p className="text-sm text-gray-600">
              El descuento del Price Manager es <strong>{descuentoPMDepto}%</strong>.
              Estás guardando un override de <strong>{discountInput}%</strong> para este cliente. ¿Confirmar?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowSaveOverrideModal(false); performSave(); }}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
              >
                Confirmar y guardar
              </button>
              <button
                onClick={() => setShowSaveOverrideModal(false)}
                className="w-full py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar carga de cotización */}
      {showLoadCotizacionModal && pendingCotizacion && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Cargar cotización</h3>
            <p className="text-sm text-gray-600">
              Esto reemplazará los descuentos y la forma de pago actuales con los de la cotización del{' '}
              <strong>{new Date(pendingCotizacion.createdAt).toLocaleDateString('es-CL')}</strong>. ¿Continuar?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowLoadCotizacionModal(false); cargarDesdeCotizacion(pendingCotizacion); setPendingCotizacion(null); }}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
              >
                Sí, cargar cotización
              </button>
              <button
                onClick={() => { setShowLoadCotizacionModal(false); setPendingCotizacion(null); }}
                className="w-full py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix 1: Banner unidad asociada a padre */}
      {isAssociatedToParent && parentUnit && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-800">
                Unidad asociada al Depto {parentUnit.numero} — Estado: {parentUnit.estado}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                El estado y el titular se heredan del departamento padre. Edición bloqueada.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cabecera Principal */}
      <div className="mb-6 pb-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{formData.type} {formData.numero}</h1>
                    <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">Expediente de Transacción</p>
                </div>
                <select
                    disabled={isReadOnly}
                    value={formData.estado}
                    onChange={(e) => handleChange('estado', e.target.value)}
                    title={isReadOnly ? 'El proyecto está terminado: el estado no se puede cambiar' : 'Cambiar estado de la unidad'}
                    className={`ml-4 px-4 py-2 rounded-lg text-base font-semibold border-2 shadow-sm outline-none focus:ring-2 focus:ring-offset-1 ${isReadOnly ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${estadoStyles[formData.estado] ?? estadoStyles.Disponible}`}
                >
                    {['Disponible', 'Reservado', 'Promesado', 'Escriturado'].map(s => <option key={s} value={s}>● {s}</option>)}
                </select>
            </div>
            {!isReadOnly && (
                <button onClick={handleSaveWithLog} className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg transition-all active:scale-95 ${hasUnsavedChanges ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                    <Save className="w-4 h-4" />
                    {hasUnsavedChanges ? '• Guardar Cambios' : 'Guardar Cambios'}
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
                        {canAssign && canAssignClient && onAssignClient && (
                          <button
                            onClick={() => { setClientMenuOpen(false); setAssignSearch(''); setIsAssignModalOpen(true); }}
                            className="w-full px-4 py-3 text-sm font-medium text-left hover:bg-gray-50 flex items-center gap-3"
                          >
                            <UserPlus className="w-4 h-4 text-green-500" /> Reasignar Cliente
                          </button>
                        )}
                        {canAssign && canAssignClient && onUnassignClient && (
                          <button
                            onClick={() => { setClientMenuOpen(false); zeroAllDiscounts(); onUnassignClient(unit.id); }}
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
                    onClick={() => canAssign && canAssignClient && onAssignClient && (setAssignSearch(''), setIsAssignModalOpen(true))}
                    title={canAssign && canAssignClient ? 'Clic para asignar cliente' : ''}
                    className={`p-8 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 text-sm font-medium italic flex items-center justify-center gap-2 transition-all ${canAssign && canAssignClient && onAssignClient ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 hover:text-blue-500' : ''}`}
                  >
                    {canAssign && canAssignClient && onAssignClient ? (
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
                        <button onClick={() => { setIsAssignModalOpen(false); setPendingEstado(null); }} className="p-1 hover:bg-gray-100 rounded-lg">
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
                            onClick={() => {
                              zeroAllDiscounts(); // FIX 2: nuevo cliente → descuentos a 0
                              onAssignClient?.(c.id, unit.id);
                              setIsAssignModalOpen(false);
                              if (pendingEstado && pendingEstado !== 'Reservado') {
                                const hoyPending = new Date().toISOString().split('T')[0];
                                setFormData(prev => ({
                                  ...prev,
                                  estado: pendingEstado as RealEstateUnit['estado'],
                                  ...(!prev.fechaPromesa && pendingEstado === 'Promesado' ? { fechaPromesa: hoyPending } : {}),
                                }));
                              }
                              setPendingEstado(null);
                            }}
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
                        <button onClick={() => { setIsAssignModalOpen(false); setPendingEstado(null); }}
                          className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-6 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <AssetTagInput disabled={isReadOnly} label="Estacionamientos" type="Estacionamiento" allUnits={allUnits} selectedUnits={formData.estacionamientos} onChange={(val) => handleChange('estacionamientos', val)} />
                    <AssetTagInput disabled={isReadOnly} label="Bodegas" type="Bodega" allUnits={allUnits} selectedUnits={formData.bodegas} onChange={(val) => handleChange('bodegas', val)} />
              </div>
          </div>

          {/* Ficha Técnica */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-xs font-bold text-gray-400 mb-6 flex items-center gap-2 uppercase tracking-widest"><Info className="w-4 h-4" /> Especificaciones Técnicas</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-6">
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">SUPERFICIE</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Ruler className="w-4 h-4 text-blue-500"/> {formData.superficie || '-'} m²</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <label className="text-[10px] text-gray-400 font-black block mb-1">TERRAZA</label>
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Ruler className="w-4 h-4 text-blue-500"/> {formData.terraza || '-'} m²</div>
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

          {/* Cronograma de Pagos */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-gray-500 flex items-center gap-2 uppercase tracking-widest"><Wallet className="w-4 h-4 text-blue-600"/> Cronograma de Pagos</h3>
              {/* NUEVA REGLA cronograma: agregar/eliminar (estructura) requiere canEditCronogramaEstructura.
                  Admin/Supervisor siempre; JefeSala/Ventas libre salvo Escriturado; Lectura nunca. */}
              {canEditCronogramaEstructura ? (
                  <div className="flex gap-2">
                    {formData.planPagos.length > 0 && (
                      <button onClick={handleLimpiarCronograma} className="text-[10px] bg-white border border-red-200 text-red-500 font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 hover:bg-red-50 transition-all shadow-sm"><Trash2 className="w-3 h-3" /> LIMPIAR TODO</button>
                    )}
                    <button onClick={addManualPayment} className="text-[10px] bg-white border border-gray-200 text-gray-600 font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-all shadow-sm"><Plus className="w-3 h-3" /> AGREGAR CUOTA</button>
                  </div>
              ) : (!cronogramaReadOnly && formData.estado === 'Escriturado' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-amber-600 font-bold bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Requiere aprobación de Admin/Supervisor</span>
                    <button onClick={requestAgregarCuota} className="text-[10px] bg-white border border-amber-300 text-amber-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 hover:bg-amber-50 transition-all shadow-sm"><Plus className="w-3 h-3" /> SOLICITAR CUOTA</button>
                  </div>
              ))}
            </div>
            <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-sm table-fixed border-collapse">
                <thead>
                    <tr className="bg-gray-50/30 border-b border-gray-100 text-[9px] text-gray-400 font-black uppercase tracking-widest">
                        <th className="px-3 py-4 w-[14%]">Referencia</th>
                        {/* Único encabezado ordenable: el click alterna asc/desc y REESCRIBE
                            el orden de planPagos (se persiste al guardar). Ya no hay ningún
                            reordenamiento automático en el resto del cronograma. */}
                        <th className="px-2 py-4 w-[16%] text-center">
                            <button
                                type="button"
                                onClick={() => {
                                    const siguiente: OrdenVencimiento = ordenVencimiento === 'asc' ? 'desc' : 'asc';
                                    setOrdenVencimiento(siguiente);
                                    setFormData(prev => ({ ...prev, planPagos: ordenarPorVencimiento(prev.planPagos, siguiente) }));
                                }}
                                title="Ordenar por fecha de vencimiento"
                                className="inline-flex items-center gap-1 mx-auto text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-colors"
                            >
                                Vencimiento
                                <span className={ordenVencimiento ? 'text-blue-600' : 'text-gray-300'}>
                                    {ordenVencimiento === 'desc' ? '▼' : '▲'}
                                </span>
                            </button>
                        </th>
                        <th className="px-2 py-4 w-[16%] text-center">Pago Real</th>
                        <th className="px-2 py-4 w-[16%] text-right">Monto (UF)</th>
                        <th className="px-2 py-4 w-[10%] text-center">Estado</th>
                        <th className="px-3 py-4 w-[23%]">Comentarios</th>
                        <th className="px-2 py-4 w-[5%] text-center"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {formData.planPagos.length === 0 ? (
                        <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400 italic text-xs font-medium">No se registran pagos pendientes o realizados.</td></tr>
                    ) : (showAllPayments ? formData.planPagos : formData.planPagos.slice(0, 5)).map((p, idx) => {
                    const delayed = isDelayed(p.date, p.fechaPagoReal);
                    return (
                    <tr key={p.uid} className="hover:bg-gray-50 transition-colors group">
                        <td className="px-3 py-3"><input disabled={isReadOnly} type="text" value={p.id} onChange={(e) => { const next = [...formData.planPagos]; next[idx].id = e.target.value; setFormData({...formData, planPagos: next}); }} className="w-full bg-transparent border-none focus:ring-0 p-0 text-gray-900 font-bold text-xs truncate" /></td>
                        {/* Editar una fecha afecta SOLO a esta fila: sin cascada y sin reubicarla. */}
                        <td className="px-2 py-3 text-center"><input disabled={isReadOnly} type="date" value={p.date} onChange={(e) => setFormData(prev => ({ ...prev, planPagos: prev.planPagos.map(f => f.uid === p.uid ? { ...f, date: e.target.value } : f) }))} className="w-full bg-transparent border-none focus:ring-0 p-0 text-gray-600 text-[11px] font-bold text-center" /></td>
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
                        <td className="px-2 py-3 text-center">{canEditCronogramaEstructura ? <button onClick={() => setFormData({...formData, planPagos: formData.planPagos.filter((_, i) => i !== idx)})} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button> : (!cronogramaReadOnly && formData.estado === 'Escriturado' && <button title="Solicitar eliminación (requiere aprobación)" onClick={() => requestCronogramaApproval('eliminar', p)} className="text-amber-300 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>)}</td>
                    </tr>
                    )})}
                </tbody>
                </table>
            </div>
            {formData.planPagos.length > 5 && (
              <div className="border-t border-gray-50 px-6 py-2 text-center">
                <button
                  onClick={() => setShowAllPayments(v => !v)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {showAllPayments ? 'Ver menos' : `Ver todos (${formData.planPagos.length - 5} más)`}
                </button>
              </div>
            )}
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
                    {/* FIX 2: Ejecutivo — UN SOLO campo. La fecha de asignación se setea a NOW()
                        automáticamente al seleccionar (se guarda en BD pero NO se expone como campo). */}
                    <div className="md:col-span-2">
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Ejecutivo</label>
                        <div className="relative">
                            <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 z-10" />
                            {canEditEjecutivo ? (
                                <select
                                    value={formData.ejecutivoId || ''}
                                    onChange={(e) => {
                                        const hoy = new Date().toISOString().split('T')[0];
                                        setFormData(prev => ({ ...prev, ejecutivoId: e.target.value || undefined, fechaAsignacion: e.target.value ? hoy : prev.fechaAsignacion }));
                                    }}
                                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
                                >
                                    <option value="">— Seleccionar ejecutivo —</option>
                                    {projectVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                            ) : (
                                <input
                                    disabled
                                    type="text"
                                    value={ejecutivoActualNombre}
                                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 outline-none cursor-not-allowed"
                                    placeholder="Sin asignar"
                                />
                            )}
                        </div>
                    </div>
                    <div className="hidden md:block"></div>

                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Reserva</label>
                        <div className="relative">
                            <Calendar className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${(!canEditDates && !hasClient) ? 'text-gray-200' : 'text-gray-300'}`} />
                            {canEditDates ? (
                                <input
                                    disabled={isReadOnly}
                                    type="date"
                                    value={formData.fechaReserva || ''}
                                    onChange={(e) => handleChange('fechaReserva', e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            ) : (
                                <input
                                    disabled={isReadOnly || !hasClient}
                                    type="date"
                                    title={!hasClient ? "Asigne un cliente para registrar reserva" : ""}
                                    value={formData.fechaReserva || ''}
                                    onChange={(e) => handleChange('fechaReserva', e.target.value)}
                                    className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!hasClient ? 'cursor-not-allowed opacity-50' : ''}`}
                                />
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Promesa</label>
                        <div className="relative">
                            <FileText className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${(!canEditDates && !hasClient) ? 'text-gray-200' : 'text-gray-300'}`} />
                            {canEditDates ? (
                                <input
                                    disabled={isReadOnly}
                                    type="date"
                                    value={formData.fechaPromesa || ''}
                                    onChange={(e) => handleChange('fechaPromesa', e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            ) : (
                                <input
                                    disabled={isReadOnly || !hasClient}
                                    type="date"
                                    title={!hasClient ? "Asigne un cliente para registrar promesa" : ""}
                                    value={formData.fechaPromesa || ''}
                                    onChange={(e) => handleChange('fechaPromesa', e.target.value)}
                                    className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!hasClient ? 'cursor-not-allowed opacity-50' : ''}`}
                                />
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Escritura</label>
                        <div className="relative">
                            <FileCheck className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${(!canEditDates && !hasClient) ? 'text-gray-200' : 'text-gray-300'}`} />
                            {canEditDates ? (
                                <input
                                    disabled={isReadOnly}
                                    type="date"
                                    value={formData.fechaEscritura || ''}
                                    onChange={(e) => handleChange('fechaEscritura', e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            ) : (
                                <input
                                    disabled={isReadOnly || !hasClient}
                                    type="date"
                                    title={!hasClient ? "Asigne un cliente para registrar escritura" : ""}
                                    value={formData.fechaEscritura || ''}
                                    onChange={(e) => handleChange('fechaEscritura', e.target.value)}
                                    className={`w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${!hasClient ? 'cursor-not-allowed opacity-50' : ''}`}
                                />
                            )}
                        </div>
                    </div>
                    {/* Hitos: Forma de financiamiento gobierna todo el bloque de crédito.
                        Con Contado esos campos no aplican y tampoco se guardan con datos. */}
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Forma de Financiamiento</label>
                        <div className="relative">
                            <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 z-10" />
                            <select
                                disabled={isReadOnly}
                                value={formData.formaFinanciamiento || ''}
                                onChange={(e) => handleFormaFinanciamientoChange(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <option value="">— Seleccionar —</option>
                                <option value="Contado">Contado</option>
                                <option value="Financiamiento">Financiamiento</option>
                            </select>
                        </div>
                    </div>

                    {aplicaCredito(formData.formaFinanciamiento) ? (
                      <>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Banco Financista</label>
                            <div className="relative">
                                <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                                <input
                                    disabled={isReadOnly}
                                    type="text"
                                    value={formData.banco || ''}
                                    onChange={(e) => handleChange('banco', e.target.value)}
                                    placeholder="Ej: Banco de Chile"
                                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 placeholder:font-medium placeholder:text-gray-300"
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
                        {/* Solo lectura: espeja el "Crédito Banco" de los detalles financieros.
                            Lee fpCreditoPct, el MISMO estado que alimenta ese input — no un
                            recálculo propio, para que no puedan divergir. */}
                        <div>
                            <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">% de Financiamiento</label>
                            <div className="relative">
                                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-200" />
                                <input
                                    disabled
                                    readOnly
                                    type="text"
                                    data-testid="pct-financiamiento"
                                    value={`${formatPct(porcentajeFinanciamiento(formData.formaFinanciamiento, fpCreditoPct) ?? 0)} %`}
                                    className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-gray-200 rounded-xl text-xs font-bold text-gray-500 outline-none cursor-not-allowed"
                                />
                            </div>
                            <p className="text-[9px] text-gray-400 mt-1">Igual a "Crédito Banco" en detalles financieros</p>
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Plazo del Crédito (años)</label>
                            <div className="relative">
                                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                                <input
                                    disabled={isReadOnly}
                                    type="number"
                                    min={0}
                                    max={40}
                                    step={1}
                                    value={formData.plazoCreditoAnios ?? ''}
                                    onChange={(e) => handleChange('plazoCreditoAnios', e.target.value === '' ? null : Number(e.target.value))}
                                    placeholder="Ej: 20"
                                    className="w-full pl-9 pr-3 py-2 bg-blue-50/50 border border-blue-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 placeholder:font-medium placeholder:text-gray-300"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Tasa de Financiamiento (%)</label>
                            <div className="relative">
                                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                                <FormattedInput disabled={isReadOnly} format="PERCENT" value={formData.tasaFinanciamiento || 0} onChange={(val) => handleChange('tasaFinanciamiento', val)} className="w-full pl-9 pr-3 py-2 bg-blue-50/50 border border-blue-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-2 flex items-center">
                        <p className="text-[11px] text-gray-400 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 w-full">
                          Compra al contado: no aplican banco, fechas de crédito, monto, % ni plazo.
                        </p>
                      </div>
                    )}

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

                    {/* CBR: posterior a la firma de Escritura. AMBOS OPCIONALES — nunca son
                        requisito para que el proceso de la unidad se considere completo. Si se
                        completan, se valida el orden al guardar (rechaza, no autocorrige). */}
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha Ingreso al CBR</label>
                        <div className="relative">
                            <FileSignature className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                            <input
                                disabled={isReadOnly}
                                type="date"
                                data-testid="fecha-ingreso-cbr"
                                value={formData.fechaIngresoCBR || ''}
                                onChange={(e) => { setCbrError(null); handleChange('fechaIngresoCBR', e.target.value); }}
                                className={`w-full pl-9 pr-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${cbrError?.campo === 'fechaIngresoCBR' ? 'border-red-300 bg-red-50' : 'bg-gray-50 border-gray-200'}`}
                            />
                        </div>
                        <p className="text-[9px] text-gray-400 mt-1">Opcional</p>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-gray-400 mb-1 block uppercase">Fecha de Inscripción CBR</label>
                        <div className="relative">
                            <FileCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                            <input
                                disabled={isReadOnly}
                                type="date"
                                data-testid="fecha-inscripcion-cbr"
                                value={formData.fechaInscripcionCBR || ''}
                                onChange={(e) => { setCbrError(null); handleChange('fechaInscripcionCBR', e.target.value); }}
                                className={`w-full pl-9 pr-3 py-2 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-100 ${cbrError?.campo === 'fechaInscripcionCBR' ? 'border-red-300 bg-red-50' : 'bg-gray-50 border-gray-200'}`}
                            />
                        </div>
                        <p className="text-[9px] text-gray-400 mt-1">Opcional</p>
                    </div>
                    {cbrError && (
                      <div className="md:col-span-3">
                        <p data-testid="cbr-error" className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> {cbrError.mensaje}
                        </p>
                      </div>
                    )}
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

          {/* Historial de Precios */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <h3 className="text-xs font-bold text-gray-500 flex items-center gap-2 uppercase tracking-widest">
                <Tag className="w-4 h-4 text-amber-500" /> Historial de Precios
              </h3>
            </div>
            {priceHistory.length === 0 ? (
              <p className="text-xs text-gray-400 italic px-4 py-3">Sin cambios de precio registrados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      <th className="px-4 py-3 text-left">Fecha</th>
                      <th className="px-4 py-3 text-right">Anterior</th>
                      <th className="px-4 py-3 text-right">Nuevo</th>
                      <th className="px-4 py-3 text-right">Variación</th>
                      <th className="px-4 py-3 text-left">Motivo</th>
                      <th className="px-4 py-3 text-left">Usuario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {priceHistory.map(entry => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 font-mono">
                          {new Date(entry.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-500">UF {formatUF(entry.precioAnterior)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-gray-800">UF {formatUF(entry.precioNuevo)}</td>
                        <td className={`px-4 py-3 text-right font-bold font-mono ${entry.variacionPct < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {entry.variacionPct > 0 ? '+' : ''}{formatPct(entry.variacionPct)}%
                        </td>
                        <td className="px-4 py-3 text-gray-400 italic">{entry.motivo || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{entry.usuarioNombre}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Desglose Financiero - COLUMNA DERECHA */}
        <div className="xl:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5 sticky top-8">
            <h3 className="text-xs font-bold text-gray-400 border-b border-gray-50 pb-3 flex items-center gap-2 uppercase tracking-widest">
              <Coins className="w-4 h-4 text-blue-600" /> Estructura Financiera
            </h3>

            {/* ── Cargar desde cotización ── */}
            {canEditFinanciero && hasClient && paymentPlans.length === 1 && (
              <button
                onClick={() => { setPendingCotizacion(paymentPlans[0]); setShowLoadCotizacionModal(true); }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5" /> Cargar desde cotización ({new Date(paymentPlans[0].createdAt).toLocaleDateString('es-CL')})
              </button>
            )}
            {canEditFinanciero && hasClient && paymentPlans.length > 1 && (
              <select
                defaultValue=""
                onChange={e => {
                  const plan = paymentPlans.find(p => p.id === e.target.value);
                  if (plan) { setPendingCotizacion(plan); setShowLoadCotizacionModal(true); }
                }}
                className="w-full px-3 py-2 text-xs border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 bg-blue-50 text-blue-700 font-bold"
              >
                <option value="">↓ Cargar desde cotización...</option>
                {paymentPlans.map(p => (
                  <option key={p.id} value={p.id}>
                    Cotización {new Date(p.createdAt).toLocaleDateString('es-CL')}
                  </option>
                ))}
              </select>
            )}

            {/* ── BLOQUE 1: Tabla de Unidades ── */}
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-[9px] font-black text-gray-400 uppercase tracking-widest">Unidad</th>
                    <th className="px-2 py-2 text-right text-[9px] font-black text-gray-400 uppercase tracking-widest">P. Original</th>
                    <th className="px-2 py-2 text-center text-[9px] font-black text-gray-400 uppercase tracking-widest">Ajuste</th>
                    {/* P. Final es editable: escribir un precio recalcula el descuento y
                        viceversa. Con bono activo, lo que se tipea es el precio que paga el
                        comprador y la celda muestra el publicado (inflado). */}
                    <th className="px-2 py-2 text-right text-[9px] font-black text-gray-400 uppercase tracking-widest">P. Final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(() => {
                    const orig = unit.precioListaOriginal ?? formData.precioLista;
                    const dctoPct = descuentoEfectivoDepto;
                    const final = hasBono ? bonoCalcDepto.valorTotal : bonoCalcDepto.precioConDescuento;
                    const mode = unitDiscountModes['depto'] ?? '%';
                    const hasDiscount = dctoPct > 0;
                    // Monto del descuento sobre el precio que paga el comprador. Antes se
                    // calculaba contra `final`, que con bono va inflado: el modo UF mostraba
                    // un ajuste que no era el descuento y no cuadraba con el % de al lado.
                    const ufAjuste = r2fmt(orig - bonoCalcDepto.precioConDescuento);
                    return (
                      <tr className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-3 py-2 font-bold text-gray-700 text-[11px]">
                          {unit.type === 'Departamento' ? `Depto ${formData.numero}` : `${unit.type} ${formData.numero}`}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-400 text-[11px]">{formatValueStandard(orig)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              onClick={() => setUnitDiscountModes(prev => ({ ...prev, depto: mode === '%' ? 'UF' : '%' }))}
                              disabled={!canEditFinanciero || !hasClient}
                              className="text-[9px] font-bold text-gray-400 hover:text-blue-600 border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40 shrink-0"
                            >{mode}</button>
                            <NumberCell
                              step={mode === '%' ? '0.01' : '1'}
                              value={mode === '%' ? dctoPct : ufAjuste}
                              onCommit={n => {
                                setDiscountInput(mode === '%' ? String(n) : String(descuentoDesdePrecio(orig, orig - n)));
                                setDiscountError('');
                              }}
                              disabled={!canEditFinanciero || discountPending || !hasClient}
                              className="w-16 px-1.5 py-1 bg-white border border-gray-200 rounded text-xs font-mono text-right outline-none focus:ring-1 focus:ring-amber-200 disabled:opacity-50"
                            />
                            {ajusteBadge(dctoPct, ufAjuste, mode)}
                          </div>
                          {discountError && <p className="text-[9px] text-red-600 font-bold mt-0.5">{discountError}</p>}
                          {discountPending && <p className="text-[9px] text-amber-600 font-bold mt-0.5">Pend. autorización</p>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <NumberCell
                            value={final}
                            title={hasBono ? 'Escribe el precio que paga el comprador; el bono lo infla al precio publicado' : 'Escribe el precio de cierre y el descuento se calcula solo'}
                            onCommit={n => {
                              setDiscountInput(String(descuentoDesdePrecio(orig, n)));
                              setDiscountError('');
                            }}
                            disabled={!canEditFinanciero || discountPending || !hasClient}
                            className={`w-24 px-1.5 py-1 bg-white border border-gray-200 rounded text-[11px] font-mono font-bold text-right outline-none focus:ring-1 focus:ring-blue-200 disabled:opacity-50 disabled:bg-transparent disabled:border-transparent ${hasDiscount ? 'text-red-600' : 'text-gray-800'}`}
                          />
                          {hasBono && (
                            <p className="text-[9px] text-gray-400 font-medium mt-0.5">paga {formatValueStandard(bonoCalcDepto.precioConDescuento)}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })()}
                  {/* Bodegas y estacionamientos: misma fila que el depto (ajuste %/UF +
                      P. Final editable). Antes eran dos bloques JSX idénticos copiados; se
                      unificaron para que la edición cruzada precio ↔ descuento viva en un
                      solo lugar. */}
                  {[
                    ...linkedAssets.storages.map(u => ({ u, icono: <Package className="w-3 h-3 text-gray-300 shrink-0" />, etiqueta: `Bodega ${u.numero}` })),
                    ...linkedAssets.parkings.map(u => ({ u, icono: <Car className="w-3 h-3 text-gray-300 shrink-0" />, etiqueta: `Estac. ${u.numero}` })),
                  ].map(({ u, icono, etiqueta }) => {
                    const orig = u.precioListaOriginal ?? u.precioLista;
                    const dctoPct = linkedDiscounts[u.id] ?? u.descuentoPct ?? 0;
                    const bono = linkedBono[u.id] ?? false;
                    const calc = calcResumenUnidad({ precioListaOriginal: orig, dctoPct, bonoPct, aplicaBono: bono });
                    const final = bono ? calc.valorTotal : calc.precioConDescuento;
                    const mode = unitDiscountModes[u.id] ?? '%';
                    const hasDiscount = dctoPct > 0;
                    // Contra precioConDescuento, no contra `final`: con bono, `final` va inflado.
                    const ufAjuste = r2fmt(orig - calc.precioConDescuento);
                    const aplicarPct = (pct: number) => {
                      setLinkedDiscountInputs(prev => ({ ...prev, [u.id]: String(pct) }));
                      setLinkedDiscounts(prev => ({ ...prev, [u.id]: pct }));
                    };
                    return (
                      <tr key={u.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-3 py-2 text-gray-600 text-[11px]">
                          <span className="flex items-center gap-1">{icono} {etiqueta}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-400 text-[11px]">{formatValueStandard(orig)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              onClick={() => setUnitDiscountModes(prev => ({ ...prev, [u.id]: mode === '%' ? 'UF' : '%' }))}
                              disabled={!canEditFinanciero || !hasClient}
                              className="text-[9px] font-bold text-gray-400 hover:text-blue-600 border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40 shrink-0"
                            >{mode}</button>
                            <NumberCell
                              step={mode === '%' ? '0.01' : '1'}
                              value={mode === '%' ? dctoPct : ufAjuste}
                              onCommit={n => aplicarPct(mode === '%' ? n : descuentoDesdePrecio(orig, orig - n))}
                              disabled={!canEditFinanciero || !hasClient}
                              className="w-16 px-1.5 py-1 bg-white border border-gray-200 rounded text-xs font-mono text-right outline-none focus:ring-1 focus:ring-amber-200 disabled:opacity-50"
                            />
                            {ajusteBadge(dctoPct, ufAjuste, mode)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <NumberCell
                            value={final}
                            title={bono ? 'Escribe el precio que paga el comprador; el bono lo infla al precio publicado' : 'Escribe el precio de cierre y el descuento se calcula solo'}
                            onCommit={n => aplicarPct(descuentoDesdePrecio(orig, n))}
                            disabled={!canEditFinanciero || !hasClient}
                            className={`w-24 px-1.5 py-1 bg-white border border-gray-200 rounded text-[11px] font-mono font-bold text-right outline-none focus:ring-1 focus:ring-blue-200 disabled:opacity-50 disabled:bg-transparent disabled:border-transparent ${hasDiscount ? 'text-red-600' : 'text-gray-800'}`}
                          />
                          {bono && (
                            <p className="text-[9px] text-gray-400 font-medium mt-0.5">paga {formatValueStandard(calc.precioConDescuento)}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-blue-50/40 border-t-2 border-blue-100">
                    <td colSpan={3} className="px-3 py-2 text-[9px] font-black text-blue-700 uppercase tracking-widest">Total Precio de Venta</td>
                    <td className="px-2 py-2 text-right font-mono font-black text-blue-700 text-sm">{formatValueStandard(totalPrecioVentaNuevo)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── BLOQUE 2: Bono Pie por Unidad ── */}
            <div className="space-y-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-blue-500" /> Bono Pie
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* FIX 1: N° Cuotas a la IZQUIERDA del % Bono Pie — editable para todos los roles */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400 uppercase">N° Cuotas</span>
                    <input
                      type="number" min={1} max={120} step={1}
                      value={cantidadCuotasPie}
                      onChange={e => {
                        const n = Math.min(120, Math.max(1, parseInt(e.target.value) || 1));
                        setCantidadCuotasPie(n);
                        setFormData(prev => ({ ...prev, pieCuotas: n }));
                      }}
                      disabled={!canEditFinanciero}
                      className="w-16 px-1.5 py-1 bg-white border border-gray-200 rounded text-xs font-mono text-right outline-none focus:ring-1 focus:ring-blue-200 disabled:opacity-60"
                    />
                  </div>
                  {canEditBono && canEditFinanciero ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-400 uppercase">% Bono</span>
                      <input
                        type="number" min="0" max="50" step="0.5"
                        value={bonoPct}
                        onChange={e => setBonoPct(Number(e.target.value))}
                        className="w-14 px-1.5 py-1 bg-white border border-gray-200 rounded text-xs font-mono text-right outline-none focus:ring-1 focus:ring-blue-200"
                      />
                      <span className="text-[10px] text-gray-400">%</span>
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{bonoPct}%</span>
                  )}
                  {canEditFinanciero && hasClient && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setHasBono(true);
                          setFormData(prev => ({ ...prev, aplicaBonoPie: true }));
                          const allTrue: Record<string, boolean> = {};
                          [...linkedAssets.storages, ...linkedAssets.parkings].forEach(u => { allTrue[u.id] = true; });
                          setLinkedBono(allTrue);
                        }}
                        className="text-[9px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                      >Todos</button>
                      <button
                        onClick={() => {
                          setHasBono(false);
                          setFormData(prev => ({ ...prev, aplicaBonoPie: false }));
                          const allFalse: Record<string, boolean> = {};
                          [...linkedAssets.storages, ...linkedAssets.parkings].forEach(u => { allFalse[u.id] = false; });
                          setLinkedBono(allFalse);
                        }}
                        className="text-[9px] font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                      >Ninguno</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={`flex items-center justify-between gap-2 ${canEditFinanciero && hasClient ? 'cursor-pointer' : ''}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={hasBono}
                      disabled={!canEditFinanciero || currentUser.role === 'Ventas' || !hasClient}
                      onChange={e => { setHasBono(e.target.checked); setFormData(prev => ({ ...prev, aplicaBonoPie: e.target.checked })); }}
                      className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-50 shrink-0"
                    />
                    <span className="text-xs text-gray-700 font-medium">
                      {unit.type === 'Departamento' ? `Depto ${formData.numero}` : `${unit.type} ${formData.numero}`}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-gray-500 shrink-0">
                    {formatValueStandard(hasBono ? bonoCalcDepto.valorTotal : bonoCalcDepto.precioConDescuento)} UF
                  </span>
                </label>
                {linkedAssets.storages.map(b => {
                  const bono = linkedBono[b.id] ?? false;
                  const calcB = calcResumenUnidad({ precioListaOriginal: b.precioListaOriginal ?? b.precioLista, dctoPct: linkedDiscounts[b.id] ?? b.descuentoPct ?? 0, bonoPct, aplicaBono: bono });
                  return (
                    <label key={b.id} className={`flex items-center justify-between gap-2 ${canEditFinanciero && hasClient ? 'cursor-pointer' : ''}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={bono}
                          disabled={!canEditFinanciero || !hasClient}
                          onChange={e => setLinkedBono(prev => ({ ...prev, [b.id]: e.target.checked }))}
                          className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-50 shrink-0"
                        />
                        <span className="text-xs text-gray-600 font-medium flex items-center gap-1"><Package className="w-3 h-3 text-gray-300 shrink-0" /> Bodega {b.numero}</span>
                      </div>
                      <span className="text-xs font-mono text-gray-500 shrink-0">{formatValueStandard(bono ? calcB.valorTotal : calcB.precioConDescuento)} UF</span>
                    </label>
                  );
                })}
                {linkedAssets.parkings.map(p => {
                  const bono = linkedBono[p.id] ?? false;
                  const calcP = calcResumenUnidad({ precioListaOriginal: p.precioListaOriginal ?? p.precioLista, dctoPct: linkedDiscounts[p.id] ?? p.descuentoPct ?? 0, bonoPct, aplicaBono: bono });
                  return (
                    <label key={p.id} className={`flex items-center justify-between gap-2 ${canEditFinanciero && hasClient ? 'cursor-pointer' : ''}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={bono}
                          disabled={!canEditFinanciero || !hasClient}
                          onChange={e => setLinkedBono(prev => ({ ...prev, [p.id]: e.target.checked }))}
                          className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-50 shrink-0"
                        />
                        <span className="text-xs text-gray-600 font-medium flex items-center gap-1"><Car className="w-3 h-3 text-gray-300 shrink-0" /> Estac. {p.numero}</span>
                      </div>
                      <span className="text-xs font-mono text-gray-500 shrink-0">{formatValueStandard(bono ? calcP.valorTotal : calcP.precioConDescuento)} UF</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* ── BLOQUE 3: Distribución del Pago ── (FIX 1: oculto en Escriturado) */}
            {hasClient && formData.estado !== 'Escriturado' && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setIncludePaymentPlan(v => !v)}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${includePaymentPlan ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                    {includePaymentPlan && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="font-bold text-sm text-gray-700">Incluir Forma de Pago</span>
                </label>

                {includePaymentPlan && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Distribución del Pago</span>
                      {Math.abs(totalPctRaw - 100) < 0.05
                        ? <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">100% ✓</span>
                        : <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Suma ≠ 100% ⚠️</span>
                      }
                    </div>
                    <div className="p-4 space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <ComponenteToggle
                          activa={fpPromesaOn}
                          etiqueta="Promesa"
                          disabled={!canEditFinanciero}
                          onToggle={() => { reajustarPctReales({ promesaOn: !fpPromesaOn }); setPromesaError(null); }}
                        />
                        <span className={`w-28 shrink-0 ${fpPromesaOn ? 'text-gray-600' : 'text-gray-400 line-through'}`}>Promesa</span>
                        <PercentInput value={fpPromesaPct}
                          onChange={handlePromesaChange}
                          disabled={!canEditFinanciero || !fpPromesaOn}
                          className={`w-14 p-1.5 border rounded text-xs font-mono text-right outline-none disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed ${promesaError ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                        <span className="text-gray-400">%</span>
                        <span className={`ml-auto font-mono font-bold shrink-0 ${fpPromesaOn ? 'text-gray-700' : 'text-gray-400'}`}>{formatValueStandard(ufPromesaDisplay)} UF</span>
                      </div>
                      {promesaError && fpPromesaOn && (
                        <div><span className="text-[11px] text-red-600 font-medium">{promesaError}</span></div>
                      )}
                      {ufHoy && ufPromesaDisplay > 0 && (
                        <div className="text-right text-[10px] text-gray-400 font-mono -mt-1">
                          {(ufPromesaDisplay * ufHoy).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <ComponenteToggle
                          activa={fpCuotasOn}
                          etiqueta="Cuotas"
                          disabled={!canEditFinanciero}
                          onToggle={() => reajustarPctReales({ cuotasOn: !fpCuotasOn })}
                        />
                        <span className={`w-28 shrink-0 ${fpCuotasOn ? 'text-gray-600' : 'text-gray-400 line-through'}`}>Cuotas ({cantidadCuotasPie}x)</span>
                        <PercentInput value={fpCuotasPct}
                          onChange={n => reajustarPctReales({ cuotas: n }, 'cuotas')}
                          disabled={!canEditFinanciero || !fpCuotasOn}
                          className="w-14 p-1.5 border border-gray-200 rounded text-xs font-mono text-right outline-none disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed" />
                        <span className="text-gray-400">%</span>
                        {/* Badge dorado SOLO con bono pie: ahí el campo es un peso y el % real difiere.
                            Sin bono el campo YA es el % real y el badge no aportaría nada. */}
                        {aplicaCompraSegura && fpCuotasOn && <span className="text-sm font-mono text-amber-800 bg-amber-200 border border-amber-400 px-2 py-0.5 rounded whitespace-nowrap">→ {formatPct(cuotasPctDisplay)}%</span>}
                        <span className={`ml-auto font-mono font-bold shrink-0 ${fpCuotasOn ? 'text-gray-700' : 'text-gray-400'}`}>{formatValueStandard(ufCuotasDisplay)} UF</span>
                      </div>
                      {fpCuotasOn && cantidadCuotasPie > 0 && ufCuotaUnitDisplay > 0 && (
                        <div className="text-right text-[10px] text-gray-400 -mt-1">
                          {cantidadCuotasPie} cuotas de {formatValueStandard(ufCuotaUnitDisplay)} UF c/u
                          {ufHoy ? ` · ${(ufCuotaUnitDisplay * ufHoy).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })} c/u` : ''}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <ComponenteToggle
                          activa={fpEscrituraOn}
                          etiqueta="Escritura"
                          disabled={!canEditFinanciero}
                          onToggle={() => reajustarPctReales({ escrituraOn: !fpEscrituraOn })}
                        />
                        <span className={`w-28 shrink-0 ${fpEscrituraOn ? 'text-gray-600' : 'text-gray-400 line-through'}`}>Escritura</span>
                        <PercentInput value={fpEscrituraPct}
                          onChange={n => reajustarPctReales({ escritura: n }, 'escritura')}
                          disabled={!canEditFinanciero || !fpEscrituraOn}
                          className="w-14 p-1.5 border border-gray-200 rounded text-xs font-mono text-right outline-none disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed" />
                        <span className="text-gray-400">%</span>
                        {/* Badge dorado SOLO con bono pie (ver Cuotas). */}
                        {aplicaCompraSegura && fpEscrituraOn && <span className="text-sm font-mono text-amber-800 bg-amber-200 border border-amber-400 px-2 py-0.5 rounded whitespace-nowrap">→ {formatPct(escrituraPctDisplay)}%</span>}
                        <span className={`ml-auto font-mono font-bold shrink-0 ${fpEscrituraOn ? 'text-gray-700' : 'text-gray-400'}`}>{formatValueStandard(ufEscrituraDisplay)} UF</span>
                      </div>
                      {!fpCuotasOn && !fpEscrituraOn && formaDisplay.error && (
                        <p className="text-xs text-red-600 font-bold flex items-center gap-1 pt-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> Cuotas y Escritura están las dos desactivadas: no queda dónde repartir el saldo. Activa al menos una.
                        </p>
                      )}
                      {aplicaCompraSegura && (
                        <div className="flex items-center gap-2">
                          <span className="w-28 shrink-0 text-gray-600 ml-6">Compra Segura</span>
                          <div className="w-14 p-1.5 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-right text-gray-500">
                            {formatPct(compraSeguaPctDisplay)}
                          </div>
                          <span className="text-gray-400">%</span>
                          <span className="ml-auto font-mono font-bold text-gray-700 shrink-0">{formatValueStandard(ufCompraSeguraDisplay)} UF</span>
                        </div>
                      )}
                      <div className="border-t border-gray-100 my-1" />
                      <div className="flex items-center gap-2">
                        <span className={`w-28 shrink-0 ml-6 font-bold ${fpCreditoPct <= 0 ? 'text-gray-500' : 'text-blue-700'}`}>Crédito Banco</span>
                        <PercentInput
                          value={fpCreditoPct}
                          onChange={n => reajustarPctReales({ credito: n })}
                          disabled={!canEditFinanciero}
                          max={aplicaCompraSegura ? r2pct(100 - compraSeguraPctOnTotal() - 0.01) : 99.99}
                          className={`w-14 p-1.5 border rounded text-xs font-mono text-right font-bold outline-none disabled:opacity-60 ${fpCreditoPct <= 0 ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-blue-50 border-blue-200 text-blue-700'}`}
                        />
                        <span className="text-gray-400">%</span>
                        <span className={`ml-auto font-mono font-bold shrink-0 ${fpCreditoPct <= 0 ? 'text-gray-500' : 'text-blue-700'}`}>{formatValueStandard(ufCreditoDisplay)} UF</span>
                      </div>
                      {ufHoy && ufCreditoDisplay > 0 && (
                        <div className="text-right text-[10px] text-blue-400 font-mono -mt-1">
                          {(ufCreditoDisplay * ufHoy).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })}
                        </div>
                      )}
                      <div className="border-t border-gray-200 mt-1 pt-1.5">
                        <div className="flex items-center gap-2 font-bold">
                          <span className="w-28 shrink-0 ml-6 text-gray-800">TOTAL</span>
                          <div className="w-14 p-1.5 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-right text-gray-700">{formatPct(totalPctRaw)}</div>
                          <span className="text-gray-400">%</span>
                          <span className="ml-auto font-mono font-bold text-gray-900 shrink-0">{formatValueStandard(totalFormaDisplay)} UF</span>
                        </div>
                      </div>
                      {Math.abs(totalPctRaw - 100) >= 0.05 && (
                        <p className="text-xs text-red-600 font-bold flex items-center gap-1 pt-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> La suma no es 100%. Ajusta los porcentajes.
                        </p>
                      )}
                      {Math.round((promesaPctDisplay + cuotasPctDisplay + escrituraPctDisplay + compraSeguaPctDisplay + creditoPctDisplay) * 10) !== 1000 && Math.abs(totalPctRaw - 100) < 0.05 && (
                        <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> Los porcentajes no suman 100%
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {canEditFinanciero && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
                    <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <label htmlFor="dia-pago" className="text-[10px] font-black text-gray-500 uppercase tracking-widest shrink-0">
                      Día de pago
                    </label>
                    <input
                      id="dia-pago"
                      type="number" min={1} max={31} step={1}
                      value={diaPago}
                      onChange={e => setDiaPago(normalizarDiaPago(e.target.value))}
                      disabled={isReadOnly}
                      className="w-14 px-1.5 py-1 bg-white border border-gray-200 rounded text-xs font-mono text-right outline-none focus:ring-1 focus:ring-blue-200 disabled:opacity-50"
                    />
                    <span className="text-[9px] text-gray-400 font-medium leading-tight">
                      Todas las cuotas vencen ese día. Los meses más cortos toman su último
                      día, y si cae fin de semana se adelanta al viernes.
                    </span>
                  </div>
                )}

                {canEditFinanciero && (
                  <button
                    onClick={includePaymentPlan ? generatePaymentSchedule : undefined}
                    disabled={!includePaymentPlan || Math.abs(totalPctRaw - 100) >= 0.05}
                    className="w-full py-2.5 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Wallet className="w-4 h-4" /> Generar Cronograma de Pagos
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
