import React from 'react';
import { RealEstateUnit } from '../../types';
import { tipologia } from '../../utils/analiticaFiltros';
import { formatUF } from '../../utils/format';

interface TablaUnidadesProps {
  units: RealEstateUnit[];
  total?: number;
  onSelectUnit?: (unit: RealEstateUnit) => void;
  limit?: number;
  vacio?: string;
}

// Superficie en m²: no es precio, conserva 1 decimal. Los precios usan formatUF (2 dec).
const fmt1 = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const estiloEstado: Record<string, string> = {
  Disponible: 'text-gray-600', Reservado: 'text-indigo-500', Promesado: 'text-indigo-600',
  Escriturado: 'text-indigo-800', 'Libre Asignación': 'text-gray-400', Asignado: 'text-indigo-500',
};

/** Nivel 3: tabla de unidades de la selección. Fila clickeable -> abre la ficha real. */
export const TablaUnidades: React.FC<TablaUnidadesProps> = ({ units, total, onSelectUnit, limit = 40, vacio }) => {
  const visibles = units.slice(0, limit);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold text-gray-700">Unidades de la selección</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {total ?? units.length} unidad{(total ?? units.length) !== 1 ? 'es' : ''}
            {onSelectUnit ? ' · clic en una fila para abrir la ficha' : ''}
          </p>
        </div>
      </div>
      {visibles.length === 0 ? (
        <p className="px-4 py-6 text-xs text-gray-400">{vacio || 'La selección no tiene unidades.'}</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['Unidad', 'Tipo', 'Piso', 'Tipología', 'm²', 'Estado'].map(h => (
                  <th key={h} className="py-2 px-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">{h}</th>
                ))}
                <th className="py-2 px-4 text-right text-[10px] font-bold uppercase tracking-wide text-gray-400">UF</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(u => (
                <tr
                  key={u.id}
                  onClick={onSelectUnit ? () => onSelectUnit(u) : undefined}
                  className={`border-b border-gray-50 ${onSelectUnit ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                >
                  <td className="py-1.5 px-2 pl-4 text-xs font-bold text-gray-800 font-mono">{u.numero}</td>
                  <td className="py-1.5 px-2 text-xs text-gray-500">{u.type}</td>
                  <td className="py-1.5 px-2 text-xs text-gray-500">{typeof u.piso === 'number' ? `P.${u.piso}` : '—'}</td>
                  <td className="py-1.5 px-2 text-xs text-gray-500">{u.type === 'Departamento' ? tipologia(u) : '—'}</td>
                  <td className="py-1.5 px-2 text-xs text-gray-500 font-mono">{u.superficie ? fmt1(u.superficie) : '—'}</td>
                  <td className={`py-1.5 px-2 text-xs font-bold ${estiloEstado[u.estado] ?? 'text-gray-500'}`}>{u.estado}</td>
                  <td className="py-1.5 px-4 text-right text-xs font-bold text-gray-800 font-mono">{formatUF(u.precioVenta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
