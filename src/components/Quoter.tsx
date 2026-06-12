import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RealEstateUnit, Client, User, Project, ClientDocument, DiscountConfig, ProjectConfig } from '../types';
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
    const precioInflado  = r(base * (1 + bonoPct / 100));
    const bonificacion   = r(base * bonoPct / 100);
    const pieUnidad      = r(precioInflado * piePct / 100);
    const montoAPagar    = r(pieUnidad - bonificacion);
    const porFinanciar   = r(precioInflado * finPct / 100);
    return { base, precioInflado, bonificacion, pieUnidad, montoAPagar, porFinanciar, hasBono: true };
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
}) => {
  // ── Step & Flow ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isFinalized, setIsFinalized] = useState(false);

  // ── Client ───────────────────────────────────────────────────────────────
  const [clientMode, setClientMode] = useState<'search' | 'create'>('create');
  const [clientSearch, setClientSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

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

  // ── Payment / Mortgage (C2) ──────────────────────────────────────────────
  // ── Bono pie per-unit (Paso 4) ───────────────────────────────────────────
  const [bonoPieUnits, setBonoPieUnits] = useState<Set<string>>(new Set());

  const [showMortgage, setShowMortgage] = useState(false);
  const [mortgageInputs, setMortgageInputs] = useState<MortgageInputs>({ tasaAnual: 4.5 });
  const [reservaCLP, setReservaCLP] = useState(0);
  const [pieCuotasDropdown, setPieCuotasDropdown] = useState<6 | 12 | 18 | 24 | 36 | 'Otro'>(12);
  const [pieCuotasManual, setPieCuotasManual] = useState(12);
  // includeBonoPie is derived — true when any unit has bono pie checked
  const [bonoPct, setBonoPct] = useState(10);
  const [finPct, setFinPct] = useState(80);
  const includeBonoPie = bonoPieUnits.size > 0;
  // Paso 1: piePct siempre complementario a finPct
  const piePct = 100 - finPct;

  // ── UF (BUG 2) ───────────────────────────────────────────────────────────
  const [ufHoy, setUfHoy] = useState<number | null>(null);
  const [ufFecha, setUfFecha] = useState('');

  // ── Drafts (C1) ──────────────────────────────────────────────────────────
  const [draftId, setDraftId] = useState<string | null>(null);
  // Punto 8: sync draftId → App.tsx activeDraftId on every change
  useEffect(() => { onDraftStateChange?.(draftId); }, [draftId, onDraftStateChange]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [isDraftLoading, setIsDraftLoading] = useState(false);

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
    fetch(`/api/sync/project_config_${currentProjectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((d: { value: ProjectConfig } | null) => {
        if (d?.value) {
          setProjectConfig(d.value);
          if (d.value.bonoPiePct != null) setBonoPct(d.value.bonoPiePct);
        }
      })
      .catch(() => {});
  }, [currentProjectId]);

  // ── Total cotizado (precio post-descuento de todas las unidades) ─────────
  const totalFinal = useMemo(
    () => selectedUnits.reduce((sum, u) => sum + unitFinalPrice(u, adjustDrafts), 0),
    [selectedUnits, adjustDrafts],
  );

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

  // ── Close suggestions on outside click ──────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── C1: Auto-save draft (BUG 3 fix: .trim()) ────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerAutoSave = useCallback(() => {
    // BUG 3 fix: use .trim() so empty strings don't satisfy the guard
    if (!currentProjectId ||
        (!selectedClient.nombre?.trim() && !selectedClient.rut?.trim())) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const token = localStorage.getItem('dw_token');
      if (!token) return;
      setIsSavingDraft(true);
      try {
        const payload = {
          id: draftId || undefined,
          projectId: currentProjectId,
          clienteRut: selectedClient.rut || '',
          clienteNombre: selectedClient.nombre || '',
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
                bonoPct, finPct,
              },
            },
          ],
          mortgageInputs,
          showMortgage,
        };
        const res = await fetch('/api/quotation-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
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
    }, 1500);
  }, [
    currentProjectId, selectedClient, selectedUnits, adjustDrafts,
    detachedAccessories, mortgageInputs, showMortgage,
    reservaCLP, pieCuotasDropdown, pieCuotasManual,
    bonoPieUnits, bonoPct, finPct, draftId, onDraftStateChange,
  ]);

  useEffect(() => { triggerAutoSave(); }, [
    selectedClient, selectedUnits, mortgageInputs, showMortgage,
    adjustDrafts, reservaCLP, pieCuotasDropdown, pieCuotasManual,
    bonoPieUnits, bonoPct, finPct,
  ]);

  useEffect(() => {
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, []);

  // ── C1: Load drafts list ─────────────────────────────────────────────────
  const loadDraftsList = useCallback(async () => {
    const token = localStorage.getItem('dw_token');
    if (!token) return;
    try {
      const res = await fetch('/api/quotation-drafts', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setDrafts(await res.json() as DraftSummary[]);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { loadDraftsList(); }, [loadDraftsList]);

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
      if (d.showMortgage != null) setShowMortgage(d.showMortgage as boolean);
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
        if (pc.finPct != null) setFinPct(pc.finPct as number);
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

  // ── Dividend table — base = totalPorFinanciar (Paso 7) ──────────────────
  const dividendTable = useMemo(() =>
    [20, 25, 30].map(years => {
      const divUF = calcDividendo(bonoPieBreakdown.totalPorFinanciar, mortgageInputs.tasaAnual, years);
      const divCLP = ufHoy ? divUF * ufHoy : null;
      return { years, divUF, divCLP, rentaMin: divCLP ? divCLP * 4 : null };
    }),
    [bonoPieBreakdown.totalPorFinanciar, mortgageInputs.tasaAnual, ufHoy],
  );

  // ── Available units ──────────────────────────────────────────────────────
  const availableUnits = useMemo(() => {
    const candidates = units.filter(u => u.estado === 'Disponible' || u.estado === 'Libre Asignación');
    if (!unitFilter) return candidates;
    const lf = unitFilter.toLowerCase();
    return candidates.filter(u =>
      u.numero.toLowerCase().includes(lf) || u.type.toLowerCase().includes(lf),
    );
  }, [units, unitFilter]);

  const detachedUnits = useMemo(
    () => units.filter(u => detachedAccessories.includes(u.id)),
    [units, detachedAccessories],
  );

  // ── Client helpers ───────────────────────────────────────────────────────
  const clientSuggestions = useMemo(() => {
    if (!clientSearch || clientSearch.length < 2) return [];
    const term = clientSearch.toLowerCase();
    return clients.filter(c => {
      const match = c.nombre.toLowerCase().includes(term) || c.rut.toLowerCase().includes(term);
      if (currentUser.role === 'Ventas')
        return match && (c.estado !== 'Activo' || c.ejecutivoId === currentUser.id);
      return match;
    }).slice(0, 5);
  }, [clientSearch, clients, currentUser]);

  const handleSelectSuggestedClient = (client: Client) => {
    setSelectedClient(client); setClientSearch(client.nombre); setShowSuggestions(false);
  };

  const handleClientSearch = () => {
    const found = clients.find(c => {
      const match = c.rut.includes(clientSearch) || c.nombre.toLowerCase().includes(clientSearch.toLowerCase());
      if (currentUser.role === 'Ventas')
        return match && (c.estado !== 'Activo' || c.ejecutivoId === currentUser.id);
      return match;
    });
    if (found) { setSelectedClient(found); setShowSuggestions(false); }
    else alert('Cliente no encontrado o bajo gestión privada de otro ejecutivo.');
  };

  const handleClientChange = (field: keyof Client, value: unknown) =>
    setSelectedClient(prev => ({ ...(prev || {}), [field]: value }));

  const initNewClient = () => { setSelectedClient(emptyClient); setClientSearch(''); };

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

  // ── C4: PDF generation (compacto — CAMBIO 3+4) ──────────────────────────
  const generatePDFBlob = async (): Promise<Blob | null> => {
    if (!selectedClient || !currentProject) return null;
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 10;
    const pageWidth = 210;
    const contentWidth = pageWidth - margin * 2;
    // Compactar tablas: padding reducido
    const tStyles = { fontSize: 6, cellPadding: 1.5 };
    const thStyles = { fillColor: [37, 99, 235] as [number,number,number], fontSize: 6, fontStyle: 'bold' as const, cellPadding: 1.5 };
    const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // ── Header: logo izquierda + fondo azul sólido derecha (sin portada.jpg) ──
    const HEADER_H = 18; // mm
    const LOGO_W = 38;   // mm

    // Fondo azul completo del header
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, HEADER_H, 'F');

    // Logo Danacorp a la izquierda — fondo blanco, proporciones naturales
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, LOGO_W + margin, HEADER_H, 'F');
    try {
      const logoB64 = await loadImgB64('/Danacorp.png');
      if (!logoB64) throw new Error('logo null');
      // Obtener dimensiones reales para mantener proporción
      const logoImg = new window.Image();
      await new Promise<void>(resolve => {
        logoImg.onload = logoImg.onerror = () => resolve();
        logoImg.src = logoB64;
      });
      const logoAreaWidth = LOGO_W;     // mm — ancho del área blanca
      const logoAreaHeight = HEADER_H;  // mm — alto del área blanca
      const lgMg = 2;                   // mm — margen alrededor

      const availableW = logoAreaWidth - 2 * lgMg;
      const availableH = logoAreaHeight - 2 * lgMg;

      const ar = logoImg.naturalWidth > 0 ? logoImg.naturalWidth / logoImg.naturalHeight : 3;
      const containerRatio = availableW / availableH;

      let lw: number, lh: number;
      if (ar > containerRatio) {
        // Logo más ancho: restringir por ancho
        lw = availableW;
        lh = lw / ar;
      } else {
        // Logo más alto (o cuadrado): restringir por alto
        lh = availableH;
        lw = lh * ar;
      }

      // Centrar dentro del área blanca completa
      const lx = lgMg + (availableW - lw) / 2;
      const ly = lgMg + (availableH - lh) / 2;
      doc.addImage(logoB64, 'PNG', lx, ly, lw, lh);
    } catch {
      doc.setTextColor(37, 99, 235);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('DANACORP', (LOGO_W + margin) / 2, HEADER_H / 2 + 2, { align: 'center' });
    }

    // Texto N° cotización sobre el área azul a la derecha
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(`COT. N° ${quoteIdRef.current}`, pageWidth - margin, HEADER_H - 3, { align: 'right' });

    let y = HEADER_H + 3;

    // ── Fila: datos cliente + proyecto (compacta, una sola línea por campo)
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);

    // Columna izquierda: cliente
    doc.text('DESTINATARIO', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const clientLines = [
      selectedClient.nombre || '',
      `RUT: ${selectedClient.rut || ''}`,
      selectedClient.email || '',
    ].filter(Boolean);
    clientLines.forEach(line => { y += 3.5; doc.text(line, margin, y); });

    // Columna derecha: proyecto
    const projX = pageWidth / 2 + 5;
    let py = HEADER_H + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('PROYECTO', projX, py);
    doc.setFont('helvetica', 'normal');
    [
      currentProject.nombre,
      `Ejecutivo: ${currentUser.name}`,
      `Fecha: ${new Date().toLocaleDateString('es-CL')}`,
      ufHoy ? `UF ${ufFecha}: ${formatCLP(ufHoy)}` : '',
    ].filter(Boolean).forEach(line => { py += 3.5; doc.text(line, projX, py); });

    // Cotización Formal title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(37, 99, 235);
    const titleY = Math.max(y, py) + 4;
    doc.text('COTIZACIÓN FORMAL', margin, titleY);
    doc.setTextColor(30, 30, 30);
    y = titleY + 2;

    // Línea separadora
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;

    // ── Section 1: Inmuebles ─────────────────────────────────────────────
    doc.setFillColor(240, 240, 250);
    doc.rect(margin, y, contentWidth, 4.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(37, 99, 235);
    doc.text('INMUEBLES', margin + 1, y + 3);
    doc.setTextColor(30, 30, 30);
    y += 5;

    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [['Tipo', 'Unidad', 'Sup. (m²)', 'Piso', 'Orientación']],
      body: selectedUnits.map(u => [
        u.type, u.numero,
        u.superficie?.toString() || '—', u.piso?.toString() || '—', u.orientacion || '—',
      ]),
      headStyles: thStyles,
      bodyStyles: tStyles,
      alternateRowStyles: { fillColor: [249, 249, 255] },
      theme: 'grid',
    });
    y = lastY() + 3;

    // ── Section 2: Precios ───────────────────────────────────────────────
    if (y > 240) { doc.addPage(); y = margin; }
    doc.setFillColor(240, 240, 250);
    doc.rect(margin, y, contentWidth, 4.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(37, 99, 235);
    doc.text('PRECIOS', margin + 1, y + 3);
    doc.setTextColor(30, 30, 30);
    y += 5;

    const colH = ['Unidad', 'P. Lista (UF)', 'Desc.', 'Total (UF)', ...(ufHoy ? ['Total ($)'] : [])];
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [colH],
      body: [
        ...selectedUnits.map(u => {
          const fp = unitFinalPrice(u, adjustDrafts);
          const dp = unitDiscountPct(u, adjustDrafts);
          return [
            `${u.type} ${u.numero}`, formatUF(u.precioLista),
            dp > 0 ? `-${dp.toFixed(1)}%` : '—', formatUF(fp),
            ...(ufHoy ? [formatCLP(fp * ufHoy)] : []),
          ];
        }),
        [
          { content: 'TOTAL', styles: { fontStyle: 'bold' } },
          { content: formatUF(selectedUnits.reduce((s, u) => s + u.precioLista, 0)), styles: { fontStyle: 'bold' } },
          '—',
          { content: formatUF(totalFinal), styles: { fontStyle: 'bold', textColor: [37,99,235] as [number,number,number] } },
          ...(ufHoy ? [{ content: formatCLP(totalFinal * ufHoy), styles: { fontStyle: 'bold', textColor: [37,99,235] as [number,number,number] } }] : []),
        ],
      ],
      headStyles: thStyles,
      bodyStyles: tStyles,
      alternateRowStyles: { fillColor: [249, 249, 255] },
      theme: 'grid',
    });
    y = lastY() + 3;

    // ── Section 3: Forma de pago ─────────────────────────────────────────
    if (showMortgage) {
      if (y > 240) { doc.addPage(); y = margin; }
      doc.setFillColor(240, 240, 250);
      doc.rect(margin, y, contentWidth, 4.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(37, 99, 235);
      doc.text('FORMA DE PAGO', margin + 1, y + 3);
      doc.setTextColor(30, 30, 30);
      y += 5;

      const bd = bonoPieBreakdown;
      const rows: unknown[][] = [];
      if (reservaCLP > 0) rows.push(['Reserva', '—', '—', formatCLP(reservaCLP)]);

      if (bd.conBono.length > 0 && bd.sinBono.length > 0) {
        rows.push([{ content: 'Con bono pie', styles: { fontStyle: 'bold', textColor: [37,99,235] as [number,number,number] } }, '', '', '']);
        rows.push(['  Valor Total', `${bonoPct}%`, formatUF(bd.conBono.reduce((s,x)=>s+x.calc.precioInflado,0)), '']);
        rows.push(['  Bonificación', '', `- ${formatUF(bd.conBono.reduce((s,x)=>s+x.calc.bonificacion,0))}`, '']);
        rows.push(['  Monto a Pagar', '', formatUF(bd.conBono.reduce((s,x)=>s+x.calc.montoAPagar,0)), '']);
        rows.push(['  Crédito Hipotecario', `${finPct}%`, formatUF(bd.conBono.reduce((s,x)=>s+x.calc.porFinanciar,0)), '']);
        rows.push([{ content: 'Sin bono pie', styles: { fontStyle: 'bold' } }, '', '', '']);
        rows.push(['  Monto a Pagar', `${piePct}%`, formatUF(bd.sinBono.reduce((s,x)=>s+x.calc.montoAPagar,0)), '']);
        rows.push(['  Crédito Hipotecario', `${finPct}%`, formatUF(bd.sinBono.reduce((s,x)=>s+x.calc.porFinanciar,0)), '']);
      } else if (includeBonoPie) {
        rows.push(['Valor Total Unidades', `${bonoPct}%`, formatUF(bd.totalPrecioInflado), ufHoy ? formatCLP(bd.totalPrecioInflado * ufHoy) : '—']);
        rows.push(['Bonificación', '', `- ${formatUF(bd.totalBonificacion)}`, '']);
        rows.push(['Monto a Pagar', '', formatUF(bd.totalMontoAPagar), ufHoy ? formatCLP(bd.totalMontoAPagar * ufHoy) : '—']);
      } else {
        rows.push([`Monto a Pagar (pie ${piePct}%)`, '', formatUF(bd.totalMontoAPagar), ufHoy ? formatCLP(bd.totalMontoAPagar * ufHoy) : '—']);
      }
      rows.push([`Plan: ${nCuotas} cuotas de ${formatUF(montoPorCuota)} UF`, '', '', '']);
      rows.push([
        { content: 'Crédito Hipotecario', styles: { fontStyle: 'bold' } },
        { content: `${finPct}%`, styles: { fontStyle: 'bold' } },
        { content: formatUF(bd.totalPorFinanciar), styles: { fontStyle: 'bold', textColor: [37,99,235] as [number,number,number] } },
        { content: ufHoy ? formatCLP(bd.totalPorFinanciar * ufHoy) : '—', styles: { fontStyle: 'bold', textColor: [37,99,235] as [number,number,number] } },
      ]);

      autoTable(doc, {
        startY: y, margin: { left: margin, right: margin },
        head: [['Concepto', '%', 'UF', '$']],
        body: rows,
        headStyles: thStyles,
        bodyStyles: tStyles,
        theme: 'grid',
      });
      y = lastY() + 3;

      // ── Section 4: Dividendo ──────────────────────────────────────────
      if (y > 240) { doc.addPage(); y = margin; }
      doc.setFillColor(240, 240, 250);
      doc.rect(margin, y, contentWidth, 4.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(37, 99, 235);
      doc.text('DIVIDENDO REFERENCIAL', margin + 1, y + 3);
      doc.setTextColor(30, 30, 30);
      y += 5;

      autoTable(doc, {
        startY: y, margin: { left: margin, right: margin },
        head: [['Plazo', 'UF/mes', '$/mes', 'Renta Mín.']],
        body: dividendTable.map(r => [
          `${r.years} años`, formatUF(r.divUF),
          r.divCLP ? formatCLP(r.divCLP) : '—',
          r.rentaMin ? formatCLP(r.rentaMin) : '—',
        ]),
        headStyles: thStyles,
        bodyStyles: tStyles,
        theme: 'grid',
      });
      y = lastY() + 3;

      if (includeBonoPie && bonoPieBreakdown.conBono.length > 0) {
        doc.setFontSize(5.5);
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'italic');
        doc.text(
          `Bono pie: ${bonoPieBreakdown.conBono.map(x => `${x.unit.type} ${x.unit.numero}`).join(', ')}`,
          margin, y,
        );
        y += 3;
      }
    }

    // ── Footer en todas las páginas ──────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const h = doc.internal.pageSize.getHeight();
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.3);
      doc.line(margin, h - 10, pageWidth - margin, h - 10);
      doc.setFontSize(5.5);
      doc.setTextColor(120, 120, 120);
      doc.setFont('helvetica', 'normal');
      doc.text('Generado por DanaWorks', margin, h - 7);
      doc.text(`Ejecutivo: ${currentUser.name}`, pageWidth / 2, h - 7, { align: 'center' });
      doc.text(`Pág. ${i}/${pageCount}`, pageWidth - margin, h - 7, { align: 'right' });
      const ufNote = ufHoy
        ? `UF del ${ufFecha}: ${formatCLP(ufHoy)} · Simulación referencial con tasa ${mortgageInputs.tasaAnual}% anual · Cotización válida 7 días`
        : `Simulación referencial con tasa ${mortgageInputs.tasaAnual}% anual · Cotización válida 7 días`;
      doc.text(ufNote, margin, h - 4, { maxWidth: contentWidth });
    }

    return doc.output('blob');
  };

  const handleDownloadPDF = async () => {
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
    setIsEmailSending(true);
    setEmailSent(false);
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
      const token = localStorage.getItem('dw_token');
      if (token) {
        await fetch(`/api/quotation-drafts/${draftId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
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
    setShowMortgage(false); setBonoPieUnits(new Set());
    setMortgageInputs({ tasaAnual: 4.5 });
    setReservaCLP(0); setPieCuotasDropdown(12); setPieCuotasManual(12);
    setEmailSent(false); setDraftId(null);
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
  const DraftModal = () => (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">Borradores guardados</h3>
          <button onClick={() => setShowDraftModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {drafts.length === 0 ? (
            <p className="text-center text-gray-400 italic py-8">Sin borradores guardados.</p>
          ) : drafts.map(d => (
            <div key={d.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:border-blue-200 transition-all">
              <div>
                <div className="font-bold text-gray-900 text-sm">{d.clienteNombre || 'Sin nombre'}</div>
                <div className="text-xs text-gray-400 font-mono">{d.clienteRut || '—'}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{new Date(d.updated_at).toLocaleString('es-CL')}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => loadDraft(d)} disabled={isDraftLoading}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors">
                  Continuar
                </button>
                <button onClick={() => deleteDraft(d.id)}
                  className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

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
                  {s}. {['Cliente', 'Unidades', 'Resumen'][i]}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* ── STEP 1: CLIENT ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-8">
          <div className="flex gap-4 border-b border-gray-100 pb-2">
            <button onClick={() => { setClientMode('create'); initNewClient(); }}
              className={`pb-4 px-2 text-sm font-bold transition-all ${clientMode === 'create' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}>
              Nuevo Prospecto
            </button>
            <button onClick={() => setClientMode('search')}
              className={`pb-4 px-2 text-sm font-bold transition-all ${clientMode === 'search' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}>
              Cliente Existente
            </button>
          </div>

          {clientMode === 'search' ? (
            <div className="relative" ref={searchWrapperRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input type="text" placeholder="Buscar por RUT o nombre… (selecciona del dropdown)"
                  value={clientSearch}
                  onChange={e => { setClientSearch(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  className="w-full pl-10 p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 font-medium" />
              </div>
              {showSuggestions && clientSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
                  {clientSuggestions.map(s => (
                    <button key={s.id} onClick={() => handleSelectSuggestedClient(s)}
                      className="w-full text-left px-5 py-4 hover:bg-blue-50 flex items-center justify-between border-b border-gray-50 last:border-none">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600"><UserIcon className="w-5 h-5" /></div>
                        <div><div className="font-bold text-gray-900">{s.nombre}</div><div className="text-xs text-gray-500 font-mono">{s.rut}</div></div>
                      </div>
                      <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded font-bold uppercase">{s.estado}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedClient.id && (
                <div className="mt-8 p-6 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold">{selectedClient.nombre?.charAt(0)}</div>
                    <div>
                      <p className="text-xs font-black text-blue-600 uppercase tracking-widest mb-0.5">Cliente Seleccionado</p>
                      <h4 className="font-bold text-lg">{selectedClient.nombre}</h4>
                      <p className="text-sm text-gray-500">{selectedClient.rut} · {selectedClient.email}</p>
                    </div>
                  </div>
                  <button onClick={initNewClient} className="p-2 text-gray-400 hover:text-red-500 rounded-lg"><X className="w-6 h-6" /></button>
                </div>
              )}
            </div>
          ) : (
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
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.nombre || ''}
                      onChange={e => handleClientChange('nombre', e.target.value)} placeholder="Ej: Juan Pérez"
                      className="w-full pl-10 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-1.5 block tracking-widest">RUT *</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="text" value={selectedClient.rut || ''}
                      onChange={e => handleClientChange('rut', e.target.value)} placeholder="12.345.678-9"
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
          )}

          <div className="flex justify-end pt-8 border-t border-gray-100">
            <button
              disabled={!selectedClient.nombre?.trim() || !selectedClient.rut?.trim()}
              onClick={() => setStep(2)}
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
                    return (
                      <button key={unit.id} onClick={() => toggleUnitSelection(unit)}
                        className={`w-full p-3 text-left rounded-xl border transition-all ${isSel ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                        <div className="font-bold text-sm">{unit.type} {unit.numero}</div>
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

              {/* ── Mortgage (C2) ──────────────────────────────────────── */}
              <div className="mt-6 pt-4 border-t border-gray-100 space-y-4">
                <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setShowMortgage(v => !v)}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${showMortgage ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                    {showMortgage && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="font-bold text-sm text-gray-700">Incluir simulación de crédito hipotecario</span>
                </label>

                {showMortgage && (
                  <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-5 space-y-5">

                    {/* ── Inputs base (Cambio 1: % Pie eliminado, deriva de finPct) ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Reserva ($CLP)</label>
                        <input type="number" step="1000" value={reservaCLP || ''}
                          onChange={e => setReservaCLP(Number(e.target.value))}
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 font-mono" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Cuotas del pie</label>
                        <select value={pieCuotasDropdown}
                          onChange={e => setPieCuotasDropdown(e.target.value === 'Otro' ? 'Otro' : Number(e.target.value) as 6|12|18|24|36)}
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none">
                          {[6, 12, 18, 24, 36].map(n => <option key={n} value={n}>{n}</option>)}
                          <option value="Otro">Otro</option>
                        </select>
                        {pieCuotasDropdown === 'Otro' && (
                          <input type="number" value={pieCuotasManual}
                            onChange={e => setPieCuotasManual(Number(e.target.value))}
                            className="mt-1.5 w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none font-mono" />
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Tasa anual (%)</label>
                        <input type="number" step="0.1" value={mortgageInputs.tasaAnual}
                          onChange={e => setMortgageInputs(p => ({ ...p, tasaAnual: Number(e.target.value) }))}
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100 font-mono" />
                      </div>
                    </div>

                    {/* % Financiamiento + info pie derivado */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">% Financiamiento banco</label>
                        <input type="number" step="1" min="0" max="100" value={finPct}
                          onChange={e => setFinPct(Number(e.target.value))}
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none font-mono" />
                      </div>
                      <div className="flex flex-col justify-center">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">% Pie (derivado)</label>
                        <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono font-bold text-gray-700">
                          {piePct}%
                        </div>
                      </div>
                    </div>

                    {/* ── Bono Pie: config + checkboxes por unidad ── */}
                    {selectedUnits.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                          <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Bono Pie por Unidad</span>
                          {/* bonoPct config — visible para Admin/JefeSala */}
                          {currentUser.role !== 'Ventas' && (
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] font-black text-gray-500 uppercase">% Bono Pie</label>
                              <input type="number" step="0.5" min="0" max="99" value={bonoPct}
                                onChange={e => setBonoPct(Number(e.target.value))}
                                className="w-16 p-1.5 border border-gray-200 rounded-lg text-xs font-mono text-center outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => setBonoPieUnits(new Set(selectedUnits.map(u => u.id)))}
                              className="text-[10px] text-blue-600 font-bold hover:underline">
                              Todos
                            </button>
                            <span className="text-gray-300">·</span>
                            <button
                              onClick={() => setBonoPieUnits(new Set())}
                              className="text-[10px] text-gray-500 font-bold hover:underline">
                              Ninguno
                            </button>
                          </div>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {selectedUnits.map(u => {
                            const hasBono = bonoPieUnits.has(u.id);
                            const calc = bonoPieBreakdown.perUnit.find(x => x.unit.id === u.id)?.calc;
                            return (
                              <label key={u.id}
                                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${hasBono ? 'bg-blue-50/30' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={hasBono}
                                  onChange={e => {
                                    setBonoPieUnits(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(u.id);
                                      else next.delete(u.id);
                                      return next;
                                    });
                                  }}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <div className="flex-1 flex items-center justify-between">
                                  <span className="text-sm font-medium text-gray-800">
                                    {u.type} {u.numero}
                                    {u.isAutoLoaded && <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded font-black uppercase">Auto</span>}
                                  </span>
                                  {calc && (
                                    <span className={`text-xs font-mono font-bold ${hasBono ? 'text-blue-600' : 'text-gray-400'}`}>
                                      {hasBono ? formatUF(calc.precioInflado) : formatUF(calc.base)} UF
                                    </span>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── Paso 10: Desglose Forma de Pago ──────────────── */}
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Forma de Pago</span>
                      </div>
                      <div className="p-4 space-y-2 text-sm">
                        {reservaCLP > 0 && (
                          <div className="flex justify-between text-gray-600">
                            <span>Reserva</span><span className="font-bold">{formatCLP(reservaCLP)}</span>
                          </div>
                        )}

                        {/* Caso mixto: algunos con bono, otros sin */}
                        {bonoPieBreakdown.conBono.length > 0 && bonoPieBreakdown.sinBono.length > 0 ? (
                          <>
                            <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest pt-1">Unidades con bono pie ({bonoPct}%)</div>
                            {[
                              { label: 'Valor Total', val: bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.precioInflado,0) },
                              { label: `Pie (${piePct}%)`, val: bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.pieUnidad,0) },
                              { label: 'Bonificación', val: bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.bonificacion,0) },
                              { label: 'Monto a Pagar', val: bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.montoAPagar,0), bold: true },
                              { label: 'Crédito Hipotecario', val: bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.porFinanciar,0), blue: true },
                            ].map(r => (
                              <div key={r.label} className={`flex justify-between ml-3 ${r.bold ? 'font-bold' : ''} ${r.blue ? 'text-blue-700 font-bold' : 'text-gray-600'}`}>
                                <span>{r.label}</span><span className="font-mono">{formatUF(r.val)} UF</span>
                              </div>
                            ))}
                            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest pt-2 border-t border-gray-100">Unidades sin bono pie</div>
                            {[
                              { label: 'Precio', val: bonoPieBreakdown.sinBono.reduce((s,x)=>s+x.calc.base,0) },
                              { label: `Pie (${piePct}%)`, val: bonoPieBreakdown.sinBono.reduce((s,x)=>s+x.calc.pieUnidad,0), bold: true },
                              { label: 'Crédito Hipotecario', val: bonoPieBreakdown.sinBono.reduce((s,x)=>s+x.calc.porFinanciar,0), blue: true },
                            ].map(r => (
                              <div key={r.label} className={`flex justify-between ml-3 ${r.bold ? 'font-bold' : ''} ${r.blue ? 'text-blue-700 font-bold' : 'text-gray-600'}`}>
                                <span>{r.label}</span><span className="font-mono">{formatUF(r.val)} UF</span>
                              </div>
                            ))}
                            <div className="border-t border-gray-200 pt-2 mt-1 space-y-1">
                              <div className="flex justify-between font-black text-gray-900">
                                <span>TOTAL Monto a Pagar</span>
                                <span className="font-mono">{formatUF(bonoPieBreakdown.totalMontoAPagar)} UF</span>
                              </div>
                              <div className="flex justify-between font-black text-blue-700">
                                <span>TOTAL Crédito Hipotecario</span>
                                <span className="font-mono">{formatUF(bonoPieBreakdown.totalPorFinanciar)} UF{ufHoy ? ` / ${formatCLP(bonoPieBreakdown.totalPorFinanciar * ufHoy)}` : ''}</span>
                              </div>
                            </div>
                          </>
                        ) : includeBonoPie ? (
                          /* Todas con bono pie */
                          <>
                            <div className="flex justify-between text-gray-600">
                              <span>Valor Total</span>
                              <span className="font-bold font-mono">{formatUF(bonoPieBreakdown.totalPrecioInflado)} UF</span>
                            </div>
                            <div className="flex justify-between text-gray-600">
                              <span>Pie ({piePct}%)</span>
                              <span className="font-mono">{formatUF(bonoPieBreakdown.totalPie)} UF</span>
                            </div>
                            <div className="flex justify-between text-gray-600">
                              <span>Bonificación Bono Pie</span>
                              <span className="font-mono text-green-700">- {formatUF(bonoPieBreakdown.totalBonificacion)} UF</span>
                            </div>
                            <div className="flex justify-between font-bold pt-1 border-t border-gray-100">
                              <span>Monto a Pagar</span>
                              <span className="font-mono">{formatUF(bonoPieBreakdown.totalMontoAPagar)} UF</span>
                            </div>
                            <div className="flex justify-between font-bold text-blue-700">
                              <span>Crédito Hipotecario</span>
                              <span className="font-mono">{formatUF(bonoPieBreakdown.totalPorFinanciar)} UF{ufHoy ? ` / ${formatCLP(bonoPieBreakdown.totalPorFinanciar * ufHoy)}` : ''}</span>
                            </div>
                          </>
                        ) : (
                          /* Sin bono pie */
                          <>
                            <div className="flex justify-between text-gray-600">
                              <span>Pie ({piePct}%)</span>
                              <span className="font-bold font-mono">{formatUF(bonoPieBreakdown.totalMontoAPagar)} UF</span>
                            </div>
                            <div className="flex justify-between font-bold text-blue-700 pt-1 border-t border-gray-100">
                              <span>Crédito Hipotecario</span>
                              <span className="font-mono">{formatUF(bonoPieBreakdown.totalPorFinanciar)} UF{ufHoy ? ` / ${formatCLP(bonoPieBreakdown.totalPorFinanciar * ufHoy)}` : ''}</span>
                            </div>
                          </>
                        )}

                        {/* Plan de pago — base = totalMontoAPagar (Paso 7) */}
                        <div className="bg-blue-50 rounded-lg p-3 mt-2 flex justify-between items-center">
                          <span className="text-xs font-black text-blue-700 uppercase tracking-widest">Plan de Pago</span>
                          <span className="text-sm font-bold text-blue-800">
                            {nCuotas} cuotas de {formatUF(montoPorCuota)} UF
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ── Dividendo hipotecario (base = totalPorFinanciar) ── */}
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Dividendo Aproximado Referencial</span>
                      </div>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            {['Plazo', 'Dividendo UF', 'Dividendo $', 'Renta Mín.'].map(h => (
                              <th key={h} className={`px-4 py-2.5 font-black text-gray-500 text-xs uppercase ${h === 'Plazo' ? 'text-left' : 'text-right'}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {dividendTable.map(r => (
                            <tr key={r.years} className="hover:bg-blue-50/20">
                              <td className="px-4 py-2.5 font-bold text-gray-800">{r.years} años</td>
                              <td className="px-4 py-2.5 text-right font-mono">{formatUF(r.divUF)}</td>
                              <td className="px-4 py-2.5 text-right font-mono">{r.divCLP ? formatCLP(r.divCLP) : '—'}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-green-700">{r.rentaMin ? formatCLP(r.rentaMin) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-[10px] text-gray-400 italic">
                          Simulación referencial con tasa {mortgageInputs.tasaAnual}% anual.
                          Base: {formatUF(bonoPieBreakdown.totalPorFinanciar)} UF.
                          Renta mín. = dividendo × 4.{ufHoy ? ` UF ${ufFecha}: ${formatCLP(ufHoy)}.` : ''}
                        </p>
                      </div>
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

          {/* ── Vista previa del PDF — mismo layout que generatePDFBlob (CAMBIO 2+4) ── */}
          <div className="bg-white rounded-xl border border-gray-200 max-w-4xl mx-auto shadow-2xl overflow-hidden quotation-document" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>

            {/* HEADER: Logo izquierda (fondo blanco) + Área azul sólida derecha */}
            <div className="flex h-16 overflow-hidden">
              {/* Área logo — fondo blanco, proporciones naturales */}
              <div className="w-[120px] h-[60px] bg-white flex items-center justify-center p-2 overflow-hidden shrink-0 self-center ml-1">
                <img
                  src="/Danacorp.png"
                  alt="Danacorp"
                  className="max-w-full max-h-full object-contain"
                  onError={e => {
                    const img = e.target as HTMLImageElement;
                    img.style.display = 'none';
                    img.parentElement!.innerHTML = '<span class="font-black text-blue-600 text-sm">DANACORP</span>';
                  }}
                />
              </div>
              {/* Área azul sólida derecha */}
              <div className="flex-1 bg-blue-600 flex items-end justify-end pb-2 pr-3">
                <span className="text-white text-[10px] font-black uppercase tracking-wider">
                  COT. N° {quoteIdRef.current}
                </span>
              </div>
            </div>

            <div className="p-6">
              {/* Fila: datos cliente + proyecto + título */}
              <div className="flex justify-between items-start mb-4 pb-3 border-b-2 border-blue-100">
                <div>
                  <h1 className="text-lg font-black text-blue-700 uppercase tracking-tight mb-2">Cotización Formal</h1>
                  <div className="text-[10px] font-black text-gray-400 uppercase mb-1">Destinatario</div>
                  <div className="font-bold text-gray-900 text-sm">{selectedClient.nombre}</div>
                  <div className="text-gray-500 text-xs font-mono">RUT: {selectedClient.rut}</div>
                  {selectedClient.email && <div className="text-gray-400 text-xs">{selectedClient.email}</div>}
                </div>
                <div className="text-right text-xs">
                  <div className="font-bold text-gray-900 text-sm">{currentProject?.nombre}</div>
                  <div className="text-blue-600 font-bold">Ejecutivo: {currentUser.name}</div>
                  <div className="text-gray-400">{new Date().toLocaleDateString('es-CL')}</div>
                  {ufHoy && <div className="text-gray-400">UF {ufFecha}: {formatCLP(ufHoy)}</div>}
                </div>
              </div>

              {/* Sección INMUEBLES */}
              <div className="mb-3">
                <div className="bg-blue-50 border-l-4 border-blue-600 px-2 py-1 mb-1">
                  <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Inmuebles</span>
                </div>
                <table className="w-full text-xs border border-gray-200">
                  <thead className="bg-blue-600 text-white">
                    <tr>{['Tipo','Unidad','Sup. m²','Piso','Orientación'].map(h=>(
                      <th key={h} className="px-2 py-1 text-left font-bold text-[10px]">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {selectedUnits.map((u, i) => (
                      <tr key={u.id} className={i%2===0?'bg-white':'bg-blue-50/20'}>
                        <td className="px-2 py-1 border-t border-gray-100">{u.type}</td>
                        <td className="px-2 py-1 border-t border-gray-100 font-bold">{u.numero}</td>
                        <td className="px-2 py-1 border-t border-gray-100">{u.superficie || '—'}</td>
                        <td className="px-2 py-1 border-t border-gray-100">{u.piso || '—'}</td>
                        <td className="px-2 py-1 border-t border-gray-100">{u.orientacion || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Sección PRECIOS */}
              <div className="mb-3">
                <div className="bg-blue-50 border-l-4 border-blue-600 px-2 py-1 mb-1">
                  <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Precios</span>
                </div>
                <table className="w-full text-xs border border-gray-200">
                  <thead className="bg-blue-600 text-white">
                    <tr>
                      {['Unidad','P. Lista (UF)','Desc.','Total (UF)', ...(ufHoy?['Total ($)']:[])].map(h=>(
                        <th key={h} className="px-2 py-1 text-right first:text-left font-bold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedUnits.map((u, i) => {
                      const fp = unitFinalPrice(u, adjustDrafts);
                      const dp = unitDiscountPct(u, adjustDrafts);
                      return (
                        <tr key={u.id} className={i%2===0?'bg-white':'bg-blue-50/20'}>
                          <td className="px-2 py-1 border-t border-gray-100 font-bold">{u.type} {u.numero}</td>
                          <td className="px-2 py-1 border-t border-gray-100 text-right font-mono text-gray-500">{formatUF(u.precioLista)}</td>
                          <td className="px-2 py-1 border-t border-gray-100 text-right">
                            {dp > 0 && <span className="text-red-600 font-bold">-{dp.toFixed(1)}%</span>}
                          </td>
                          <td className="px-2 py-1 border-t border-gray-100 text-right font-bold text-gray-900">{formatUF(fp)}</td>
                          {ufHoy && <td className="px-2 py-1 border-t border-gray-100 text-right font-mono text-gray-500">{formatCLP(fp * ufHoy)}</td>}
                        </tr>
                      );
                    })}
                    <tr className="bg-blue-700 text-white font-black">
                      <td className="px-2 py-1 uppercase text-[10px]">Total</td>
                      <td className="px-2 py-1 text-right font-mono text-blue-200 text-[10px]">{formatUF(selectedUnits.reduce((s,u)=>s+u.precioLista,0))}</td>
                      <td />
                      <td className="px-2 py-1 text-right">{formatUF(totalFinal)}</td>
                      {ufHoy && <td className="px-2 py-1 text-right">{formatCLP(totalFinal * ufHoy)}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Sección FORMA DE PAGO (solo si showMortgage) */}
              {showMortgage && (
                <div className="mb-3">
                  <div className="bg-blue-50 border-l-4 border-blue-600 px-2 py-1 mb-1">
                    <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Forma de Pago</span>
                  </div>
                  <table className="w-full text-xs border border-gray-200">
                    <thead className="bg-blue-600 text-white">
                      <tr>{['Concepto','%','UF','$'].map(h=>(<th key={h} className="px-2 py-1 text-left font-bold text-[10px]">{h}</th>))}</tr>
                    </thead>
                    <tbody className="text-[10px]">
                      {reservaCLP > 0 && (
                        <tr><td className="px-2 py-1 border-t border-gray-100">Reserva</td><td/><td/><td className="px-2 py-1 font-bold border-t border-gray-100">{formatCLP(reservaCLP)}</td></tr>
                      )}
                      {bonoPieBreakdown.conBono.length > 0 && bonoPieBreakdown.sinBono.length > 0 ? (<>
                        <tr className="bg-blue-50"><td colSpan={4} className="px-2 py-0.5 font-black text-blue-700">Con bono pie ({bonoPct}%)</td></tr>
                        <tr><td className="px-2 py-1 pl-4 border-t border-gray-100">Valor Total</td><td className="px-2 py-1 border-t border-gray-100">{bonoPct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.precioInflado,0))}</td><td/></tr>
                        <tr><td className="px-2 py-1 pl-4 border-t border-gray-100">Bonificación Bono Pie</td><td/><td className="px-2 py-1 font-mono text-green-700 border-t border-gray-100">- {formatUF(bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.bonificacion,0))}</td><td/></tr>
                        <tr className="font-bold"><td className="px-2 py-1 pl-4 border-t border-gray-100">Monto a Pagar</td><td/><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.montoAPagar,0))}</td><td/></tr>
                        <tr className="text-blue-700 font-bold"><td className="px-2 py-1 pl-4 border-t border-gray-100">Crédito Hipotecario</td><td className="px-2 py-1 border-t border-gray-100">{finPct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.conBono.reduce((s,x)=>s+x.calc.porFinanciar,0))}</td><td/></tr>
                        <tr className="bg-gray-50"><td colSpan={4} className="px-2 py-0.5 font-black text-gray-600">Sin bono pie</td></tr>
                        <tr className="font-bold"><td className="px-2 py-1 pl-4 border-t border-gray-100">Monto a Pagar</td><td className="px-2 py-1 border-t border-gray-100">{piePct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.sinBono.reduce((s,x)=>s+x.calc.montoAPagar,0))}</td><td/></tr>
                        <tr className="text-blue-700 font-bold"><td className="px-2 py-1 pl-4 border-t border-gray-100">Crédito Hipotecario</td><td className="px-2 py-1 border-t border-gray-100">{finPct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.sinBono.reduce((s,x)=>s+x.calc.porFinanciar,0))}</td><td/></tr>
                      </>) : includeBonoPie ? (<>
                        <tr><td className="px-2 py-1 border-t border-gray-100">Valor Total</td><td className="px-2 py-1 border-t border-gray-100">{bonoPct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.totalPrecioInflado)}</td><td className="px-2 py-1 font-mono border-t border-gray-100">{ufHoy?formatCLP(bonoPieBreakdown.totalPrecioInflado*ufHoy):'—'}</td></tr>
                        <tr><td className="px-2 py-1 border-t border-gray-100">Bonificación Bono Pie</td><td/><td className="px-2 py-1 font-mono text-green-700 border-t border-gray-100">- {formatUF(bonoPieBreakdown.totalBonificacion)}</td><td/></tr>
                        <tr className="font-bold"><td className="px-2 py-1 border-t border-gray-100">Monto a Pagar</td><td/><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.totalMontoAPagar)}</td><td className="px-2 py-1 font-mono border-t border-gray-100">{ufHoy?formatCLP(bonoPieBreakdown.totalMontoAPagar*ufHoy):'—'}</td></tr>
                        <tr className="font-black text-blue-700"><td className="px-2 py-1 border-t border-gray-100">Crédito Hipotecario</td><td className="px-2 py-1 border-t border-gray-100">{finPct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.totalPorFinanciar)}</td><td className="px-2 py-1 font-mono border-t border-gray-100">{ufHoy?formatCLP(bonoPieBreakdown.totalPorFinanciar*ufHoy):'—'}</td></tr>
                      </>) : (<>
                        <tr className="font-bold"><td className="px-2 py-1 border-t border-gray-100">Monto a Pagar (pie {piePct}%)</td><td/><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.totalMontoAPagar)}</td><td className="px-2 py-1 font-mono border-t border-gray-100">{ufHoy?formatCLP(bonoPieBreakdown.totalMontoAPagar*ufHoy):'—'}</td></tr>
                        <tr className="font-black text-blue-700"><td className="px-2 py-1 border-t border-gray-100">Crédito Hipotecario</td><td className="px-2 py-1 border-t border-gray-100">{finPct}%</td><td className="px-2 py-1 font-mono border-t border-gray-100">{formatUF(bonoPieBreakdown.totalPorFinanciar)}</td><td className="px-2 py-1 font-mono border-t border-gray-100">{ufHoy?formatCLP(bonoPieBreakdown.totalPorFinanciar*ufHoy):'—'}</td></tr>
                      </>)}
                      <tr className="bg-blue-600 text-white font-black">
                        <td className="px-2 py-1 text-[10px]" colSpan={2}>Plan: {nCuotas} cuotas de {formatUF(montoPorCuota)} UF</td>
                        <td className="px-2 py-1 font-mono">{formatUF(montoPorCuota)}</td>
                        <td className="px-2 py-1 font-mono">{ufHoy?formatCLP(montoPorCuota*ufHoy):'—'}</td>
                      </tr>
                    </tbody>
                  </table>
                  {includeBonoPie && bonoPieBreakdown.conBono.length > 0 && (
                    <p className="text-[9px] text-amber-700 mt-1">
                      Bono pie: {bonoPieBreakdown.conBono.map(x=>`${x.unit.type} ${x.unit.numero}`).join(', ')}
                    </p>
                  )}

                  {/* Dividendo */}
                  <div className="bg-blue-50 border-l-4 border-blue-600 px-2 py-1 mt-2 mb-1">
                    <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Dividendo Referencial</span>
                  </div>
                  <table className="w-full text-xs border border-gray-200">
                    <thead className="bg-blue-600 text-white">
                      <tr>{['Plazo','UF/mes','$/mes','Renta Mín.'].map(h=>(<th key={h} className="px-2 py-1 text-right first:text-left font-bold text-[10px]">{h}</th>))}</tr>
                    </thead>
                    <tbody>
                      {dividendTable.map((r,i) => (
                        <tr key={r.years} className={i%2===0?'bg-white':'bg-blue-50/20'}>
                          <td className="px-2 py-1 border-t border-gray-100 font-bold">{r.years} años</td>
                          <td className="px-2 py-1 border-t border-gray-100 text-right font-mono">{formatUF(r.divUF)}</td>
                          <td className="px-2 py-1 border-t border-gray-100 text-right font-mono">{r.divCLP?formatCLP(r.divCLP):'—'}</td>
                          <td className="px-2 py-1 border-t border-gray-100 text-right font-mono text-green-700">{r.rentaMin?formatCLP(r.rentaMin):'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[9px] text-gray-400 italic mt-1">
                    Tasa {mortgageInputs.tasaAnual}% anual · Base {formatUF(bonoPieBreakdown.totalPorFinanciar)} UF · No constituye oferta crediticia
                  </p>
                </div>
              )}

              {/* Footer del documento */}
              <div className="border-t border-blue-200 pt-2 mt-2 flex justify-between items-center text-[9px] text-gray-400">
                <span>Generado por DanaWorks</span>
                <span>• Cotización válida 7 días •</span>
                <span>Ejecutivo: {currentUser.name}</span>
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
