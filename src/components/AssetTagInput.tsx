import React, { useState, useRef, useEffect } from 'react';
import { RealEstateUnit } from '../types';
import { X, Plus, AlertCircle, Check, Search } from 'lucide-react';

interface AssetTagInputProps {
  label: string;
  type: 'Bodega' | 'Estacionamiento';
  allUnits: RealEstateUnit[];
  selectedUnits: string[];
  onChange: (units: string[]) => void;
  currentUnitId?: string;
}

export const AssetTagInput: React.FC<AssetTagInputProps> = ({
  label,
  type,
  allUnits,
  selectedUnits,
  onChange,
  currentUnitId
}) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RealEstateUnit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /**
   * Identifica candidatos disponibles:
   * 1. Son del tipo solicitado (Bodega/Estacionamiento).
   * 2. NO están contenidos en los arreglos de vinculación de ningún departamento del proyecto.
   * 3. Su estado es 'Disponible' o 'Libre Asignación'.
   */
  const availableCandidates = allUnits.filter(u => {
    if (u.type !== type) return false;
    
    // Si ya está seleccionado en este input, no es candidato para añadir de nuevo
    if (selectedUnits.includes(u.numero)) return false;

    // Verificar si está asignado a CUALQUIER departamento del proyecto
    const isAlreadyAssigned = allUnits.some(dept => 
      dept.type === 'Departamento' && 
      (dept.estacionamientos.includes(u.numero) || dept.bodegas.includes(u.numero))
    );

    return !isAlreadyAssigned && (u.estado === 'Disponible' || u.estado === 'Libre Asignación');
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setError(null);

    // Filtrar sugerencias basadas en el texto ingresado
    const matches = availableCandidates.filter(u => 
      u.numero.toLowerCase().includes(value.toLowerCase())
    );
    setSuggestions(matches);
    setShowSuggestions(true);
  };

  const addTag = (numero: string) => {
    if (selectedUnits.includes(numero)) {
      setInputValue('');
      setShowSuggestions(false);
      return;
    }

    const unitExists = allUnits.find(u => u.type === type && u.numero === numero);
    
    if (!unitExists) {
        setError("Inexistente");
        return;
    }

    // Doble verificación de asignación antes de agregar
    const isAlreadyAssigned = allUnits.some(dept => 
        dept.type === 'Departamento' && 
        (dept.estacionamientos.includes(numero) || dept.bodegas.includes(numero))
    );

    if (isAlreadyAssigned) {
        setError("Ya asignado");
        return;
    }

    onChange([...selectedUnits, numero]);
    setInputValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    setError(null);
    inputRef.current?.focus();
  };

  const removeTag = (numeroToRemove: string) => {
    onChange(selectedUnits.filter(n => n !== numeroToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
         const match = availableCandidates.find(u => u.numero.toLowerCase() === inputValue.toLowerCase());
         if (match) {
             addTag(match.numero);
         } else {
             setError("No disponible");
         }
      }
    }
  };

  return (
    <div className="w-full relative" ref={wrapperRef}>
      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">{label}</label>
      
      <div className="bg-white dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 rounded-xl p-2 flex flex-wrap gap-2 focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30 focus-within:border-blue-400 transition-all min-h-[48px] shadow-inner relative">
        {selectedUnits.map(tag => (
          <span key={tag} className="bg-blue-600 text-white px-2 py-1 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 shadow-sm">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="hover:bg-white/20 rounded-full p-0.5 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        
        <div className="relative flex-1 min-w-[120px]">
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    const initialMatches = availableCandidates.filter(u => 
                        u.numero.toLowerCase().includes(inputValue.toLowerCase())
                    );
                    setSuggestions(initialMatches);
                    setShowSuggestions(true);
                }}
                className="w-full bg-transparent outline-none text-sm py-1 font-bold uppercase placeholder:text-gray-300 dark:text-white"
                placeholder={selectedUnits.length === 0 ? `BUSCAR ${type.toUpperCase()}...` : "AÑADIR OTRO..."}
            />
            {error && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[9px] text-red-500 font-black flex items-center gap-1 uppercase bg-red-50 px-2 py-1 rounded">
                    <AlertCircle className="w-3 h-3" /> {error}
                </span>
            )}
        </div>
      </div>

      {/* Lista Desplegable de Unidades Sin Asignar */}
      {showSuggestions && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
            {suggestions.length > 0 ? (
                suggestions.map(u => (
                    <button
                        key={u.id}
                        type="button"
                        onClick={() => addTag(u.numero)}
                        className="w-full text-left px-4 py-3 text-xs font-black uppercase hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center justify-between group dark:text-gray-200 border-b border-gray-50 last:border-none"
                    >
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            <span>{type.substring(0,3)}. {u.numero}</span>
                        </div>
                        <span className="text-[8px] text-green-600 bg-green-50 px-2 py-0.5 rounded opacity-60 group-hover:opacity-100 transition-opacity uppercase tracking-tighter">
                            SIN ASIGNAR
                        </span>
                    </button>
                ))
            ) : (
                <div className="p-4 text-center text-gray-400 text-[10px] font-bold italic uppercase">
                    No hay {label.toLowerCase()} disponibles para asignar
                </div>
            )}
        </div>
      )}
    </div>
  );
};
