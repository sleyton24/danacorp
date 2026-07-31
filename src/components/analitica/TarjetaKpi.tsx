import React from 'react';
import type { DeltaResultado } from '../../utils/analiticaFiltros';

interface TarjetaKpiProps {
  label: string;
  valor: string;
  sub?: string;
  delta?: DeltaResultado | null;
}

const colorDelta: Record<DeltaResultado['direccion'], string> = {
  up: 'text-green-600', down: 'text-red-600', flat: 'text-gray-400', nuevo: 'text-green-600',
};

/** Tarjeta simple de nivel 2: label, cifra, sub y delta opcional. Mismo estilo visual que
 * las tarjetas ya usadas en Resumen/Performance (rounded-2xl, border-gray-200, shadow-sm). */
export const TarjetaKpi: React.FC<TarjetaKpiProps> = ({ label, valor, sub, delta }) => (
  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
    <div className="flex items-start justify-between gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      {delta && <span className={`text-[11px] font-bold shrink-0 ${colorDelta[delta.direccion]}`}>{delta.texto}</span>}
    </div>
    <p className="text-xl font-bold text-gray-900 mt-1 font-mono tabular-nums">{valor}</p>
    {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
  </div>
);
