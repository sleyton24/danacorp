import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RealEstateUnit, Client, User, Project, ClientDocument, DiscountConfig, ProjectConfig } from '../types';
import { calcValorTotal, calcBonificacion } from '../utils/pricingUtils';
import {
  Search, Trash2, CheckCircle, FileText, Calendar,
  Building, Car, Package, Calculator, Save, AlertTriangle,
  X, User as UserIcon, Download, Mail, Check, RefreshCw, Landmark, Globe,
  MapPin, Briefcase, Lock, UserCheck, BookOpen, RotateCcw,
  AlertCircle, Loader2,
} from 'lucide-react';
// jsPDF is loaded dynamically inside generatePDFBlob() to enable lazy chunking

// ── Types ────────────────────────────────────────────────────────────────────

interface QuoteItem extends RealEstateUnit {
  isAutoLoaded?: boolean;
  parentDeptId?: string;
}

interface AdjEntry {
  type: '%' | 'UF';
  rawValue: string;
  applied: boolean;
}

interface MortgageInputs {
  tasaAnual: number;
  // pie derivado internamente: 100 - finPct
  // precioTotal eliminado: deriva de bonoPieBreakdown
}

interface DraftSummary {
  id: string;
  clienteNombre: string;
  clienteRut: string;
  updated_at: string;
  estado?: string;
  fecha_generada?: string;
  generada_por?: string;
  data: Record<string, unknown>;
}

interface DiscountRequest {
  id: string;
  estado: 'Pendiente' | 'AprobadoJefe' | 'Aprobado' | 'Rechazado' | 'Cancelado';
}

interface QuoterProps {
  units: RealEstateUnit[];
  clients: Client[];
  projects: Project[];
  currentProjectId: string | null;
  onSaveProspect: (client: Client, quoteDetails: string, document?: ClientDocument) => void;
  currentUser: User;
  onDraftStateChange?: (draftId: string | null) => void;
  openDraftId?: string | null;
  onDraftOpened?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatUF = (val: number) =>
  val.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const formatCLP = (val: number) =>
  val.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });

const generateId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).substring(2);

const DEFAULT_DISCOUNT_CONFIG: DiscountConfig = {
  jefeMaxPct: 3,
  supervisorMaxPct: 7,
  bonoPiePct: 10,
  vigenciaCotizacionDias: 7,
};

// ── Dividend helper ───────────────────────────────────────────────────────────

function calcDividendo(principal: number, tasaAnual: number, years: number): number {
  if (principal <= 0 || tasaAnual <= 0) return 0;
  const r = tasaAnual / 100 / 12;
  const n = years * 12;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// ── Price adjustment helpers (Paso 1) ────────────────────────────────────────
// Input is always a POSITIVE number; system applies it as a discount.

function getMaxDescuentoUF(base: number, supervisorMaxPct: number): number {
  return Math.round((base * supervisorMaxPct / 100) * 100) / 100;
}

// Pure helper: rawValue > 0 → discount
function getAdjustedPrice(base: number, rawValue: number, type: '%' | 'UF'): number {
  if (rawValue <= 0) return base;
  if (type === '%') return Math.round(base * (1 - rawValue / 100) * 100) / 100;
  return Math.round((base - rawValue) * 100) / 100;
}

function isDiscountEntry(rawValue: number): boolean {
  return rawValue > 0;
}

// Wrapper: get a unit's final price using its AdjEntry in the draft map
function unitFinalPrice(unit: QuoteItem, adjs: Record<string, AdjEntry>): number {
  const adj = adjs[unit.id];
  if (!adj || !adj.applied) return unit.precioLista;
  const v = parseFloat(adj.rawValue) || 0;
  return getAdjustedPrice(unit.precioLista, v, adj.type);
}

function unitDiscountPct(unit: QuoteItem, adjs: Record<string, AdjEntry>): number {
  const original = unit.precioLista;
  const final = unitFinalPrice(unit, adjs);
  if (original <= 0) return 0;
  return ((original - final) / original) * 100;
}

// ── Bono pie per-unit calculation (Paso 6) ───────────────────────────────────

interface UnitBonoPieCalc {
  base: number;
  precioInflado: number;
  bonificacion: number;
  pieUnidad: number;
  montoAPagar: number;
  porFinanciar: number;
  hasBono: boolean;
}

function calcUnitBonoPie(
  base: number,
  hasBono: boolean,
  bonoPct: number,
  piePct: number,
  finPct: number,
): UnitBonoPieCalc {
  const r = (v: number) => Math.round(v * 100) / 100;
  if (hasBono) {
    const valorTotal   = calcValorTotal(base, bonoPct);
    const bonificacion = calcBonificacion(valorTotal, bonoPct);
    const pieUnidad    = r(valorTotal * piePct / 100);
    const montoAPagar  = r(pieUnidad - bonificacion);
    const porFinanciar = r(valorTotal * finPct / 100);
    return { base, precioInflado: valorTotal, bonificacion, pieUnidad, montoAPagar, porFinanciar, hasBono: true };
  }
  const precioInflado = base;
  const bonificacion  = 0;
  const pieUnidad     = r(base * piePct / 100);
  const montoAPagar   = pieUnidad;
  const porFinanciar  = r(base * finPct / 100);
  return { base, precioInflado, bonificacion, pieUnidad, montoAPagar, porFinanciar, hasBono: false };
}

// ── Component ────────────────────────────────────────────────────────────────

export const Quoter: React.FC<QuoterProps> = ({
  units,
  clients,
  projects,
  currentProjectId,
  onSaveProspect,
  currentUser,
  onDraftStateChange,
  openDraftId,
  onDraftOpened,
}) => {
  // ── Step & Flow ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isFinalized, setIsFinalized] = useState(false);

  // ── Client ───────────────────────────────────────────────────────────────

  const emptyClient: Partial<Client> = {
    tipoPersona: 'Natural', nombre: '', rut: '', email: '', telefono: '',
    nacionalidad: 'Chilena', profesion: '', sueldoRange: '', fechaNacimiento: '',
    direccion: '', ciudad: '', comuna: '', region: '', estado: 'Prospecto',
    representanteNacionalidad: 'Chilena',
  };
  const [selectedClient, setSelectedClient] = useState<Partial<Client>>(emptyClient);

  // ── Units & Accessories ──────────────────────────────────────────────────
  const [selectedUnits, setSelectedUnits] = useState<QuoteItem[]>([]);
  const [unitFilter, setUnitFilter] = useState('');
  const [detachedAccessories, setDetachedAccessories] = useState<string[]>([]);

  // ── Adjustments (C3) ─────────────────────────────────────────────────────
  const [adjustDrafts, setAdjustDrafts] = useState<Record<string, AdjEntry>>({});
  const [discountRequests, setDiscountRequests] = useState<Record<string, DiscountRequest>>({});

  // ── Payment / Mortgage ───────────────────────────────────────────────────
  const [bonoPieUnits, setBonoPieUnits] = useState<Set<string>>(new Set());

  // Dos checkboxes independientes (Cambio 2)
  const [includePaymentPlan, setIncludePaymentPlan] = useState(false);
  const [includeMortgageSimulation, setIncludeMortgageSimulation] = useState(false);

  const [mortgageInputs, setMortgageInputs] = useState<MortgageInputs>({ tasaAnual: 4.5 });
  const [reservaCLP, setReservaCLP] = useState(0); // poblado desde projectConfig
  // pieCuotasDropdown/Manual: mantenidos para compat con borradores antiguos, sin UI
  const [pieCuotasDropdown, setPieCuotasDropdown] = useState<6 | 12 | 18 | 24 | 36 | 'Otro'>(12);
  const [pieCuotasManual, setPieCuotasManual] = useState(12);
  const [bonoPct, setBonoPct] = useState(10);
  const [mortgageFinPct, setMortgageFinPct] = useState(80); // % banco cuando Forma de Pago no está activa
  const includeBonoPie = bonoPieUnits.size > 0;

  // ── SSilva: 4 componentes forma de pago ────────────────────────────────────
  const [promesaPct, setPromesaPct] = useState(3);
  const [cuotasPct, setCuotasPct] = useState(7);
  const [escrituraPct, setEscrituraPct] = useState(10);
  const [nCuotasNew, setNCuotasNew] = useState(36);

  // ── Inline search en "Nuevo Prospecto" ───────────────────────────────────
  const [inlineTerm, setInlineTerm] = useState('');
  const [showInlineDropdown, setShowInlineDropdown] = useState(false);
  const inlineSearchRef = useRef<HTMLDivElement>(null);

  // ── UF (BUG 2) ───────────────────────────────────────────────────────────
  const [ufHoy, setUfHoy] = useState<number | null>(null);
  const [ufFecha, setUfFecha] = useState('');

  // ── Drafts (C1) ──────────────────────────────────────────────────────────
  const [draftId, setDraftId] = useState<string | null>(null);
  const [pdfSavedPath, setPdfSavedPath] = useState<string | null>(null);
  // Punto 8: sync draftId → App.tsx activeDraftId on every change
  useEffect(() => { onDraftStateChange?.(draftId); }, [draftId, onDraftStateChange]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [draftSearchTerm, setDraftSearchTerm] = useState('');
  const [draftSortOrder, setDraftSortOrder] = useState<'fecha' | 'cotizante'>('fecha');

  // ── Quote ID ─────────────────────────────────────────────────────────────
  const quoteIdRef = useRef(generateId().substring(0, 9).toUpperCase());

  // ── Project Config (C6) ──────────────────────────────────────────────────
  const [projectConfig, setProjectConfig] = useState<Partial<ProjectConfig>>({});

  // ── Email ────────────────────────────────────────────────────────────────
  const [isEmailSending, setIsEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const currentProject = projects.find(p => p.id === currentProjectId);
  const nCuotas = pieCuotasDropdown === 'Otro' ? pieCuotasManual : pieCuotasDropdown;
  const effectiveDiscountConfig: DiscountConfig = {
    ...DEFAULT_DISCOUNT_CONFIG,
    ...(projectConfig.discountConfig || {}),
    bonoPiePct: projectConfig.bonoPiePct ?? DEFAULT_DISCOUNT_CONFIG.bonoPiePct,
  };

  // ── BUG 2: Fetch UF (include token if available) ─────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('dw_token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    fetch('/api/uf-hoy', { headers })
      .then(r => r.ok ? r.json() : null)
      .then((d: { uf: number; fecha: string } | null) => {
        if (d) { setUfHoy(d.uf); setUfFecha(d.fecha.split('T')[0]); }
      })
      .catch(() => {});
  }, []);

  // ── C6: Load project config ──────────────────────────────────────────────
  useEffect(() => {
    if (!currentProjectId) return;
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    fetch(`/api/projects/${currentProjectId}/config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((d: ProjectConfig | null) => {
        if (d) {
          setProjectConfig(d);
          if (d.bonoPiePct != null) setBonoPct(d.bonoPiePct);
          if (d.reservaCLP != null) setReservaCLP(d.reservaCLP);
          if (d.cantidadCuotasPie != null) setNCuotasNew(d.cantidadCuotasPie);
        }
      })
      .catch(() => {});
  }, [currentProjectId]);

  // ── Total cotizado (precio post-descuento de todas las unidades) ─────────
  const totalFinal = useMemo(
    () => selectedUnits.reduce((sum, u) => sum + unitFinalPrice(u, adjustDrafts), 0),
    [selectedUnits, adjustDrafts],
  );

  // ── finPct deriva de creditoPct (para bono pie) — declarar ANTES de useMemos que lo usan ──
  const creditoPctEarly = Math.max(0, 100 - promesaPct - cuotasPct - escrituraPct);
  const finPct = creditoPctEarly;
  const piePct = 100 - finPct;

  // ── Bono pie breakdown por unidad (Paso 6) ───────────────────────────────
  const bonoPieBreakdown = useMemo(() => {
    const effectivePiePct = 100 - finPct; // piePct derivado dentro del memo
    const perUnit = selectedUnits.map(u => ({
      unit: u,
      calc: calcUnitBonoPie(
        unitFinalPrice(u, adjustDrafts),
        bonoPieUnits.has(u.id),
        bonoPct,
        effectivePiePct,
        finPct,
      ),
    }));
    const conBono = perUnit.filter(x => x.calc.hasBono);
    const sinBono = perUnit.filter(x => !x.calc.hasBono);
    const totalPrecioInflado  = perUnit.reduce((s, x) => s + x.calc.precioInflado, 0);
    const totalPie            = perUnit.reduce((s, x) => s + x.calc.pieUnidad, 0);
    const totalBonificacion   = perUnit.reduce((s, x) => s + x.calc.bonificacion, 0);
    const totalMontoAPagar    = perUnit.reduce((s, x) => s + x.calc.montoAPagar, 0);
    const totalPorFinanciar   = perUnit.reduce((s, x) => s + x.calc.porFinanciar, 0);
    return { perUnit, conBono, sinBono, totalPrecioInflado, totalPie, totalBonificacion, totalMontoAPagar, totalPorFinanciar };
  }, [selectedUnits, adjustDrafts, bonoPieUnits, bonoPct, finPct]);

  // ── SSilva: precio breakdown ──────────────────────────────────────────────
  // creditoPct / finPct / piePct ya declarados arriba (antes de bonoPieBreakdown)
  const creditoPct = creditoPctEarly;

  const totalPrecioListaSinDescuento = useMemo(() => {
    const effectivePiePct = 100 - finPct;
    return selectedUnits.reduce((sum, u) => {
      const calc = calcUnitBonoPie(u.precioLista, bonoPieUnits.has(u.id), bonoPct, effectivePiePct, finPct);
      return sum + calc.precioInflado;
    }, 0);
  }, [selectedUnits, bonoPieUnits, bonoPct, finPct]);

  // PRECIO DE LISTA = suma de precios publicados (inflados donde hay bono)
  const totalPrecioVentaSSilva = bonoPieBreakdown.totalPrecioInflado;  // alias para PRECIO DE LISTA
  const precioListaTotal       = totalPrecioVentaSSilva;               // más explícito en contexto

  // PRECIO DE VENTA = PRECIO DE LISTA - bonificación total = totalFinal (valores económicos)
  // Equivale a: totalFinal = sum(unitFinalPrice) = precioListaTotal - bonoPieBreakdown.totalBonificacion
  const precioVentaFinal = totalFinal;  // base para Forma de Pago y Simulador

  // Forma de Pago usa PRECIO DE VENTA como base (spec SSilva)
  const promesaUF   = Math.round(precioVentaFinal * promesaPct   / 100 * 100) / 100;
  const cuotasUF    = Math.round(precioVentaFinal * cuotasPct    / 100 * 100) / 100;
  const escrituraUF = Math.round(precioVentaFinal * escrituraPct / 100 * 100) / 100;
  const creditoUF   = Math.round(precioVentaFinal * creditoPct   / 100 * 100) / 100;
  const cuotaIndividualUF = nCuotasNew > 0 ? Math.round(cuotasUF / nCuotasNew * 100) / 100 : 0;

  // ── Close inline dropdown on outside click ───────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inlineSearchRef.current && !inlineSearchRef.current.contains(e.target as Node))
        setShowInlineDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Inline search results (filtrando por rol igual que el modo búsqueda) ─
  const inlineSearchResults = useMemo(() => {
    const term = inlineTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    return clients.filter(c => {
      const match = c.nombre.toLowerCase().includes(term) || c.rut.toLowerCase().includes(term);
      if (!match) return false;
      if (currentUser.role === 'Ventas')
        return c.estado !== 'Activo' || c.ejecutivoId === currentUser.id;
      return true;
    }).slice(0, 8);
  }, [inlineTerm, clients, currentUser]);

  const handleSelectInlineClient = (c: Client) => {
    setSelectedClient(c);
    setInlineTerm('');
    setShowInlineDropdown(false);
  };

  // ── C1: Auto-save draft (BUG 3 fix: .trim()) ────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildPayload = useCallback(() => ({
    id: draftId || undefined,
    projectId: currentProjectId,
    clienteRut: selectedClient.rut || '',
    clienteNombre: selectedClient.nombre || '',
    clienteId: selectedClient.id || undefined,
    selectedUnits,
    adjustments: [
      { key: 'adjustDrafts', value: adjustDrafts },
      { key: 'detachedAccessories', value: detachedAccessories },
      { key: 'selectedClient', value: selectedClient },
      { key: 'quoteId', value: quoteIdRef.current },
      {
        key: 'paymentConfig', value: {
          reservaCLP, pieCuotasDropdown, pieCuotasManual,
          bonoPieUnits: Array.from(bonoPieUnits),
          bonoPct, mortgageFinPct,
          promesaPct, cuotasPct, escrituraPct, nCuotasNew,
          includePaymentPlan, includeMortgageSimulation,
        },
      },
    ],
    mortgageInputs,
    showMortgage: includePaymentPlan || includeMortgageSimulation,
  }), [
    draftId, currentProjectId, selectedClient, selectedUnits, adjustDrafts,
    detachedAccessories, mortgageInputs, includePaymentPlan, includeMortgageSimulation,
    reservaCLP, pieCuotasDropdown, pieCuotasManual,
    bonoPieUnits, bonoPct, mortgageFinPct,
    promesaPct, cuotasPct, escrituraPct, nCuotasNew,
  ]);

  const saveImmediately = useCallback(async (): Promise<void> => {
    const token = localStorage.getItem('dw_token');
    if (!token || !currentProjectId) return;
    if (!selectedClient.nombre?.trim() && !selectedClient.rut?.trim()) return;
    setIsSavingDraft(true);
    try {
      const res = await fetch('/api/quotation-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildPayload()),
      });
      if (res.ok) {
        const saved = await res.json() as { id: string };
        if (!draftId) {
          setDraftId(saved.id);
          onDraftStateChange?.(saved.id);
        }
      }
    } catch { /* silencioso */ }
    finally { setIsSavingDraft(false); }
  }, [currentProjectId, selectedClient, draftId, onDraftStateChange, buildPayload]);

  const triggerAutoSave = useCallback(() => {
    // BUG 3 fix: use .trim() so empty strings don't satisfy the guard
    if (!currentProjectId ||
        (!selectedClient.nombre?.trim() && !selectedClient.rut?.trim())) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => { saveImmediately(); }, 1500);
  }, [currentProjectId, selectedClient, saveImmediately]);

  useEffect(() => { triggerAutoSave(); }, [
    selectedClient, selectedUnits, mortgageInputs,
    includePaymentPlan, includeMortgageSimulation,
    adjustDrafts, reservaCLP, pieCuotasDropdown, pieCuotasManual,
    bonoPieUnits, bonoPct,
  ]);

  useEffect(() => {
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, []);

  // ── C1: Load drafts list (Fix 2: filtrado por proyecto activo) ───────────
  const loadDraftsList = useCallback(async () => {
    const token = localStorage.getItem('dw_token');
    if (!token || !currentProjectId) return;
    try {
      const res = await fetch(`/api/quotation-drafts?projectId=${currentProjectId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setDrafts(await res.json() as DraftSummary[]);
    } catch { /* silencioso */ }
  }, [currentProjectId]);

  useEffect(() => { loadDraftsList(); }, [loadDraftsList]);

  // Auto-load a specific draft when navigated from ClientList (↓ PDF button)
  useEffect(() => {
    if (!openDraftId || drafts.length === 0) return;
    const target = drafts.find(d => d.id === openDraftId);
    if (target) { void loadDraft(target); onDraftOpened?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDraftId, drafts.length]);

  // ── Fix 2: Resetear Quoter cuando cambia el proyecto activo ──────────────
  const prevProjectIdRef = useRef(currentProjectId);
  useEffect(() => {
    if (prevProjectIdRef.current === currentProjectId) return;
    prevProjectIdRef.current = currentProjectId;
    setSelectedUnits([]);
    setSelectedClient({
      tipoPersona: 'Natural', nombre: '', rut: '', email: '', telefono: '',
      nacionalidad: 'Chilena', profesion: '', sueldoRange: '', fechaNacimiento: '',
      direccion: '', ciudad: '', comuna: '', region: '', estado: 'Prospecto',
      representanteNacionalidad: 'Chilena',
    });
    setAdjustDrafts({});
    setDetachedAccessories([]);
    setBonoPieUnits(new Set());
    setDiscountRequests({});
    setDraftId(null);
    onDraftStateChange?.(null);
    setStep(1);
  }, [currentProjectId, onDraftStateChange]);

  // ── C1: Load a specific draft ────────────────────────────────────────────
  const loadDraft = async (draft: DraftSummary) => {
    setIsDraftLoading(true);
    try {
      const d = draft.data;
      const adjs = (d.adjustments as Array<{ key: string; value: unknown }> | undefined) || [];
      const getAdj = (key: string) => adjs.find(a => a.key === key)?.value;

      const sc = getAdj('selectedClient') as Partial<Client> | undefined;
      if (sc) setSelectedClient(sc);
      if (d.selectedUnits) setSelectedUnits(d.selectedUnits as QuoteItem[]);
      if (d.showMortgage != null) {
        // backward-compat con borradores antiguos
        setIncludePaymentPlan(d.showMortgage as boolean);
        setIncludeMortgageSimulation(d.showMortgage as boolean);
      }
      if (d.mortgageInputs) {
        const mi = d.mortgageInputs as Record<string, unknown>;
        // Backwards-compatible: old drafts may have pie/precioTotal fields
        setMortgageInputs({ tasaAnual: (mi.tasaAnual as number) ?? 4.5 });
      }
      const adj = getAdj('adjustDrafts') as Record<string, AdjEntry> | undefined;
      if (adj) setAdjustDrafts(adj);
      const da = getAdj('detachedAccessories') as string[] | undefined;
      if (da) setDetachedAccessories(da);
      const pc = getAdj('paymentConfig') as Record<string, unknown> | undefined;
      if (pc) {
        if (pc.reservaCLP != null) setReservaCLP(pc.reservaCLP as number);
        if (pc.pieCuotasDropdown != null) setPieCuotasDropdown(pc.pieCuotasDropdown as 6|12|18|24|36|'Otro');
        if (pc.pieCuotasManual != null) setPieCuotasManual(pc.pieCuotasManual as number);
        if (pc.bonoPieUnits != null) setBonoPieUnits(new Set(pc.bonoPieUnits as string[]));
        if (pc.bonoPct != null) setBonoPct(pc.bonoPct as number);
        if (pc.mortgageFinPct != null) setMortgageFinPct(pc.mortgageFinPct as number);
        // finPct ya no se guarda — se deriva de creditoPct
        if (pc.promesaPct != null) setPromesaPct(pc.promesaPct as number);
        if (pc.cuotasPct != null) setCuotasPct(pc.cuotasPct as number);
        if (pc.escrituraPct != null) setEscrituraPct(pc.escrituraPct as number);
        if (pc.nCuotasNew != null) setNCuotasNew(pc.nCuotasNew as number);
        if (pc.includePaymentPlan != null) setIncludePaymentPlan(pc.includePaymentPlan as boolean);
        if (pc.includeMortgageSimulation != null) setIncludeMortgageSimulation(pc.includeMortgageSimulation as boolean);
      }
      const qid = getAdj('quoteId') as string | undefined;
      if (qid) quoteIdRef.current = qid;

      setDraftId(draft.id);
      onDraftStateChange?.(draft.id);
      setShowDraftModal(false);
      setStep(2);

      // Check approval status of any discount requests in this draft
      const token = localStorage.getItem('dw_token');
      if (token) {
        try {
          const approvalRes = await fetch(`/api/quotation-drafts/${draft.id}/check-approvals`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (approvalRes.ok) {
            // For each unitId in adjustDrafts that has a discount, re-check status
            const adjs2 = getAdj('adjustDrafts') as Record<string, AdjEntry> | undefined;
            if (adjs2) {
              const unitIds = Object.keys(adjs2).filter(uid => {
                const e = adjs2[uid];
                return e.applied && parseFloat(e.rawValue) > 0;
              });
              for (const uid of unitIds) {
                // Fetch individual discount request if we have its ID
                const knownDr = discountRequests[uid];
                if (knownDr?.id) {
                  const drRes = await fetch(`/api/discount-requests/${knownDr.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (drRes.ok) {
                    const dr = await drRes.json() as { id: string; estado: string };
                    setDiscountRequests(prev => ({ ...prev, [uid]: { id: dr.id, estado: dr.estado as DiscountRequest['estado'] } }));
                    if (dr.estado === 'Rechazado') {
                      // Revert price for rejected discounts
                      setAdjustDrafts(prev => {
                        const n = { ...prev };
                        delete n[uid];
                        return n;
                      });
                    }
                  }
                }
              }
            }
          }
        } catch { /* silencioso */ }
      }
    } finally { setIsDraftLoading(false); }
  };

  // ── C1: Delete draft ─────────────────────────────────────────────────────
  const deleteDraft = async (id: string) => {
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    await fetch(`/api/quotation-drafts/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    setDrafts(prev => prev.filter(d => d.id !== id));
    if (id === draftId) { setDraftId(null); onDraftStateChange?.(null); }
  };

  // ── C5: Auto-load accessories ────────────────────────────────────────────
  const getAutoAccessories = useCallback(
    (deptUnit: RealEstateUnit): RealEstateUnit[] => {
      const available = (u: RealEstateUnit) =>
        u.estado === 'Disponible' || u.estado === 'Libre Asignación';
      const results: RealEstateUnit[] = [];
      deptUnit.bodegas.forEach(num => {
        const found = units.find(u => u.numero === num && available(u));
        if (found && !detachedAccessories.includes(found.id)) results.push(found);
      });
      deptUnit.estacionamientos.forEach(num => {
        const found = units.find(u => u.numero === num && available(u));
        if (found && !detachedAccessories.includes(found.id)) results.push(found);
      });
      return results;
    },
    [units, detachedAccessories],
  );

  const toggleUnitSelection = (unit: RealEstateUnit) => {
    const isSelected = selectedUnits.some(u => u.id === unit.id);
    if (isSelected) {
      setSelectedUnits(prev => prev.filter(u => u.id !== unit.id && u.parentDeptId !== unit.id));
    } else {
      const newItem: QuoteItem = { ...unit, isAutoLoaded: false };
      const accessories = unit.type === 'Departamento'
        ? getAutoAccessories(unit).map(a => ({ ...a, isAutoLoaded: true, parentDeptId: unit.id }) as QuoteItem)
        : [];
      setSelectedUnits(prev => [...prev, newItem, ...accessories]);
    }
  };

  const detachAccessory = (accessoryId: string) => {
    setDetachedAccessories(prev => [...prev, accessoryId]);
    setSelectedUnits(prev => prev.filter(u => u.id !== accessoryId));
  };

  const reattachAccessory = (accessoryId: string) => {
    setDetachedAccessories(prev => prev.filter(id => id !== accessoryId));
    const acc = units.find(u => u.id === accessoryId);
    if (!acc) return;
    const parentDept = selectedUnits.find(
      u => u.type === 'Departamento' &&
           (u.bodegas.includes(acc.numero) || u.estacionamientos.includes(acc.numero)),
    );
    if (parentDept) {
      setSelectedUnits(prev => [...prev, { ...acc, isAutoLoaded: true, parentDeptId: parentDept.id } as QuoteItem]);
    }
  };

  // ── Ajuste de precio — Paso 2 ─────────────────────────────────────────────
  const [discountError, setDiscountError] = useState<Record<string, string>>({});

  const applyAdjustment = async (unitId: string) => {
    const draft = adjustDrafts[unitId];
    if (!draft) return;
    const item = selectedUnits.find(u => u.id === unitId);
    if (!item) return;

    const rawValue = parseFloat(draft.rawValue);
    if (isNaN(rawValue) || rawValue < 0) {
      setDiscountError(prev => ({ ...prev, [unitId]: 'Ingrese un número positivo entre 0 y el límite permitido.' }));
      return;
    }

    // rawValue === 0 → quitar ajuste
    if (rawValue === 0) {
      await resetAdjustment(unitId);
      return;
    }

    const base = item.precioLista;
    const dcfg = effectiveDiscountConfig;

    // Validar límite máximo según tipo
    if (draft.type === '%' && rawValue > dcfg.supervisorMaxPct) {
      setDiscountError(prev => ({ ...prev, [unitId]: `El descuento máximo permitido es ${dcfg.supervisorMaxPct}%` }));
      return;
    }
    if (draft.type === 'UF') {
      const limiteUF = getMaxDescuentoUF(base, dcfg.supervisorMaxPct);
      if (rawValue > limiteUF) {
        setDiscountError(prev => ({
          ...prev,
          [unitId]: `El descuento máximo es ${formatUF(limiteUF)} UF (${dcfg.supervisorMaxPct}% del precio lista)`,
        }));
        return;
      }
    }

    const newPrice = getAdjustedPrice(base, rawValue, draft.type);
    if (newPrice <= 0) {
      setDiscountError(prev => ({ ...prev, [unitId]: 'El precio final debe ser mayor a 0 UF.' }));
      return;
    }

    setDiscountError(prev => { const n = { ...prev }; delete n[unitId]; return n; });
    setAdjustDrafts(prev => ({ ...prev, [unitId]: { ...draft, applied: true } }));

    // Flujo de autorización solo para rol Ventas
    if (isDiscountEntry(rawValue) && currentUser.role === 'Ventas') {
      const pct = draft.type === '%'
        ? rawValue
        : Math.round(((base - newPrice) / base) * 10000) / 100;
      const monto = Math.round((base - newPrice) * 100) / 100;

      // Cancelar DR anterior si existe
      const existing = discountRequests[unitId];
      if (existing && ['Pendiente', 'AprobadoJefe'].includes(existing.estado)) {
        const tok = localStorage.getItem('dw_token');
        if (tok) {
          fetch(`/api/discount-requests/${existing.id}/cancel`, {
            method: 'POST', headers: { Authorization: `Bearer ${tok}` },
          }).catch(() => {});
        }
      }

      const token = localStorage.getItem('dw_token');
      if (token && currentProjectId) {
        try {
          const res = await fetch('/api/discount-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              projectId: currentProjectId, unitId: item.id, unitNumero: item.numero,
              precioOriginal: base, precioSolicitado: newPrice,
              descuentoPct: pct, descuentoMonto: monto,
            }),
          });
          if (res.ok) {
            const dr = await res.json() as { id: string; estado: string };
            setDiscountRequests(prev => ({ ...prev, [unitId]: { id: dr.id, estado: 'Pendiente' } }));
          }
        } catch { /* silencioso */ }
      }

      const nivel = pct > dcfg.jefeMaxPct
        ? `Descuento ${pct.toFixed(1)}% — requiere aprobación de JefeSala y Supervisor.`
        : `Descuento ${pct.toFixed(1)}% — requiere aprobación de JefeSala.`;
      setDiscountError(prev => ({ ...prev, [unitId]: nivel }));
    }
  };

  const resetAdjustment = (unitId: string) => {
    setAdjustDrafts(prev => { const n = { ...prev }; delete n[unitId]; return n; });
    const req = discountRequests[unitId];
    if (req) {
      const token = localStorage.getItem('dw_token');
      if (token) {
        fetch(`/api/discount-requests/${req.id}/cancel`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      setDiscountRequests(prev => { const n = { ...prev }; delete n[unitId]; return n; });
    }
  };

  // ── Cuota del plan de pago (Paso 7) ─────────────────────────────────────
  // Base = totalMontoAPagar, dividido en nCuotas
  const montoPorCuota = useMemo(() => {
    const base = bonoPieBreakdown.totalMontoAPagar;
    return nCuotas > 0 ? Math.round((base / nCuotas) * 100) / 100 : 0;
  }, [bonoPieBreakdown.totalMontoAPagar, nCuotas]);

  // ── Dividend table ────────────────────────────────────────────────────────
  // Base = creditoPct% del PRECIO DE VENTA (precioVentaFinal = totalFinal)
  // ufCredito = precioVentaFinal × finPct / 100
  const dividendTable = useMemo(() => {
    const effectiveFinPct = includePaymentPlan
      ? Math.max(0, 100 - promesaPct - cuotasPct - escrituraPct)
      : mortgageFinPct;
    const base = includeMortgageSimulation && totalFinal > 0
      ? Math.max(0, totalFinal * effectiveFinPct / 100)
      : bonoPieBreakdown.totalPorFinanciar;
    return [20, 25, 30].map(years => {
      const divUF = calcDividendo(base, mortgageInputs.tasaAnual, years);
      const divCLP = ufHoy ? divUF * ufHoy : null;
      return { years, divUF, divCLP, rentaMin: divCLP ? divCLP * 4 : null };
    });
  }, [includeMortgageSimulation, includePaymentPlan, promesaPct, cuotasPct, escrituraPct, mortgageFinPct, bonoPieBreakdown.totalPrecioInflado, bonoPieBreakdown.totalPorFinanciar, mortgageInputs.tasaAnual, ufHoy]);

  // ── Available units ──────────────────────────────────────────────────────
  const availableUnits = useMemo(() => {
    const ownClientId = selectedClient?.id;
    const candidates = units.filter(u => {
      const isCandidate =
        u.estado === 'Disponible' ||
        u.estado === 'Libre Asignación' ||
        (!!ownClientId && u.clienteId === ownClientId);
      if (!isCandidate) return false;
      // Block Reservado units owned by another vendor
      if (u.estado === 'Reservado' && u.reservaVendedorId && u.reservaVendedorId !== currentUser.id) return false;
      return true;
    });
    if (!unitFilter) return candidates;
    const lf = unitFilter.toLowerCase();
    return candidates.filter(u =>
      u.numero.toLowerCase().includes(lf) || u.type.toLowerCase().includes(lf),
    );
  }, [units, unitFilter, selectedClient?.id, currentUser.id]);

  const detachedUnits = useMemo(
    () => units.filter(u => detachedAccessories.includes(u.id)),
    [units, detachedAccessories],
  );

  // ── Client helpers ───────────────────────────────────────────────────────
  const handleClientChange = (field: keyof Client, value: unknown) =>
    setSelectedClient(prev => ({ ...(prev || {}), [field]: value }));

  const initNewClient = () => { setSelectedClient(emptyClient); };

  // ── Helper: load image as base64 for jsPDF ─────────────────────────────
  const loadImgB64 = async (src: string): Promise<string | null> => {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise<string | null>(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  };

  // ── PDF generation — estilo SSilva ──────────────────────────────────────
  const generatePDFBlob = async (): Promise<Blob | null> => {
    if (!selectedClient || !currentProject) return null;
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const mg = 15;
    const pageWidth = 210;
    const contentWidth = pageWidth - mg * 2;
    const tSm = { fontSize: 8, cellPadding: 1.8 };
    const thSm = { fillColor: [37, 99, 235] as [number,number,number], fontSize: 8, fontStyle: 'bold' as const, cellPadding: 1.8, textColor: [255,255,255] as [number,number,number] };
    const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // ── HEADER ─────────────────────────────────────────────────────────────
    const HEADER_H = 22;
    const LOGO_W = 52; // white area width

    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, HEADER_H, 'F');
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, LOGO_W, HEADER_H, 'F');

    try {
      const logoB64 = await loadImgB64('/Danacorp.png');
      if (!logoB64) throw new Error('no logo');
      const logoImg = new window.Image();
      await new Promise<void>(resolve => { logoImg.onload = logoImg.onerror = () => resolve(); logoImg.src = logoB64; });
      const pad = 2.5;
      const aw = LOGO_W - 2 * pad, ah = HEADER_H - 2 * pad;
      const ar = logoImg.naturalWidth > 0 ? logoImg.naturalWidth / logoImg.naturalHeight : 3;
      let lw: number, lh: number;
      if (ar > aw / ah) { lw = aw; lh = lw / ar; } else { lh = ah; lw = lh * ar; }
      doc.addImage(logoB64, 'PNG', (LOGO_W - lw) / 2, (HEADER_H - lh) / 2, lw, lh);
    } catch {
      doc.setTextColor(37, 99, 235);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('DANACORP', LOGO_W / 2, HEADER_H / 2 + 2, { align: 'center' });
    }

    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const hoy = new Date();
    const fechaLarga = `Santiago, ${hoy.getDate()} de ${meses[hoy.getMonth()]} de ${hoy.getFullYear()}`;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('COTIZACIÓN', pageWidth - mg, HEADER_H / 2 - 5, { align: 'right' });
    doc.setFontSize(9);
    doc.text(`N° ${quoteIdRef.current}`, pageWidth - mg, HEADER_H / 2 + 0.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(fechaLarga, pageWidth - mg, HEADER_H / 2 + 5.5, { align: 'right' });

    let y = HEADER_H + 7;
    const lh4 = 4.5;

    // ── SEÑOR(A) block ─────────────────────────────────────────────────────
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Señor(a)', mg, y); y += lh4;
    doc.setFont('helvetica', 'bold');
    doc.text(selectedClient.nombre || '', mg, y); y += lh4;
    doc.setFont('helvetica', 'normal');
    if (selectedClient.rut)     { doc.text(`Rut : ${selectedClient.rut}`, mg, y); y += lh4; }
    if (selectedClient.telefono){ doc.text(`Telefono : ${selectedClient.telefono}`, mg, y); y += lh4; }
    if (selectedClient.email)   { doc.text(`Mail : ${selectedClient.email}`, mg, y); y += lh4; }
    doc.text('Presente', mg, y); y += lh4 + 1;
    doc.setFont('helvetica', 'bold');
    doc.text('Estimado(a) cliente:', mg, y); y += lh4;
    doc.setFont('helvetica', 'normal');
    const pc = projectConfig as typeof projectConfig & { direccionProyecto?: string; comunaProyecto?: string; ciudadProyecto?: string };
    const direccionStr = pc.direccionProyecto ? `, ubicado en ${pc.direccionProyecto}` : '';
    const comunaStr = pc.comunaProyecto ? `, comuna de ${pc.comunaProyecto}` : '';
    const ciudadStr = pc.ciudadProyecto ? `, ciudad de ${pc.ciudadProyecto}` : '';
    const introTxt = `De acuerdo a lo solicitado, nos es muy grato cotizar por los inmuebles que se indican, correspondientes al proyecto ${currentProject.nombre}${direccionStr}${comunaStr}${ciudadStr}:`;
    const introLns = doc.splitTextToSize(introTxt, contentWidth);
    doc.text(introLns, mg, y);
    y += introLns.length * lh4 + 5;

    // ── SECCIÓN 1: INMUEBLES (estilo asiento SSilva) ──────────────────────
    if (y > 230) { doc.addPage(); y = mg; }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
    doc.text('1.  INMUEBLES', mg, y); y += 5;

    // Helper: label "Descuento Adicional Departamento X% en [unidades]" dinámico
    const bonoTypesArr = [...new Set(bonoPieBreakdown.conBono.map(x => x.unit.type))] as string[];
    const btLbls: string[] = [];
    if (bonoTypesArr.includes('Departamento')) btLbls.push('Depto.');
    if (bonoTypesArr.includes('Estacionamiento')) btLbls.push('Estac.');
    if (bonoTypesArr.includes('Bodega')) btLbls.push('Bodega');
    const bonoLabelPDF = btLbls.length === 0 ? '' :
      btLbls.length === 1 ? `Bonificación ${bonoPct}% en ${btLbls[0]}` :
      `Bonificación ${bonoPct}% en ${btLbls.slice(0,-1).join(', ')} y ${btLbls[btLbls.length-1]}`;

    // Per-unit rows: precio INFLADO (con bono incorporado), badge dcto manual si aplica
    const unitRowsPDF: unknown[][] = selectedUnits.map(u => {
      const calc = bonoPieBreakdown.perUnit.find(x => x.unit.id === u.id)?.calc;
      const precioMostrado = calc ? calc.precioInflado : unitFinalPrice(u, adjustDrafts);
      const dctoP = unitDiscountPct(u, adjustDrafts);
      const hasDcto = dctoP > 0.001 && adjustDrafts[u.id]?.applied;
      let tipoDesc = u.type;
      if (u.type === 'Departamento' && u.dormitorios && u.banos)
        tipoDesc = `Departamento (${u.dormitorios}D-${u.banos}B)`;
      const nivel = u.piso ? `del Piso N° ${u.piso}` : '';
      return [
        tipoDesc, `N°${u.numero}`, nivel,
        { content: formatUF(precioMostrado), styles: { halign: 'right' as const } },
        { content: ufHoy ? formatCLP(precioMostrado * ufHoy) : '', styles: { halign: 'right' as const } },
        { content: hasDcto ? `← -${dctoP.toFixed(0)}% dcto` : '',
          styles: { halign: 'right' as const, textColor: [150,150,150] as [number,number,number], fontStyle: 'italic' as const, fontSize: 6.5 } },
      ];
    });

    const hasBonoPDF  = bonoPieBreakdown.conBono.length > 0;
    // totalPrecioVentaSSilva = suma de precios inflados = PRECIO DE LISTA
    // totalFinal = suma de valores económicos reales = PRECIO DE VENTA

    // Filas de resumen
    const summaryPDF: unknown[][] = [];
    if (hasBonoPDF) {
      // PRECIO DE LISTA = suma de inflados
      summaryPDF.push([
        { content: 'PRECIO DE LISTA', styles: { fontStyle: 'bold' as const } }, '', '',
        { content: formatUF(totalPrecioVentaSSilva), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: ufHoy ? formatCLP(totalPrecioVentaSSilva * ufHoy) : '', styles: { fontStyle: 'bold' as const, halign: 'right' as const } }, '',
      ]);
      // Bono Pie = monto que se resta
      summaryPDF.push([
        { content: bonoLabelPDF, styles: { fontStyle: 'italic' as const, textColor: [100,100,100] as [number,number,number] } }, '', '',
        { content: formatUF(bonoPieBreakdown.totalBonificacion), styles: { halign: 'right' as const, textColor: [100,100,100] as [number,number,number] } },
        { content: ufHoy ? formatCLP(bonoPieBreakdown.totalBonificacion * ufHoy) : '', styles: { halign: 'right' as const, textColor: [100,100,100] as [number,number,number] } }, '',
      ]);
    }
    // PRECIO DE VENTA = valor económico real (= totalFinal)
    summaryPDF.push([
      { content: 'PRECIO DE VENTA', styles: { fontStyle: 'bold' as const, textColor: [37,99,200] as [number,number,number] } }, '', '',
      { content: formatUF(totalFinal), styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [37,99,200] as [number,number,number] } },
      { content: ufHoy ? formatCLP(totalFinal * ufHoy) : '', styles: { fontStyle: 'bold' as const, halign: 'right' as const, textColor: [37,99,200] as [number,number,number] } }, '',
    ]);

    autoTable(doc, {
      startY: y, margin: { left: mg, right: mg },
      head: [[
        'Tipo', 'Número', 'Ubicación',
        { content: 'Valor UF', styles: { halign: 'right' as const } },
        { content: 'Valor $', styles: { halign: 'right' as const } },
        '',
      ]],
      body: [...unitRowsPDF, ...summaryPDF],
      headStyles: {
        fillColor: [255, 255, 255] as [number, number, number],
        textColor: [60, 60, 60] as [number, number, number],
        fontStyle: 'bold' as const,
        fontSize: 9,
        cellPadding: { top: 3, bottom: 4, left: 3, right: 3 },
        lineWidth: { bottom: 0.3 } as unknown as number,
        lineColor: [180, 180, 180] as [number, number, number],
      },
      bodyStyles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 3, right: 3 } },
      theme: 'plain',
      columnStyles: {
        3: { halign: 'right' as const },
        4: { halign: 'right' as const },
        5: { halign: 'right' as const, cellWidth: 22 },
      },
      didDrawCell: (data: { section: string; row: { index: number }; cell: { x: number; y: number; height: number }; column: { index: number } }) => {
        // Línea bajo encabezado
        if (data.section === 'head' && data.column.index === 0) {
          doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.2);
          doc.line(mg, data.cell.y + data.cell.height, pageWidth - mg, data.cell.y + data.cell.height);
        }
        // Línea separadora antes de las filas resumen
        if (data.section === 'body' && data.row.index === unitRowsPDF.length && data.column.index === 0) {
          doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
          doc.line(mg, data.cell.y, pageWidth - mg, data.cell.y);
        }
        // Línea separadora antes del TOTAL (cuando hay bono + precio lista + bonificacion)
        if (data.section === 'body' && hasBonoPDF && data.row.index === unitRowsPDF.length + summaryPDF.length - 1 && data.column.index === 0) {
          doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
          doc.line(mg, data.cell.y, pageWidth - mg, data.cell.y);
        }
      },
    });
    y = lastY() + 5;

    // ── SECCIÓN 2: FORMA DE PAGO (estilo asiento) ─────────────────────────
    if (includePaymentPlan) {
      if (y > 220) { doc.addPage(); y = mg; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      doc.text('2.  FORMA DE PAGO', mg, y); y += 5;

      const pagoRows: unknown[][] = [
        ['A la firma de Promesa', `${promesaPct.toFixed(2)}%`, '',
          { content: formatUF(promesaUF), styles: { halign: 'right' as const } },
          { content: ufHoy ? formatCLP(promesaUF * ufHoy) : '', styles: { halign: 'right' as const } }],
        [`En ${nCuotasNew} cuota(s)`, `${cuotasPct.toFixed(2)}%`, `Cuota(s) de UF ${formatUF(cuotaIndividualUF)} c/u.`,
          { content: formatUF(cuotasUF), styles: { halign: 'right' as const } },
          { content: ufHoy ? formatCLP(cuotasUF * ufHoy) : '', styles: { halign: 'right' as const } }],
        ['A la firma de Escritura', `${escrituraPct.toFixed(2)}%`, '',
          { content: formatUF(escrituraUF), styles: { halign: 'right' as const } },
          { content: ufHoy ? formatCLP(escrituraUF * ufHoy) : '', styles: { halign: 'right' as const } }],
        [{ content: 'Crédito Inst. Financiera', styles: { textColor: [37,99,200] as [number,number,number] } },
          { content: `${creditoPct.toFixed(2)}%`, styles: { textColor: [37,99,200] as [number,number,number] } }, '',
          { content: formatUF(creditoUF), styles: { halign: 'right' as const, textColor: [37,99,200] as [number,number,number] } },
          { content: ufHoy ? `${formatCLP(creditoUF * ufHoy)} (*)` : '', styles: { halign: 'right' as const, textColor: [37,99,200] as [number,number,number] } }],
        // Total row — 100% × precioVentaFinal
        ['', { content: '100,00%', styles: { fontStyle: 'bold' as const } }, '',
          { content: formatUF(precioVentaFinal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
          { content: ufHoy ? formatCLP(precioVentaFinal * ufHoy) : '', styles: { fontStyle: 'bold' as const, halign: 'right' as const } }],
      ];

      autoTable(doc, {
        startY: y, margin: { left: mg, right: mg },
        head: [[
          'Concepto', '%', 'Detalle',
          { content: 'Valor UF', styles: { halign: 'right' as const } },
          { content: 'Valor $', styles: { halign: 'right' as const } },
        ]],
        body: pagoRows,
        headStyles: {
          fillColor: [255, 255, 255] as [number, number, number],
          textColor: [60, 60, 60] as [number, number, number],
          fontStyle: 'bold' as const,
          fontSize: 9,
          cellPadding: { top: 3, bottom: 4, left: 3, right: 3 },
          lineWidth: { bottom: 0.3 } as unknown as number,
          lineColor: [180, 180, 180] as [number, number, number],
        },
        bodyStyles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 3, right: 3 } },
        theme: 'plain',
        columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 18, halign: 'right' as const }, 2: { cellWidth: 38 }, 3: { halign: 'right' as const }, 4: { halign: 'right' as const } },
        didDrawCell: (data: { section: string; row: { index: number }; cell: { x: number; y: number; height: number }; column: { index: number } }) => {
          // Línea bajo encabezado
          if (data.section === 'head' && data.column.index === 0) {
            doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.2);
            doc.line(mg, data.cell.y + data.cell.height, pageWidth - mg, data.cell.y + data.cell.height);
          }
          // Separador antes del Total
          if (data.section === 'body' && data.row.index === pagoRows.length - 1 && data.column.index === 0) {
            doc.setDrawColor(200,200,200); doc.setLineWidth(0.2);
            doc.line(mg, data.cell.y, pageWidth - mg, data.cell.y);
          }
        },
      });
      y = lastY() + 2;

      doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120);
      const notaAst = '(*) El (la) cotizante declara conocer cuáles son los requerimientos exigidos para optar a un crédito o mutuo hipotecario y que las instituciones financieras los cursan con la tasa vigente a la fecha en que se formalice la compraventa.';
      const notaLns = doc.splitTextToSize(notaAst, contentWidth);
      doc.text(notaLns, mg, y);
      y += notaLns.length * 3.2 + 5;

    } // end includePaymentPlan

    // ── SECCIÓN 3: DIVIDENDO APROXIMADO REFERENCIAL ────────────────────────
    if (includeMortgageSimulation) {
      if (y > 225) { doc.addPage(); y = mg; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      const secNum = includePaymentPlan ? '3.' : '2.';
      doc.text(`${secNum}  DIVIDENDO APROXIMADO REFERENCIAL`, mg, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
      doc.text(`Calculado a la tasa referencial de este día, sin considerar seguros: ${mortgageInputs.tasaAnual.toFixed(2)}%.`, mg, y);
      y += 4;

      autoTable(doc, {
        startY: y, margin: { left: mg, right: mg },
        head: [['Plazo Crédito', 'Dividendo en UF', 'Dividendo en $', 'Renta mínima aprox. $']],
        body: dividendTable.map(r => [
          `${r.years} años`,
          { content: formatUF(r.divUF), styles: { halign: 'right' as const } },
          { content: r.divCLP ? formatCLP(r.divCLP) : '—', styles: { halign: 'right' as const } },
          { content: r.rentaMin ? formatCLP(r.rentaMin) : '—', styles: { halign: 'right' as const } },
        ]),
        headStyles: {
          fillColor: [255, 255, 255] as [number, number, number],
          textColor: [60, 60, 60] as [number, number, number],
          fontStyle: 'bold' as const,
          fontSize: 9,
          cellPadding: { top: 3, bottom: 4, left: 3, right: 3 },
          lineWidth: { bottom: 0.3 } as unknown as number,
          lineColor: [180, 180, 180] as [number, number, number],
        },
        bodyStyles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 3, right: 3 } },
        theme: 'plain',
        columnStyles: {
          0: { halign: 'left' as const },
          1: { halign: 'right' as const },
          2: { halign: 'right' as const },
          3: { halign: 'right' as const },
        },
        didDrawCell: (data: { section: string; row: { index: number }; cell: { x: number; y: number; height: number }; column: { index: number } }) => {
          if (data.section === 'head' && data.column.index === 0) {
            doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.2);
            doc.line(mg, data.cell.y + data.cell.height, pageWidth - mg, data.cell.y + data.cell.height);
          }
        },
      });
      y = lastY() + 5;
    }

    // ── BLOQUE: MONTO DE LA RESERVA + Notas Aclaratorias ─────────────────
    {
      if (y > 215) { doc.addPage(); y = mg; }
      const reservaCLPVal = reservaCLP || 300000;
      const nombreInmob   = projectConfig.nombreInmobiliaria || 'la Inmobiliaria';
      const vigenciaDias  = effectiveDiscountConfig.vigenciaCotizacionDias;
      const reservaFmt    = reservaCLPVal.toLocaleString('es-CL');
      const fechaUFStr    = ufFecha || new Date().toLocaleDateString('es-CL');
      const valorUFStr    = ufHoy
        ? ufHoy.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      doc.text('4.  MONTO DE LA RESERVA', mg, y); y += 5;

      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(60, 60, 60);

      const pdfBullets = [
        `.- Al concretar la decisión de compra, el cotizante deberá entregar $ ${reservaFmt} que se imputarán íntegramente al pago de parte de los gastos operacionales que se generen por la compraventa. En caso que no firmara la respectiva promesa de compraventa, teniendo la pre aprobación o aprobación de un crédito, este monto se imputará por completo al pago de una multa penal compensatoria a favor de ${nombreInmob}.`,
        `.- La Inmobiliaria se reserva el derecho de gestionar el crédito hipotecario con las instituciones financieras que considere pertinentes. Para el efecto, el cliente deberá hacer entrega de todos los antecedentes que se soliciten.`,
        `.- El Número de cuotas para el pie en construcción es válido mientras la primera cuota cae en este mes.`,
        `.- Quedamos atentos a cualquier requerimiento adicional y dispuesto a aclararle cualquier duda. Nuestro objetivo es atenderlo con esmero y entregarle la información que usted requiere para que su decisión de compra y en definitiva su compra, se haga realidad. Agradecidos por su visita y confiados en poder atenderlo con el profesionalismo que su decisión de compra merece, le saludamos atentamente.`,
      ];

      for (const bullet of pdfBullets) {
        if (y + 8 > 275) { doc.addPage(); y = mg; }
        const wrapped = doc.splitTextToSize(bullet, contentWidth);
        doc.text(wrapped, mg, y);
        y += wrapped.length * 3 + 1;
      }
      y += 3;

      if (y > 265) { doc.addPage(); y = mg; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
      doc.text('Notas Aclaratorias:', mg, y); y += 4;

      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(60, 60, 60);

      const pdfNotas = ([
        `- Los montos en pesos corresponden al valor de la UF. a esta fecha, por lo cual se citan sólo como referencia.`,
        ufHoy ? `  Valor de la UF al ${fechaUFStr} es de $${valorUFStr}.` : '',
        `- Cotización válida por ${vigenciaDias} días, según disponibilidad de los inmuebles.`,
        `- El valor indicado en pesos es sólo referencial y meramente demostrativo. Para efectos de cada pago se deberá considerar el valor equivalente en pesos al día de pago efectivo según la Unidad de Fomento correspondiente.`,
      ] as string[]).filter(Boolean);

      for (const nota of pdfNotas) {
        if (y + 5 > 275) { doc.addPage(); y = mg; }
        const wrapped = doc.splitTextToSize(nota, contentWidth);
        doc.text(wrapped, mg, y);
        y += wrapped.length * 2.8 + 0.5;
      }
      y += 5;
    }

    // ── FOOTER: firma vendedor ─────────────────────────────────────────────
    if (y > 262) { doc.addPage(); y = mg; }
    doc.setDrawColor(37, 99, 235); doc.setLineWidth(0.3);
    doc.line(mg, y, mg + 45, y); y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
    doc.text(currentUser.name, mg, y); y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
    doc.text(currentUser.company || currentProject.nombre, mg, y); y += 3.5;
    if (currentUser.email) { doc.text(currentUser.email, mg, y); }

    // Numeración de páginas
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(6); doc.setTextColor(160, 160, 160); doc.setFont('helvetica', 'normal');
      doc.text('Generado por DanaWorks', mg, ph - 5);
      doc.text(`Página ${i} de ${pageCount}`, pageWidth - mg, ph - 5, { align: 'right' });
    }

    return doc.output('blob');
  };

  const [isDraftGenerated, setIsDraftGenerated] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const promoteDraft = async () => {
    if (!draftId || isDraftGenerated) return;
    const token = localStorage.getItem('dw_token');
    try {
      const res = await fetch(`/api/quotation-drafts/${draftId}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vendedorId: currentUser.id }),
      });
      if (res.ok) {
        setIsDraftGenerated(true);
        try {
          const blob = await generatePDFBlob();
          if (blob && draftId) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            uint8Array.forEach(b => { binary += String.fromCharCode(b); });
            const pdfBase64 = btoa(binary);
            const tok = localStorage.getItem('dw_token');
            const pdfRes = await fetch(`/api/quotation-drafts/${draftId}/pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ pdfBase64 }),
            });
            if (pdfRes.ok) {
              const { pdfPath } = await pdfRes.json() as { pdfPath: string };
              setPdfSavedPath(pdfPath);
            }
          }
        } catch (err) {
          console.error('[promoteDraft] Error guardando PDF:', err);
        }
        setToastMsg('✓ Cotización guardada en ficha del cliente');
        setTimeout(() => setToastMsg(''), 3000);
      }
    } catch { /* no bloquear la acción principal */ }
  };

  const handleDownloadPDF = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // Si ya fue guardado en servidor, descargarlo desde allí
    if (pdfSavedPath) {
      const tok = localStorage.getItem('dw_token');
      if (tok) {
        try {
          const r = await fetch(`/uploads/${pdfSavedPath}`, { headers: { Authorization: `Bearer ${tok}` } });
          if (r.ok) {
            const serverBlob = await r.blob();
            const url = URL.createObjectURL(serverBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Cotizacion_${currentProject?.nombre.replace(/\s+/g, '_') || 'DW'}_${quoteIdRef.current}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            return;
          }
        } catch { /* caer al fallback local */ }
      }
    }

    // Fallback: generar localmente (sin guardar en servidor)
    if (!draftId && currentProjectId &&
        (selectedClient.nombre?.trim() || selectedClient.rut?.trim())) {
      await saveImmediately();
    }
    await promoteDraft();
    const blob = await generatePDFBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cotizacion_${currentProject?.nombre.replace(/\s+/g, '_') || 'DW'}_${quoteIdRef.current}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendEmail = async () => {
    // Mismo patrón que handleDownloadPDF: cancelar autosave y forzar guardado
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!draftId && currentProjectId &&
        (selectedClient.nombre?.trim() || selectedClient.rut?.trim())) {
      await saveImmediately();
    }
    setIsEmailSending(true);
    setEmailSent(false);
    await promoteDraft();
    try {
      const blob = await generatePDFBlob();
      let pdfBase64 = '';
      if (blob) {
        const buf = await blob.arrayBuffer();
        pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      }
      const token = localStorage.getItem('dw_token');
      await fetch('/api/quotations/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          to: selectedClient.email || '', clientName: selectedClient.nombre || '',
          projectName: currentProject?.nombre || '', pdfBase64,
          fileName: `Cotizacion_${quoteIdRef.current}.pdf`,
        }),
      });
      setEmailSent(true);
    } catch { /* silencioso */ }
    finally { setIsEmailSending(false); }
  };

  // ── Finalize ─────────────────────────────────────────────────────────────
  const handleFinalizeAndSave = async () => {
    let wasJustGenerated = false;

    if (!isDraftGenerated) {
      await promoteDraft();
      wasJustGenerated = true;
    }

    if (!selectedClient.nombre?.trim() || !selectedClient.rut?.trim()) {
      alert('Faltan datos obligatorios del cliente (nombre y RUT).');
      return;
    }
    const hasPending = Object.values(discountRequests).some(r => r.estado === 'Pendiente');
    if (hasPending) {
      alert('Hay descuentos pendientes de autorización. Aguarda aprobación.');
      return;
    }

    const quoteDate = new Date().toLocaleDateString('es-CL');
    const finalStatus: Client['estado'] =
      selectedClient.id && selectedClient.estado !== 'Cerrado' ? (selectedClient.estado as Client['estado']) : 'Prospecto';

    const quoteDoc: ClientDocument = {
      id: generateId(), name: `Cotizacion_${currentProject?.nombre || 'DW'}_${quoteIdRef.current}.pdf`,
      type: 'application/pdf', category: 'Cotización', url: '#',
      date: quoteDate, size: '—',
    };

    try {
      const blob = await generatePDFBlob();
      if (blob) {
        const token = localStorage.getItem('dw_token');
        const params = new URLSearchParams({
          client_rut: selectedClient.rut || '', client_name: selectedClient.nombre || '',
          project_name: currentProject?.nombre || '', file_name: quoteDoc.name,
          created_by: currentUser.name,
        });
        const res = await fetch(`/api/quotations/documents?${params}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: blob,
        });
        if (res.ok) { const saved = await res.json() as { url: string }; quoteDoc.url = saved.url; }
      }
    } catch { /* silencioso */ }

    const clientToSave: Client = {
      ...selectedClient as Client,
      estado: finalStatus, id: selectedClient.id || generateId(),
      projectId: currentProjectId || '', fechaRegistro: selectedClient.fechaRegistro || quoteDate,
      historial: [
        ...(selectedClient.historial || []),
        { fecha: quoteDate, tipo: 'Cotización', descripcion: `Cotización generada. Total: ${formatUF(totalFinal)} UF.`, usuario: currentUser.name },
      ],
      documents: [...(selectedClient.documents || []), quoteDoc],
    };

    onSaveProspect(clientToSave, `Nueva cotización emitida para ${clientToSave.nombre}.`, quoteDoc);

    if (draftId) {
      const shouldDelete = !isDraftGenerated && !wasJustGenerated;
      if (shouldDelete) {
        const token = localStorage.getItem('dw_token');
        if (token) {
          await fetch(`/api/quotation-drafts/${draftId}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      }
      setDraftId(null);
      onDraftStateChange?.(null);
    }
    setIsFinalized(true);
  };

  const handleReset = () => {
    setStep(1); setIsFinalized(false);
    setSelectedUnits([]); setAdjustDrafts({}); setDetachedAccessories([]);
    setDiscountRequests({}); setDiscountError({});
    setIncludePaymentPlan(false); setIncludeMortgageSimulation(false);
    setBonoPieUnits(new Set());
    setMortgageInputs({ tasaAnual: 4.5 });
    setMortgageFinPct(80);
    setReservaCLP(0); setPieCuotasDropdown(12); setPieCuotasManual(12);
    setPromesaPct(3); setCuotasPct(7); setEscrituraPct(10); setNCuotasNew(36);
    setInlineTerm(''); setShowInlineDropdown(false);
    setEmailSent(false); setDraftId(null); setPdfSavedPath(null);
    quoteIdRef.current = generateId().substring(0, 9).toUpperCase();
    initNewClient(); loadDraftsList();
  };

  const hasPendingDiscount = Object.values(discountRequests).some(r => r.estado === 'Pendiente');

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  if (isFinalized) {
    return (
      <div className="animate-in zoom-in-95 duration-300 max-w-2xl mx-auto py-20 text-center space-y-8">
        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle className="w-14 h-14 text-green-600" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-gray-900">¡Propuesta Procesada!</h2>
          <p className="text-gray-500 mt-2">La cotización fue guardada en la Carpeta Digital del cliente.</p>
        </div>
        <button onClick={handleReset}
          className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition-all">
          Nueva Cotización
        </button>
      </div>
    );
  }

  // Draft modal
  const DraftModal = () => {
    const getDraftQuoteId = (d: DraftSummary): string => {
      const adj = (d.data?.adjustments ?? []) as { key: string; value: string }[];
      return adj.find(a => a.key === 'quoteId')?.value || '—';
    };
    const getDraftUnits = (d: DraftSummary): string => {
      const data = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
      const units = (data?.selectedUnits ?? []) as { type: string; numero: string }[];
      if (units.length === 0) return '—';
      return units.map(u => (`${u.type} ${u.numero}`).trim()).join(', ');
    };
    const fmtFecha = (iso: string): string => {
      const dt = new Date(iso);
      if (isNaN(dt.getTime())) return '—';
      const now = new Date();
      const hh = String(dt.getHours()).padStart(2, '0');
      const min = String(dt.getMinutes()).padStart(2, '0');
      const isToday = dt.getDate() === now.getDate() && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
      if (isToday) return `hoy ${hh}:${min}`;
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm} ${hh}:${min}`;
    };
    const q = draftSearchTerm.toLowerCase();
    const filtered = drafts.filter(d => {
      if (!q) return true;
      const qid = getDraftQuoteId(d).toLowerCase();
      const nombre = (d.clienteNombre || '').toLowerCase();
      const unidades = getDraftUnits(d).toLowerCase();
      return qid.includes(q) || nombre.includes(q) || unidades.includes(q);
    });
    const sorted = [...filtered].sort((a, b) => {
      if (draftSortOrder === 'cotizante') {
        return (a.clienteNombre || '').localeCompare(b.clienteNombre || '', 'es');
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">Borradores guardados</h3>
            <button onClick={() => setShowDraftModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          {/* Search + Sort bar */}
          <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50">
            <input
              type="text"
              placeholder="Buscar por cotizante, N° o unidad..."
              value={draftSearchTerm}
              onChange={e => setDraftSearchTerm(e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-100"
            />
            <span className="text-xs text-gray-400 shrink-0">Ordenar:</span>
            <button
              onClick={() => setDraftSortOrder('fecha')}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${draftSortOrder === 'fecha' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
              Fecha
            </button>
            <button
              onClick={() => setDraftSortOrder('cotizante')}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${draftSortOrder === 'cotizante' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
              Cotizante
            </button>
          </div>
          {/* Table */}
          <div className="overflow-y-auto flex-1">
            {sorted.length === 0 ? (
              <p className="text-center text-gray-400 italic py-10">
                {drafts.length === 0 ? 'Sin borradores guardados.' : 'Sin resultados para la búsqueda.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">N°</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unidades</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Fecha</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sorted.map(d => (
                    <tr key={d.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{getDraftQuoteId(d)}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px] truncate" title={getDraftUnits(d)}>
                        {getDraftUnits(d)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{d.clienteNombre || 'Sin cliente'}</div>
                        <div className="text-xs text-gray-400 font-mono">{d.clienteRut || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{fmtFecha(d.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => loadDraft(d)} disabled={isDraftLoading}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            Continuar
                          </button>
                          <button onClick={() => deleteDraft(d.id)}
                            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto space-y-8 pb-12">
      {showDraftModal && <DraftModal />}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center print:hidden flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-blue-600" /> Cotizador Comercial
          </h2>
          <p className="text-gray-500 mt-1 text-sm">Genera propuestas formales para prospectos.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => { loadDraftsList(); setShowDraftModal(true); }}
            className="relative px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Borradores
            {drafts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-blue-600 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                {drafts.length}
              </span>
            )}
          </button>
          {isSavingDraft && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Guardando…
            </span>
          )}
          {draftId && !isSavingDraft && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Check className="w-3 h-3" /> Borrador guardado
            </span>
          )}
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg">
            UF hoy: <span className="font-bold text-gray-800">{ufHoy ? formatCLP(ufHoy) : '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {([1, 2, 3] as const).map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <span className="text-gray-300">→</span>}
                <span className={`px-3 py-1 rounded-full ${step === s ? 'bg-blue-600 text-white' : step > s ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s}. {['Datos Cotizante', 'Unidades', 'Resumen'][i]}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* ── STEP 1: DATOS COTIZANTE ─────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-8">
          <div className="pb-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-800 text-lg">Datos Cotizante</h3>
            <p className="text-xs text-gray-400 mt-0.5">Escribe 3+ caracteres en Nombre o RUT para buscar clientes existentes y autocompletar.</p>
          </div>

            <div className="space-y-8">
              <div className="flex items-center gap-4">
                <label className="text-sm font-black text-gray-400 uppercase tracking-widest">Perfil Legal:</label>
                <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                  {(['Natural', 'Juridica'] as const).map(t => (
                    <button key={t} onClick={() => handleClientChange('tipoPersona', t)}
                      className={`px-6 py-2 rounded-lg font-bold text-xs transition-all ${selectedClient.tipoPersona === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>
                      {t === 'Natural' ? 'Persona Natural' : 'Persona Jurídica'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Nombre Completo / Razón Social *</label>
                  <div className="relative" ref={inlineSearchRef}>
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.nombre || ''}
                      onChange={e => {
                        handleClientChange('nombre', e.target.value);
                        setInlineTerm(e.target.value);
                        setShowInlineDropdown(e.target.value.trim().length >= 2);
                      }}
                      onFocus={e => { if (e.target.value.trim().length >= 2) setShowInlineDropdown(true); }}
                      placeholder="Ej: Juan Pérez"
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                    {showInlineDropdown && inlineSearchResults.length > 0 && (
                      <div className="absolute z-[200] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
                        <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100">
                          <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Clientes existentes — clic para autocompletar</span>
                        </div>
                        {inlineSearchResults.map(c => (
                          <button key={c.id} onClick={() => handleSelectInlineClient(c)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between border-b border-gray-50 last:border-none transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">{c.nombre.charAt(0)}</div>
                              <div>
                                <div className="font-bold text-gray-900 text-sm">{c.nombre}</div>
                                <div className="text-xs text-gray-400 font-mono">{c.rut}</div>
                              </div>
                            </div>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${c.estado === 'Activo' ? 'bg-green-100 text-green-700' : c.estado === 'Prospecto' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{c.estado}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedClient.id && (
                    <p className="mt-1 text-[10px] text-blue-600 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Cliente existente seleccionado
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">RUT *</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.rut || ''}
                      onChange={e => {
                        handleClientChange('rut', e.target.value);
                        setInlineTerm(e.target.value);
                        setShowInlineDropdown(e.target.value.trim().length >= 2);
                      }}
                      placeholder="12.345.678-9"
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 font-mono" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Email</label>
                  <div className="relative">
                    <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="email" value={selectedClient.email || ''}
                      onChange={e => handleClientChange('email', e.target.value)}
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Teléfono</label>
                  <div className="relative">
                    <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.telefono || ''}
                      onChange={e => handleClientChange('telefono', e.target.value)}
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Nacionalidad</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.nacionalidad || ''}
                      onChange={e => handleClientChange('nacionalidad', e.target.value)}
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
              </div>
              {selectedClient.tipoPersona === 'Natural' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-gray-50">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Profesión / Oficio</label>
                    <div className="relative">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <input type="text" value={selectedClient.profesion || ''}
                        onChange={e => handleClientChange('profesion', e.target.value)}
                        className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Rango de Sueldo</label>
                    <div className="relative">
                      <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <select value={selectedClient.sueldoRange || ''}
                        onChange={e => handleClientChange('sueldoRange', e.target.value)}
                        className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none appearance-none font-bold text-gray-700 text-sm">
                        <option value="">Seleccionar…</option>
                        {['<$1.0M','$1.0M - $2.0M','$2.0M - $3.5M','$3.5M - $5.0M','>$5.0M'].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Fecha Nacimiento</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <input type="date" value={selectedClient.fechaNacimiento || ''}
                        onChange={e => handleClientChange('fechaNacimiento', e.target.value)}
                        className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                  </div>
                </div>
              )}
              {selectedClient.tipoPersona === 'Juridica' && (
                <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100 space-y-6">
                  <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                    <UserCheck className="w-4 h-4" /> Datos del Representante Legal
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block">Nombre Representante</label>
                      <input type="text" value={selectedClient.representanteNombre || ''}
                        onChange={e => handleClientChange('representanteNombre', e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block">RUT Representante</label>
                      <input type="text" value={selectedClient.representanteRut || ''}
                        onChange={e => handleClientChange('representanteRut', e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 font-mono" />
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-6 border-t border-gray-50">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Dirección</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.direccion || ''}
                      onChange={e => handleClientChange('direccion', e.target.value)}
                      placeholder="Calle, número, depto…"
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Comuna</label>
                  <input type="text" value={selectedClient.comuna || ''}
                    onChange={e => handleClientChange('comuna', e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">Ciudad</label>
                  <input type="text" value={selectedClient.ciudad || ''}
                    onChange={e => handleClientChange('ciudad', e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
              </div>
            </div>

          <div className="flex justify-end pt-8 border-t border-gray-100">
            <button
              disabled={!selectedClient.nombre?.trim() || !selectedClient.rut?.trim()}
              onClick={async () => { await saveImmediately(); setStep(2); }}
              className="px-12 py-4 bg-blue-600 text-white font-black rounded-2xl disabled:opacity-50 hover:bg-blue-700 transition-all shadow-xl active:scale-95 uppercase tracking-widest text-xs">
              Continuar a Selección de Unidades
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: UNITS ───────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left picker */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white rounded-xl p-6 border border-gray-200">
                <h3 className="font-bold text-gray-800 mb-4">Inventario Disponible</h3>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input type="text" placeholder="Filtrar…" value={unitFilter}
                    onChange={e => setUnitFilter(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm outline-none" />
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {availableUnits.map(unit => {
                    const isSel = selectedUnits.some(u => u.id === unit.id);
                    const isOwnClient = !!selectedClient?.id && unit.clienteId === selectedClient.id;
                    return (
                      <button key={unit.id} onClick={() => toggleUnitSelection(unit)}
                        className={`w-full p-3 text-left rounded-xl border transition-all ${isSel ? 'border-blue-500 bg-blue-50' : isOwnClient ? 'border-blue-200 bg-blue-50/30 hover:border-blue-300' : 'border-gray-100 hover:border-gray-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-sm">{unit.type} {unit.numero}</div>
                          {isOwnClient && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 uppercase tracking-wide shrink-0">
                              Tu cliente
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-blue-600 font-bold">{formatUF(unit.precioLista)} UF</div>
                        {unit.type === 'Departamento' && (unit.bodegas.length + unit.estacionamientos.length) > 0 && (
                          <div className="text-[10px] text-gray-400 mt-1">
                            {unit.bodegas.length > 0 && `${unit.bodegas.length} bodega(s)`}
                            {unit.bodegas.length > 0 && unit.estacionamientos.length > 0 && ' · '}
                            {unit.estacionamientos.length > 0 && `${unit.estacionamientos.length} estac.`}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {detachedUnits.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                  <h4 className="text-xs font-black text-amber-700 uppercase tracking-widest mb-3 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Accesorios desvinculados
                  </h4>
                  {detachedUnits.map(u => (
                    <div key={u.id} className="flex items-center justify-between text-sm py-1">
                      <span className="text-amber-800 font-medium">{u.type} {u.numero}</span>
                      <button onClick={() => reattachAccessory(u.id)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-bold">
                        <RotateCcw className="w-3 h-3" /> Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: cart + adjustments + mortgage */}
            <div className="lg:col-span-8 bg-white rounded-xl p-6 border border-gray-200 flex flex-col">
              <h3 className="font-bold text-gray-800 mb-4">Unidades en Propuesta</h3>

              {selectedUnits.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 italic py-16">
                  Selecciona unidades del panel izquierdo.
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest px-2 pb-2 border-b border-gray-100">
                    <div className="col-span-3">Unidad</div>
                    <div className="col-span-2 text-right">P. Original</div>
                    <div className="col-span-5">Ajuste</div>
                    <div className="col-span-2 text-right">P. Final</div>
                  </div>

                  {selectedUnits.map(unit => {
                    const adj = adjustDrafts[unit.id];
                    const finalPrice = unitFinalPrice(unit, adjustDrafts);
                    const rawV = parseFloat(adj?.rawValue || '0') || 0;
                    const dr = discountRequests[unit.id];
                    const dcfg = effectiveDiscountConfig;
                    const maxVal = adj?.type === 'UF'
                      ? getMaxDescuentoUF(unit.precioLista, dcfg.supervisorMaxPct)
                      : dcfg.supervisorMaxPct;

                    return (
                      <div key={unit.id}
                        className={`grid grid-cols-12 gap-2 items-center py-2.5 px-2 rounded-lg ${unit.isAutoLoaded ? 'ml-4 bg-blue-50/40 border border-blue-100' : 'hover:bg-gray-50'}`}>
                        <div className="col-span-3">
                          <div className="flex items-center gap-1.5">
                            {unit.type === 'Departamento' ? <Building className="w-3.5 h-3.5 text-blue-500 shrink-0" /> :
                              unit.type === 'Estacionamiento' ? <Car className="w-3.5 h-3.5 text-gray-400 shrink-0" /> :
                                <Package className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                            <span className="font-bold text-xs text-gray-900 truncate">{unit.type} {unit.numero}</span>
                            {unit.isAutoLoaded && <span className="text-[8px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded font-black uppercase shrink-0">Auto</span>}
                          </div>
                          {dr && (
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block ${
                              dr.estado === 'Pendiente' || dr.estado === 'AprobadoJefe' ? 'bg-amber-100 text-amber-700' :
                              dr.estado === 'Aprobado' ? 'bg-green-100 text-green-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {dr.estado === 'Pendiente' ? 'Pend. Autorización' :
                               dr.estado === 'AprobadoJefe' ? 'Visado Jefe ✓' :
                               dr.estado === 'Aprobado' ? 'Autorizado ✓' : dr.estado}
                            </span>
                          )}
                        </div>

                        <div className="col-span-2 text-right">
                          <span className="font-mono text-xs text-gray-500">{formatUF(unit.precioLista)}</span>
                        </div>

                        <div className="col-span-5 flex items-center gap-1">
                          <div className="flex rounded border border-gray-200 overflow-hidden text-[9px] font-bold">
                            {(['%', 'UF'] as const).map(t => (
                              <button key={t}
                                onClick={() => setAdjustDrafts(prev => ({ ...prev, [unit.id]: { type: t, rawValue: prev[unit.id]?.rawValue || '', applied: false } }))}
                                className={`px-1.5 py-1 transition-colors ${(adj?.type || '%') === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                                {t}
                              </button>
                            ))}
                          </div>
                          <input type="number"
                            min="0"
                            max={maxVal}
                            step={adj?.type === 'UF' ? '1' : '0.1'}
                            placeholder={adj?.type === 'UF' ? 'ej: 150' : 'ej: 3'}
                            value={adj?.rawValue || ''}
                            onChange={e => setAdjustDrafts(prev => ({ ...prev, [unit.id]: { type: prev[unit.id]?.type || '%', rawValue: e.target.value, applied: false } }))}
                            className="w-16 px-1.5 py-1 text-xs border border-gray-200 rounded outline-none font-mono text-center" />
                          <button onClick={() => applyAdjustment(unit.id)} disabled={!adj?.rawValue}
                            className="px-1.5 py-1 text-[9px] bg-blue-600 text-white font-bold rounded disabled:opacity-40 hover:bg-blue-700">
                            OK
                          </button>
                          {adj?.applied && rawV > 0 && (
                            <>
                              <button onClick={() => resetAdjustment(unit.id)} className="p-0.5 text-gray-400 hover:text-red-500">
                                <X className="w-3 h-3" />
                              </button>
                              {/* Badge always red — always a discount (Paso 3) */}
                              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700">
                                {adj.type === '%' ? `-${rawV}%` : `-${formatUF(rawV)} UF`}
                              </span>
                            </>
                          )}
                        </div>
                        {discountError[unit.id] && (
                          <div className="col-span-12 mx-2 mt-1 px-2 py-1 bg-red-50 border border-red-100 rounded text-[9px] text-red-600 font-bold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" /> {discountError[unit.id]}
                          </div>
                        )}

                        <div className="col-span-2 flex items-center justify-end gap-0.5">
                          <span className={`font-mono text-sm font-bold ${adj?.applied && rawV > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                            {formatUF(finalPrice)}
                          </span>
                          {!unit.isAutoLoaded ? (
                            <button onClick={() => toggleUnitSelection(unit)} className="p-1 text-red-400 hover:bg-red-50 rounded ml-0.5"><Trash2 className="w-3 h-3" /></button>
                          ) : (
                            <button onClick={() => detachAccessory(unit.id)} className="p-1 text-gray-300 hover:text-red-400 rounded ml-0.5"><X className="w-3 h-3" /></button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Bono Pie (config interna, siempre visible si hay unidades) ─ */}
              {selectedUnits.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Bono Pie por Unidad</span>
                      {currentUser.role !== 'Ventas' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-gray-400 uppercase">% Bono Pie</span>
                          <input type="number" step="0.5" min="0" max="99" value={bonoPct}
                            onChange={e => setBonoPct(Number(e.target.value))}
                            className="w-14 p-1 border border-gray-200 rounded text-xs font-mono text-center outline-none focus:ring-2 focus:ring-blue-100" />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setBonoPieUnits(new Set(selectedUnits.map(u => u.id)))}
                          className="text-[10px] text-blue-500 font-bold hover:underline">Todos</button>
                        <span className="text-gray-300">·</span>
                        <button onClick={() => setBonoPieUnits(new Set())}
                          className="text-[10px] text-gray-400 font-bold hover:underline">Ninguno</button>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {selectedUnits.map(u => {
                        const hasBono = bonoPieUnits.has(u.id);
                        const calc = bonoPieBreakdown.perUnit.find(x => x.unit.id === u.id)?.calc;
                        return (
                          <label key={u.id}
                            className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${hasBono ? 'bg-blue-50/30' : ''}`}>
                            <input type="checkbox" checked={hasBono}
                              onChange={e => {
                                setBonoPieUnits(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(u.id); else next.delete(u.id);
                                  return next;
                                });
                              }}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <div className="flex-1 flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-700">
                                {u.type} {u.numero}
                                {u.isAutoLoaded && <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded font-black uppercase">Auto</span>}
                              </span>
                              {calc && (
                                <span className={`text-xs font-mono font-bold ${hasBono ? 'text-blue-600' : 'text-gray-400'}`}>
                                  {formatUF(hasBono ? calc.precioInflado : calc.base)} UF
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── BLOQUE 1: Forma de Pago ──────────────────────────────── */}
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setIncludePaymentPlan(v => !v)}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${includePaymentPlan ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                    {includePaymentPlan && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="font-bold text-sm text-gray-700">Incluir Forma de Pago</span>
                </label>

                {includePaymentPlan && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden ml-8">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Distribución del Pago</span>
                      {creditoPct >= 0
                        ? <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">100% ✓</span>
                        : <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Suma supera 100% ⚠️</span>
                      }
                    </div>
                    <div className="p-4 space-y-1.5 text-xs">
                      {/* Promesa */}
                      <div className="flex items-center gap-2">
                        <span className="w-44 shrink-0 text-gray-600">A la firma de Promesa</span>
                        <input type="number" step="0.1" min="0" max="100" value={promesaPct}
                          onChange={e => setPromesaPct(Number(e.target.value))}
                          className="w-16 p-1.5 border border-gray-200 rounded text-sm font-mono text-right outline-none" />
                        <span className="text-gray-400">%</span>
                        <span className="ml-auto font-mono font-bold text-gray-700">{formatUF(promesaUF)} UF</span>
                        {ufHoy && <span className="font-mono text-gray-400 ml-2">{formatCLP(promesaUF * ufHoy)}</span>}
                      </div>
                      {/* Cuotas */}
                      <div className="flex items-center gap-2">
                        <span className="w-44 shrink-0 text-gray-600">En cuotas</span>
                        <input type="number" step="0.1" min="0" max="100" value={cuotasPct}
                          onChange={e => setCuotasPct(Number(e.target.value))}
                          className="w-16 p-1.5 border border-gray-200 rounded text-sm font-mono text-right outline-none" />
                        <span className="text-gray-400">%</span>
                        <span className="ml-auto font-mono font-bold text-gray-700">{formatUF(cuotasUF)} UF</span>
                        {ufHoy && <span className="font-mono text-gray-400 ml-2">{formatCLP(cuotasUF * ufHoy)}</span>}
                      </div>
                      <div className="flex items-center gap-2 pl-4">
                        <span className="w-40 shrink-0 text-gray-400">En {nCuotasNew} cuota(s)</span>
                        <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 rounded px-2 py-1">
                          c/u {formatUF(cuotaIndividualUF)} UF — fijado por proyecto
                        </span>
                      </div>
                      {/* Escritura */}
                      <div className="flex items-center gap-2">
                        <span className="w-44 shrink-0 text-gray-600">A la firma de Escritura</span>
                        <input type="number" step="0.1" min="0" max="100" value={escrituraPct}
                          onChange={e => setEscrituraPct(Number(e.target.value))}
                          className="w-16 p-1.5 border border-gray-200 rounded text-sm font-mono text-right outline-none" />
                        <span className="text-gray-400">%</span>
                        <span className="ml-auto font-mono font-bold text-gray-700">{formatUF(escrituraUF)} UF</span>
                        {ufHoy && <span className="font-mono text-gray-400 ml-2">{formatCLP(escrituraUF * ufHoy)}</span>}
                      </div>
                      {/* Separador */}
                      <div className="border-t border-gray-100 my-1" />
                      {/* Crédito Banco (auto) */}
                      <div className="flex items-center gap-2">
                        <span className={`w-44 shrink-0 font-bold ${creditoPct < 0 ? 'text-red-600' : 'text-blue-700'}`}>Crédito Banco</span>
                        <div className={`w-16 p-1.5 border rounded text-sm font-mono text-right font-bold ${creditoPct < 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-blue-700'}`}>
                          {creditoPct.toFixed(1)}
                        </div>
                        <span className="text-gray-400">%</span>
                        <span className={`ml-auto font-mono font-bold ${creditoPct < 0 ? 'text-red-600' : 'text-blue-700'}`}>{formatUF(creditoUF)} UF</span>
                        {ufHoy && <span className={`font-mono ml-2 ${creditoPct < 0 ? 'text-red-400' : 'text-blue-400'}`}>{formatCLP(creditoUF * ufHoy)}</span>}
                      </div>
                      {/* Separador + Total */}
                      <div className="border-t border-gray-200 mt-1 pt-1.5">
                        <div className="flex items-center gap-2 font-bold">
                          <span className="w-44 shrink-0 text-gray-800">TOTAL</span>
                          <div className="w-16 p-1.5 bg-gray-50 border border-gray-200 rounded text-sm font-mono text-right text-gray-700">100</div>
                          <span className="text-gray-400">%</span>
                          <span className="ml-auto font-mono font-bold text-gray-900">{formatUF(precioVentaFinal)} UF</span>
                          {ufHoy && <span className="font-mono text-gray-500 ml-2">{formatCLP(precioVentaFinal * ufHoy)}</span>}
                        </div>
                      </div>
                      {creditoPct < 0 && (
                        <p className="text-xs text-red-600 font-bold flex items-center gap-1 pt-1">
                          <AlertCircle className="w-3 h-3 shrink-0" /> La suma supera 100%. Reduce los porcentajes.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── BLOQUE 2: Simulación Crédito Hipotecario ─────────────── */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setIncludeMortgageSimulation(v => !v)}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${includeMortgageSimulation ? 'bg-purple-600 border-purple-600' : 'border-gray-300 group-hover:border-purple-400'}`}>
                    {includeMortgageSimulation && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="font-bold text-sm text-gray-700">Incluir Simulación Crédito Hipotecario</span>
                </label>

                {includeMortgageSimulation && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden ml-8">
                    {/* Tasa anual + % Financiamiento — DENTRO del simulador */}
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest shrink-0">Tasa anual</span>
                        <input type="number" step="0.1" min="0" max="30" value={mortgageInputs.tasaAnual}
                          onChange={e => setMortgageInputs(p => ({ ...p, tasaAnual: Number(e.target.value) }))}
                          className="w-20 p-1.5 border border-gray-200 rounded-lg text-sm font-mono text-right outline-none focus:ring-2 focus:ring-purple-100" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest shrink-0">% Financ. Banco</span>
                        <input
                          type="number" step="0.1" min="0" max="100"
                          value={includePaymentPlan ? creditoPct : mortgageFinPct}
                          onChange={e => { if (!includePaymentPlan) setMortgageFinPct(Number(e.target.value)); }}
                          disabled={includePaymentPlan}
                          title={includePaymentPlan ? 'Tomado de Forma de Pago' : undefined}
                          className={`w-20 p-1.5 border rounded-lg text-sm font-mono text-right outline-none ${includePaymentPlan ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed text-gray-500' : 'border-gray-200 focus:ring-2 focus:ring-purple-100'}`}
                        />
                        <span className="text-xs text-gray-400">%</span>
                        {includePaymentPlan && <span className="text-[9px] text-gray-400 italic">de Forma de Pago</span>}
                      </div>
                      <span className="ml-auto text-[10px] text-gray-400">
                        Base: {formatUF((includePaymentPlan ? creditoUF : precioVentaFinal * mortgageFinPct / 100))} UF
                      </span>
                    </div>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50">
                          {['Plazo','Dividendo UF','Dividendo $','Renta mín. aprox.'].map(h => (
                            <th key={h} className={`px-4 py-2 font-black text-gray-500 text-[10px] uppercase ${h === 'Plazo' ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {dividendTable.map(r => (
                          <tr key={r.years} className="hover:bg-purple-50/20">
                            <td className="px-4 py-2.5 font-bold text-gray-800">{r.years} años</td>
                            <td className="px-4 py-2.5 text-right font-mono">{formatUF(r.divUF)}</td>
                            <td className="px-4 py-2.5 text-right font-mono">{r.divCLP ? formatCLP(r.divCLP) : '—'}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-green-700">{r.rentaMin ? formatCLP(r.rentaMin) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                      <p className="text-[9px] text-gray-400 italic">
                        Tasa {mortgageInputs.tasaAnual}% anual · Renta mín. = dividendo × 4{ufHoy ? ` · UF ${ufFecha}: ${formatCLP(ufHoy)}` : ''}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center">
                <div className="text-lg font-bold text-gray-900">
                  Total: {formatUF(totalFinal)} UF{ufHoy ? ` / ${formatCLP(totalFinal * ufHoy)}` : ''}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(1)}
                    className="px-6 py-3 border-2 border-gray-200 font-bold rounded-xl text-gray-500 hover:bg-gray-50 transition-all">
                    Atrás
                  </button>
                  <button disabled={selectedUnits.length === 0} onClick={() => setStep(3)}
                    className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl disabled:opacity-50 hover:bg-blue-700 transition-all shadow-lg active:scale-95">
                    Vista Previa
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 3: SUMMARY ─────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          {hasPendingDiscount && (
            <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <Lock className="w-5 h-5 text-amber-600" />
              <p className="text-sm text-amber-800 font-medium">
                Descuentos pendientes de autorización. PDF y correo bloqueados.
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-end print:hidden flex-wrap">
            {toastMsg && (
              <span className="px-4 py-3 text-green-700 bg-green-50 border border-green-200 font-bold flex items-center gap-2 text-sm rounded-xl">
                {toastMsg}
              </span>
            )}
            <button onClick={handleDownloadPDF} disabled={hasPendingDiscount}
              className="px-6 py-3 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl flex items-center gap-2 hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50">
              <Download className="w-4 h-4" /> Descargar PDF
            </button>
            <button onClick={handleSendEmail} disabled={isEmailSending || hasPendingDiscount || !selectedClient.email}
              className="px-6 py-3 bg-white border border-blue-200 text-blue-600 font-bold rounded-xl flex items-center gap-2 hover:bg-blue-50 transition-all shadow-sm disabled:opacity-50">
              {isEmailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : emailSent ? <Check className="w-4 h-4 text-green-600" /> : <Mail className="w-4 h-4" />}
              {isEmailSending ? 'Enviando…' : emailSent ? 'Enviado' : 'Enviar por Correo'}
            </button>
          </div>

          {/* ── Vista previa — estructura SSilva ──────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 max-w-4xl mx-auto shadow-2xl overflow-hidden quotation-document" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>

            {/* HEADER: Logo blanco izquierda + azul derecha con COTIZACIÓN */}
            <div className="flex overflow-hidden" style={{ height: '72px' }}>
              <div className="w-[140px] h-full bg-white flex items-center justify-center px-2 py-1 overflow-hidden shrink-0">
                <img src="/Danacorp.png" alt="Danacorp" className="max-w-full max-h-full object-contain"
                  onError={e => { const img = e.target as HTMLImageElement; img.style.display='none'; img.parentElement!.innerHTML='<span class="font-black text-blue-600 text-sm">DANACORP</span>'; }} />
              </div>
              <div className="flex-1 bg-blue-600 flex flex-col items-end justify-center pr-4 gap-0.5">
                <span className="text-white text-lg font-black tracking-wide">COTIZACIÓN</span>
                <span className="text-white text-xs font-bold">N° {quoteIdRef.current}</span>
                <span className="text-blue-200 text-[10px]">{new Date().toLocaleDateString('es-CL', { day:'numeric', month:'long', year:'numeric' })}</span>
              </div>
            </div>

            <div className="p-6 space-y-4 text-xs">

              {/* Señor(a) block */}
              <div className="space-y-0.5 text-sm leading-snug">
                <div>Señor(a)</div>
                <div className="font-bold">{selectedClient.nombre}</div>
                {selectedClient.rut && <div>Rut : {selectedClient.rut}</div>}
                {selectedClient.telefono && <div>Telefono : {selectedClient.telefono}</div>}
                {selectedClient.email && <div>Mail : {selectedClient.email}</div>}
                <div>Presente</div>
                <div className="pt-1" />
                <div className="font-bold">Estimado(a) cliente:</div>
                <div className="text-gray-600">
                  De acuerdo a lo solicitado, nos es muy grato cotizar por los inmuebles que se indican,
                  correspondientes al proyecto <strong>{currentProject?.nombre}</strong>
                  {(projectConfig as typeof projectConfig & { direccionProyecto?: string }).direccionProyecto ? `, ubicado en ${(projectConfig as typeof projectConfig & { direccionProyecto?: string }).direccionProyecto}` : ''}
                  {(projectConfig as typeof projectConfig & { comunaProyecto?: string }).comunaProyecto ? `, comuna de ${(projectConfig as typeof projectConfig & { comunaProyecto?: string }).comunaProyecto}` : ''}:
                </div>
              </div>

              {/* SECCIÓN 1: INMUEBLES — estilo asiento SSilva */}
              <div>
                <p className="font-black text-gray-700 text-sm mb-2">1.&nbsp; INMUEBLES</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="py-1 pr-2 text-left font-semibold text-gray-500">Tipo</th>
                      <th className="py-1 pr-2 text-left font-semibold text-gray-500">Número</th>
                      <th className="py-1 pr-2 text-left font-semibold text-gray-500">Ubicación</th>
                      <th className="py-1 text-right font-semibold text-gray-500 whitespace-nowrap">Valor UF</th>
                      {ufHoy && <th className="py-1 pl-3 text-right font-semibold text-gray-500 whitespace-nowrap">Valor $</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {selectedUnits.map(u => {
                      const calc = bonoPieBreakdown.perUnit.find(x => x.unit.id === u.id)?.calc;
                      const precioMostrado = calc ? calc.precioInflado : unitFinalPrice(u, adjustDrafts);
                      const dctoP = unitDiscountPct(u, adjustDrafts);
                      const hasDcto = dctoP > 0.001 && adjustDrafts[u.id]?.applied;
                      let tipoDesc = u.type;
                      if (u.type === 'Departamento' && u.dormitorios && u.banos) tipoDesc = `Departamento (${u.dormitorios}D-${u.banos}B)`;
                      return (
                        <tr key={u.id} className="border-b border-gray-50">
                          <td className="py-1.5 pr-2 text-gray-700">{tipoDesc}</td>
                          <td className="py-1.5 pr-2 font-bold text-gray-800 whitespace-nowrap">N°{u.numero}</td>
                          <td className="py-1.5 pr-2 text-gray-400">{u.piso ? `del Piso N° ${u.piso}` : ''}</td>
                          <td className="py-1.5 text-right font-mono font-bold text-gray-800 whitespace-nowrap">{formatUF(precioMostrado)} UF</td>
                          {ufHoy && <td className="py-1.5 pl-3 text-right font-mono text-gray-500 whitespace-nowrap">{formatCLP(precioMostrado * ufHoy)}</td>}
                          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                            {hasDcto && <span className="text-gray-400 italic text-[9px]">← -{dctoP.toFixed(0)}% dcto</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Separador + resumen */}
                    <tr className="border-t border-gray-300">
                      <td colSpan={6} className="py-0.5" />
                    </tr>
                    {bonoPieBreakdown.conBono.length > 0 && (() => {
                      const btL: string[] = [];
                      if (bonoPieBreakdown.conBono.some(x => x.unit.type === 'Departamento')) btL.push('Depto.');
                      if (bonoPieBreakdown.conBono.some(x => x.unit.type === 'Estacionamiento')) btL.push('Estac.');
                      if (bonoPieBreakdown.conBono.some(x => x.unit.type === 'Bodega')) btL.push('Bodega');
                      const label = btL.length === 1 ? `Bonificación ${bonoPct}% en ${btL[0]}` :
                        `Bonificación ${bonoPct}% en ${btL.slice(0,-1).join(', ')} y ${btL[btL.length-1]}`;
                      return (
                        <>
                          {/* PRECIO DE LISTA = suma de precios inflados */}
                          <tr>
                            <td colSpan={3} className="py-1 font-bold text-gray-700">PRECIO DE LISTA</td>
                            <td className="py-1 text-right font-bold font-mono text-gray-800 whitespace-nowrap">{formatUF(totalPrecioVentaSSilva)} UF</td>
                            {ufHoy && <td className="py-1 pl-3 text-right font-mono text-gray-500 whitespace-nowrap">{formatCLP(totalPrecioVentaSSilva * ufHoy)}</td>}
                            <td />
                          </tr>
                          {/* Bono Pie = monto que se descuenta */}
                          <tr>
                            <td colSpan={3} className="py-1 text-gray-500 italic">{label}</td>
                            <td className="py-1 text-right font-mono text-gray-500 whitespace-nowrap">{formatUF(bonoPieBreakdown.totalBonificacion)} UF</td>
                            {ufHoy && <td className="py-1 pl-3 text-right font-mono text-gray-400 whitespace-nowrap">{formatCLP(bonoPieBreakdown.totalBonificacion * ufHoy)}</td>}
                            <td />
                          </tr>
                          <tr className="border-t border-gray-300">
                            <td colSpan={6} className="py-0.5" />
                          </tr>
                        </>
                      );
                    })()}
                    {/* PRECIO DE VENTA = valor económico real */}
                    <tr>
                      <td colSpan={3} className="py-1.5 font-black text-blue-700">PRECIO DE VENTA</td>
                      <td className="py-1.5 text-right font-black font-mono text-blue-700 whitespace-nowrap">{formatUF(totalFinal)} UF</td>
                      {ufHoy && <td className="py-1.5 pl-3 text-right font-black font-mono text-blue-600 whitespace-nowrap">{formatCLP(totalFinal * ufHoy)}</td>}
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* SECCIÓN 2+3: Forma de pago + Dividendo — estilo asiento */}
              {(includePaymentPlan || includeMortgageSimulation) && (
                <>
                  {includePaymentPlan && <div>
                    <p className="font-black text-gray-700 text-sm mb-2">2.&nbsp; FORMA DE PAGO</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-300">
                          <th className="py-1 pr-2 text-left font-semibold text-gray-500">Concepto</th>
                          <th className="py-1 pr-2 text-right font-semibold text-gray-500">%</th>
                          <th className="py-1 pr-2 text-left font-semibold text-gray-500">Detalle</th>
                          <th className="py-1 text-right font-semibold text-gray-500 whitespace-nowrap">Valor UF</th>
                          {ufHoy && <th className="py-1 pl-3 text-right font-semibold text-gray-500 whitespace-nowrap">Valor $</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: 'A la firma de Promesa', pct: promesaPct, detail: '', uf: promesaUF, isBold: false },
                          { label: `En ${nCuotasNew} cuota(s)`, pct: cuotasPct, detail: `Cuota(s) de UF ${formatUF(cuotaIndividualUF)} c/u.`, uf: cuotasUF, isBold: false },
                          { label: 'A la firma de Escritura', pct: escrituraPct, detail: '', uf: escrituraUF, isBold: false },
                          { label: 'Crédito Inst. Financiera', pct: creditoPct, detail: '(*)', uf: creditoUF, isBold: true },
                        ].map(r => (
                          <tr key={r.label} className="border-b border-gray-50">
                            <td className={`py-1.5 pr-2 ${r.isBold ? 'font-bold text-blue-700' : 'text-gray-700'}`}>{r.label}</td>
                            <td className={`py-1.5 pr-2 font-mono whitespace-nowrap ${r.isBold ? 'font-bold text-blue-700' : 'text-gray-500'}`}>{r.pct.toFixed(2)}%</td>
                            <td className="py-1.5 pr-2 text-gray-400 italic">{r.detail}</td>
                            <td className={`py-1.5 text-right font-mono whitespace-nowrap ${r.isBold ? 'font-bold text-blue-700' : 'font-bold text-gray-800'}`}>{formatUF(r.uf)} UF</td>
                            {ufHoy && <td className={`py-1.5 pl-3 text-right font-mono whitespace-nowrap ${r.isBold ? 'text-blue-500' : 'text-gray-500'}`}>{formatCLP(r.uf * ufHoy)}{r.isBold?' (*)':''}</td>}
                          </tr>
                        ))}
                        <tr className="border-t border-gray-300">
                          <td colSpan={ufHoy ? 6 : 5} className="py-0.5" />
                        </tr>
                        <tr>
                          <td className="py-1.5 font-black text-gray-800"></td>
                          <td className="py-1.5 font-black font-mono text-gray-800">100,00%</td>
                          <td />
                          <td className="py-1.5 text-right font-black font-mono text-gray-900 whitespace-nowrap">{formatUF(precioVentaFinal)} UF</td>
                          {ufHoy && <td className="py-1.5 pl-3 text-right font-black font-mono text-gray-700 whitespace-nowrap">{formatCLP(precioVentaFinal * ufHoy)}</td>}
                        </tr>
                      </tbody>
                    </table>
                    <p className="text-[9px] text-gray-400 italic mt-1">
                      (*) El (la) cotizante declara conocer cuáles son los requerimientos exigidos para optar a un crédito o mutuo hipotecario y que las instituciones financieras los cursan con la tasa vigente a la fecha en que se formalice la compraventa.
                    </p>
                  </div>}

                  {/* SECCIÓN 4: Dividendo */}
                  {includeMortgageSimulation && <div>
                    <p className="font-black text-gray-700 text-sm mb-1">
                      {includePaymentPlan ? '3.' : '2.'}&nbsp; DIVIDENDO APROXIMADO REFERENCIAL
                    </p>
                    <p className="text-[10px] text-gray-500 mb-2">Calculado a la tasa referencial de este día, sin considerar seguros: {mortgageInputs.tasaAnual.toFixed(2)}%.</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-300">
                          {['Plazo Crédito','Dividendo UF','Dividendo $','Renta mínima aprox. $'].map(h=>(
                            <th key={h} className="py-1 text-right first:text-left font-black text-[10px] text-gray-600 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dividendTable.map(r=>(
                          <tr key={r.years} className="border-b border-gray-50">
                            <td className="py-1.5 font-bold text-gray-700">{r.years} años</td>
                            <td className="py-1.5 text-right font-mono text-gray-800">{formatUF(r.divUF)} UF</td>
                            <td className="py-1.5 text-right font-mono text-gray-600">{r.divCLP?formatCLP(r.divCLP):'—'}</td>
                            <td className="py-1.5 text-right font-mono text-green-700">{r.rentaMin?formatCLP(r.rentaMin):'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>}
                </>
              )}

              {/* BLOQUE: MONTO DE LA RESERVA + Notas Aclaratorias */}
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="font-black text-gray-700 text-sm mb-2">4.&nbsp; MONTO DE LA RESERVA</p>
                <div className="space-y-1 text-[10px] text-gray-700 leading-tight">
                  <p>.- Al concretar la decisión de compra, el cotizante deberá entregar $ {(reservaCLP || 300000).toLocaleString('es-CL')} que se imputarán íntegramente al pago de parte de los gastos operacionales que se generen por la compraventa. En caso que no firmara la respectiva promesa de compraventa, teniendo la pre aprobación o aprobación de un crédito, este monto se imputará por completo al pago de una multa penal compensatoria a favor de {projectConfig.nombreInmobiliaria || 'la Inmobiliaria'}.</p>
                  <p>.- La Inmobiliaria se reserva el derecho de gestionar el crédito hipotecario con las instituciones financieras que considere pertinentes. Para el efecto, el cliente deberá hacer entrega de todos los antecedentes que se soliciten.</p>
                  <p>.- El Número de cuotas para el pie en construcción es válido mientras la primera cuota cae en este mes.</p>
                  <p>.- Quedamos atentos a cualquier requerimiento adicional y dispuesto a aclararle cualquier duda. Nuestro objetivo es atenderlo con esmero y entregarle la información que usted requiere para que su decisión de compra y en definitiva su compra, se haga realidad. Agradecidos por su visita y confiados en poder atenderlo con el profesionalismo que su decisión de compra merece, le saludamos atentamente.</p>
                </div>
                <h4 className="font-bold text-gray-800 text-xs mt-3 mb-1">Notas Aclaratorias:</h4>
                <div className="space-y-0.5 text-[9px] text-gray-700 leading-tight">
                  <p>- Los montos en pesos corresponden al valor de la UF. a esta fecha, por lo cual se citan sólo como referencia.</p>
                  {ufHoy && <p className="ml-2">Valor de la UF al {ufFecha} es de ${ufHoy.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.</p>}
                  <p>- Cotización válida por {effectiveDiscountConfig.vigenciaCotizacionDias} días, según disponibilidad de los inmuebles.</p>
                  <p>- El valor indicado en pesos es sólo referencial y meramente demostrativo. Para efectos de cada pago se deberá considerar el valor equivalente en pesos al día de pago efectivo según la Unidad de Fomento correspondiente.</p>
                </div>
              </div>

              {/* Footer firma */}
              <div className="border-t-2 border-blue-200 pt-3 flex justify-between items-end text-[10px]">
                <div>
                  <div className="w-28 border-b border-gray-400 mb-1" />
                  <div className="font-bold text-gray-800">{currentUser.name}</div>
                  <div className="text-gray-500">{currentUser.company || currentProject?.nombre}</div>
                  {currentUser.email && <div className="text-gray-400">{currentUser.email}</div>}
                </div>
                <div className="text-gray-400">Generado por DanaWorks</div>
              </div>
            </div>
          </div>

          <div className="flex justify-between gap-4 max-w-4xl mx-auto print:hidden">
            <button onClick={() => setStep(2)}
              className="px-8 py-4 border-2 border-gray-200 font-black rounded-2xl text-gray-500 hover:bg-gray-50 transition-all uppercase tracking-widest text-xs">
              Regresar
            </button>
            <button onClick={handleFinalizeAndSave} disabled={hasPendingDiscount}
              className="px-12 py-4 bg-green-600 text-white font-black rounded-2xl shadow-xl hover:bg-green-700 transition-all active:scale-95 flex items-center gap-3 uppercase tracking-widest text-xs disabled:opacity-50">
              <Save className="w-5 h-5" /> Finalizar y Guardar en Ficha
            </button>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; background: white !important; }
          .quotation-document, .quotation-document * { visibility: visible; }
          .quotation-document { position: fixed; left: 0; top: 0; width: 100%; margin: 0; padding: 2cm; border: none; box-shadow: none; background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default Quoter;
