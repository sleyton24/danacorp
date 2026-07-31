import React from 'react';
import type { CruceAnalitico } from '../../utils/analiticaFiltros';

interface ChipsProps {
  cruce: CruceAnalitico;
  onClear: (key: keyof CruceAnalitico) => void;
  onClearAll: () => void;
}

const LABELS: Record<keyof CruceAnalitico, string> = {
  estado: 'estado', piso: 'piso', tipologia: 'tipología', banco: 'banco',
};

/** Chips removibles del cruce activo. Sin cruce, una pista de qué se puede clickear. */
export const Chips: React.FC<ChipsProps> = ({ cruce, onClear, onClearAll }) => {
  const activos = (Object.keys(cruce) as (keyof CruceAnalitico)[]).filter(k => cruce[k] !== null);

  if (activos.length === 0) {
    return <p className="text-xs text-gray-400">Sin filtros cruzados. Hacé clic en cualquier tramo, piso, tipología o banco para cruzar.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {activos.map(k => (
        <button
          key={k}
          onClick={() => onClear(k)}
          className="group inline-flex items-center gap-2 pl-3 pr-2 py-1.5 bg-indigo-50 border border-indigo-200 rounded-full text-xs font-bold text-indigo-800 hover:bg-indigo-100 transition-colors"
        >
          <span className="font-normal text-indigo-500">{LABELS[k]}</span>
          {String(cruce[k])}
          <span className="text-indigo-400 group-hover:text-indigo-700 text-sm leading-none">×</span>
        </button>
      ))}
      <button onClick={onClearAll} className="text-xs font-bold text-gray-500 hover:text-gray-800 underline ml-1">
        limpiar todo
      </button>
    </div>
  );
};
