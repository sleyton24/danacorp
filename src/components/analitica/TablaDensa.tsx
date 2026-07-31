import React from 'react';

export interface FilaDensa {
  key: string;
  label: string;
  /** Denominador — SIEMPRE el universo real (nunca el ya cruzado/seleccionado): es la
   * regla central de la propuesta. Ver docs/propuesta-analitica/README.md sección 2. */
  total: number;
  /** Numerador — este sí refleja el cruce/selección activa. */
  colocadas: number;
  pct: number;
  uf: number;
  /** Financiamiento no tiene "total" (no hay un universo de bancos por unidad): se
   * muestra solo el numerador en vez de "colocadas/total". */
  sinTotal?: boolean;
}

interface TablaDensaProps {
  titulo: string;
  filas: FilaDensa[];
  nota?: string;
  vacio?: string;
  activoKey?: (key: string) => boolean;
  onClickFila?: (key: string) => void;
  expandidoKey?: (key: string) => boolean;
  filaExpandida?: (key: string) => React.ReactNode;
}

const fmt = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Tabla monoespaciada de nivel 2 ("consola"): label, col/tot (o sel/tot con cruce activo),
 * %, barra en línea, UF. Fila clickeable (cruce o expansión, según quién la use). Estado
 * vacío con texto explicativo en vez de una tabla sin filas.
 */
export const TablaDensa: React.FC<TablaDensaProps> = ({
  titulo, filas, nota, vacio, activoKey, onClickFila, expandidoKey, filaExpandida,
}) => (
  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-100 flex items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold text-gray-700">{titulo}</h3>
      <span className="text-[10px] text-gray-400 shrink-0">{nota || 'col/tot · UF'}</span>
    </div>
    {filas.length === 0 ? (
      <p className="px-4 py-6 text-[11px] text-gray-400">{vacio || 'Sin datos en la selección.'}</p>
    ) : (
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full">
          <tbody>
            {filas.map(f => {
              const activo = activoKey?.(f.key) ?? false;
              const expandido = expandidoKey?.(f.key) ?? false;
              return (
                <React.Fragment key={f.key}>
                  <tr
                    onClick={onClickFila ? () => onClickFila(f.key) : undefined}
                    className={`border-b border-gray-50 ${onClickFila ? 'cursor-pointer hover:bg-gray-50' : ''} ${activo ? 'bg-indigo-50' : ''}`}
                  >
                    <td className={`py-1.5 pl-3 pr-2 text-xs truncate ${activo ? 'font-bold text-indigo-900' : 'text-gray-700'}`}>{f.label}</td>
                    <td className="py-1.5 px-2 text-right text-xs text-gray-500 font-mono tabular-nums whitespace-nowrap">
                      {f.sinTotal ? f.colocadas : `${f.colocadas}/${f.total}`}
                    </td>
                    <td className="py-1.5 px-2 text-right text-xs font-bold text-gray-800 font-mono tabular-nums w-12">{f.pct}%</td>
                    <td className="py-1.5 pr-3 pl-2 w-24">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(100, Math.max(0, f.pct))}%` }} />
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[11px] text-gray-400 font-mono tabular-nums w-20">{fmt(f.uf)}</td>
                  </tr>
                  {expandido && filaExpandida?.(f.key)}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
