import React, { useState, useRef } from 'react';
import { RealEstateUnit, Project } from '../types';
import { Building, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight, Upload, Download, X, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ProjectCreationWizardProps {
  onSave: (project: Project, units: RealEstateUnit[]) => void;
  onCancel: () => void;
}

interface ValidationError {
  row: number;
  col: string;
  message: string;
  suggestion?: string;
}

const REQUIRED_HEADERS = [
  'Numero de Unidad', 'Tipo', 'Precio Lista (UF)', 'Superficie (m2)', 'Piso', 'Orientación', 'Dormitorios', 'Baños', 
  'Est. 1', 'Est. 2', 'Est. 3', 'Est. 4', 'Bodega 1', 'Bodega 2', 'Atributo'
];

export const ProjectCreationWizard: React.FC<ProjectCreationWizardProps> = ({ onSave, onCancel }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [projectName, setProjectName] = useState('');
  
  // File State
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data State
  const [parsedUnits, setParsedUnits] = useState<RealEstateUnit[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [columnErrors, setColumnErrors] = useState<Record<string, string>>({}); 

  // Download Template
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      REQUIRED_HEADERS,
      ['204', 'Departamento', 4565, 65.5, 2, 'Norte', 2, 2, 'E-12', 'E-13', '', '', 'B-233', '', 'Vista despejada'], 
      ['E-12', 'Estacionamiento', 350, '', -1, '', '', '', '', '', '', '', '', '', 'Single'],
      ['E-13', 'Estacionamiento', 350, '', -1, '', '', '', '', '', '', '', '', '', 'Tandem'],
      ['B-233', 'Bodega', 80, 5.2, -1, '', '', '', '', '', '', '', '', '', 'Cerca de ascensor'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla Carga");
    // XLSX.writeFile no dispara la descarga de forma fiable en bundles (Vite + build
    // CDN de SheetJS). Generamos el archivo como blob y lo descargamos con un <a>.
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Plantilla_Carga_Masiva.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const validateData = (jsonData: any[]): { units: RealEstateUnit[], errors: ValidationError[], colErrors: Record<string, string> } => {
    const units: RealEstateUnit[] = [];
    const errors: ValidationError[] = [];
    const colErrors: Record<string, string> = {};
    const tempId = crypto.randomUUID();

    const typeFailures: Record<string, number> = {};

    jsonData.forEach((row, index) => {
      const rowIndex = index; 
      const numero = row['Numero de Unidad'] || row['Nº Unidad']; 
      
      if (!numero) {
        errors.push({ row: rowIndex, col: 'Numero de Unidad', message: 'Campo obligatorio' });
      }

      const typeRaw = row['Tipo'];
      let unitType: 'Departamento' | 'Bodega' | 'Estacionamiento' = 'Departamento';
      
      if (typeRaw) {
          const t = String(typeRaw).toLowerCase();
          if (t.includes('estacionamiento')) unitType = 'Estacionamiento';
          else if (t.includes('bodega')) unitType = 'Bodega';
      }

      let precio = row['Precio Lista (UF)'];
      if (precio === undefined || precio === null || String(precio).trim() === '') {
        errors.push({ row: rowIndex, col: 'Precio Lista (UF)', message: 'Campo obligatorio' });
      } else {
        if (typeof precio === 'string') {
           const cleanPrice = precio.replace(/[$.]/g, '').replace(',', '.');
           if (!isNaN(parseFloat(cleanPrice))) {
             precio = parseFloat(cleanPrice);
           } else {
             errors.push({ row: rowIndex, col: 'Precio Lista (UF)', message: 'Debe ser numérico' });
             typeFailures['Precio Lista (UF)'] = (typeFailures['Precio Lista (UF)'] || 0) + 1;
           }
        } else if (typeof precio !== 'number') {
            errors.push({ row: rowIndex, col: 'Precio Lista (UF)', message: 'Formato inválido' });
            typeFailures['Precio Lista (UF)'] = (typeFailures['Precio Lista (UF)'] || 0) + 1;
        }
      }

      let superficie = row['Superficie (m2)'] || row['Superficie'];
      if (superficie) {
         if (typeof superficie === 'string') {
            const cleanSurf = superficie.replace(',', '.');
            if(!isNaN(parseFloat(cleanSurf))) {
                superficie = parseFloat(cleanSurf);
            } else {
                errors.push({ row: rowIndex, col: 'Superficie', message: 'Debe ser numérico' });
            }
         }
      }

      ['Piso', 'Dormitorios', 'Baños'].forEach(field => {
        if (row[field] && isNaN(parseInt(row[field]))) {
            errors.push({ row: rowIndex, col: field, message: 'Debe ser número entero' });
            typeFailures[field] = (typeFailures[field] || 0) + 1;
        }
      });

      const estacionamientos = [row['Est. 1'], row['Est. 2'], row['Est. 3'], row['Est. 4']].filter(x => x && String(x).trim() !== '' && x !== '-');
      const bodegas = [row['Bodega 1'], row['Bodega 2']].filter(x => x && String(x).trim() !== '' && x !== '-');

      // El atributo ahora se toma de la columna única al final de la fila
      const observations = row['Atributo'] || (unitType !== 'Departamento' ? 'Sin atributo' : '');

      units.push({
        id: `new-${index}`,
        projectId: tempId,
        type: unitType,
        numero: String(numero || 'ERROR'),
        estado: unitType === 'Departamento' ? 'Disponible' : 'Libre Asignación', 
        
        precioLista: typeof precio === 'number' ? precio : 0,
        precioVenta: typeof precio === 'number' ? precio : 0,
        
        superficie: typeof superficie === 'number' ? superficie : undefined,
        piso: row['Piso'] ? parseInt(row['Piso']) : undefined,
        orientacion: row['Orientación'] || undefined,
        dormitorios: row['Dormitorios'] ? parseInt(row['Dormitorios']) : undefined,
        banos: row['Baños'] ? parseInt(row['Baños']) : undefined,

        bodegas: bodegas.map(String),
        estacionamientos: estacionamientos.map(String),

        pie: 0,
        bonoDescuento: 0,
        reservaMonto: 0,
        creditoHipotecario: 0,
        totalPagado: 0,
        saldoPorPagar: 0,
        planPagos: [],
        observaciones: observations
      });
    });

    Object.keys(typeFailures).forEach(col => {
        if (typeFailures[col] > jsonData.length * 0.5) {
            colErrors[col] = "Formato de columna incorrecto.";
        }
    });

    return { units, errors, colErrors };
  };

  const processFile = async (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);
        
        if (jsonData.length === 0) {
            setValidationErrors([{ row: 0, col: 'General', message: 'Archivo vacío.' }]);
            return;
        }

        const { units, errors, colErrors } = validateData(jsonData);
        setParsedUnits(units);
        setValidationErrors(errors);
        setColumnErrors(colErrors);
      } catch (error) {
        console.error(error);
        setValidationErrors([{ row: 0, col: 'General', message: 'Error al leer Excel.' }]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
        processFile(file);
    }
  };

  const handleFinalSave = () => {
    if (!projectName || validationErrors.length > 0) return;
    
    const newProject: Project = {
      id: crypto.randomUUID(),
      nombre: projectName,
      fechaCreacion: new Date().toLocaleDateString('es-CL')
    };

    // Actualizamos las unidades con el ID real del proyecto
    let finalUnits = parsedUnits.map(u => ({ ...u, projectId: newProject.id }));

    const existingUnitNumbers = new Set(finalUnits.map(u => u.numero));
    const extraUnits: RealEstateUnit[] = [];

    // Manejo de unidades vinculadas que no fueron declaradas explícitamente en una fila propia
    finalUnits.forEach((unit) => {
        if (unit.type === 'Departamento') {
            unit.estacionamientos.forEach((estNum) => {
                if (!existingUnitNumbers.has(estNum)) {
                    extraUnits.push({
                        id: crypto.randomUUID(),
                        projectId: newProject.id,
                        type: 'Estacionamiento',
                        numero: estNum,
                        estado: 'Asignado',
                        precioLista: 0, 
                        precioVenta: 0,
                        pie: 0,
                        bonoDescuento: 0,
                        reservaMonto: 0,
                        creditoHipotecario: 0,
                        totalPagado: 0,
                        saldoPorPagar: 0,
                        planPagos: [],
                        bodegas: [],
                        estacionamientos: [],
                        observaciones: 'Single (Auto-generado)'
                    });
                    existingUnitNumbers.add(estNum); 
                }
            });
            unit.bodegas.forEach(bodNum => {
                if (!existingUnitNumbers.has(bodNum)) {
                    extraUnits.push({
                        id: crypto.randomUUID(),
                        projectId: newProject.id,
                        type: 'Bodega',
                        numero: bodNum,
                        estado: 'Asignado',
                        precioLista: 0,
                        precioVenta: 0,
                        superficie: 0,
                        pie: 0,
                        bonoDescuento: 0,
                        reservaMonto: 0,
                        creditoHipotecario: 0,
                        totalPagado: 0,
                        saldoPorPagar: 0,
                        planPagos: [],
                        bodegas: [],
                        estacionamientos: [],
                        observaciones: `Asignado a Depto ${unit.numero}`
                    });
                    existingUnitNumbers.add(bodNum);
                }
            });
        }
    });

    onSave(newProject, [...finalUnits, ...extraUnits]);
  };

  const getCellError = (rowIndex: number, colName: string) => {
    return validationErrors.find(e => e.row === rowIndex && e.col === colName);
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 animate-fade-in">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-gray-900">Configurar Nuevo Proyecto</h2>
        <div className="flex items-center justify-center gap-4 mt-6">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${step === 1 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-500'}`}>
            <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs shadow">1</span>
            Datos Generales
          </div>
          <ArrowRight className="text-gray-300 w-4 h-4" />
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${step === 2 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-500'}`}>
            <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs shadow">2</span>
            Carga Masiva (Excel)
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {step === 1 && (
          <div className="p-8 space-y-6 max-w-2xl mx-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Proyecto / Obra</label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input 
                  autoFocus
                  type="text" 
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-lg transition-all"
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button disabled={!projectName.trim()} onClick={() => setStep(2)} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl flex items-center gap-2 transition-all">
                Continuar <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="p-8 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
               <div>
                  <h3 className="font-bold text-gray-800">Planilla de Unidades</h3>
                  <p className="text-sm text-gray-500">Los atributos (Tandem/Single/Notas) se declaran en la columna final para cada fila.</p>
               </div>
               <button onClick={handleDownloadTemplate} className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm">
                  <FileSpreadsheet className="w-4 h-4" />
                  Descargar Nueva Plantilla
               </button>
            </div>

            {!parsedUnits.length ? (
                <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-3 border-dashed rounded-2xl p-12 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 min-h-[300px] ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400'}`}
                >
                    <input type="file" ref={fileInputRef} onChange={(e) => { const file = e.target.files?.[0]; if(file) processFile(file); }} className="hidden" accept=".xlsx, .xls" />
                    <Upload className="w-12 h-12 text-blue-600 mb-2" />
                    <div className="text-center">
                        <p className="text-xl font-semibold text-gray-800">Sube tu archivo Excel aquí</p>
                        <p className="text-gray-500 mt-1">Soporta formatos .xlsx y .xls</p>
                    </div>
                </div>
            ) : (
                <div className="animate-in fade-in">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-800">Vista Previa de Carga</h3>
                        <button onClick={() => { setParsedUnits([]); setValidationErrors([]); setFileName(null); }} className="text-gray-500 hover:text-red-600 text-sm font-medium flex items-center gap-1">
                            <X className="w-4 h-4" /> Cambiar Archivo
                        </button>
                    </div>
                    <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto relative bg-white">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 w-16 text-gray-600 font-semibold">#</th>
                                    {['Unidad', 'Tipo', 'Precio (UF)', 'Superficie', 'Atributo'].map((h, i) => (
                                        <th key={i} className="px-4 py-3 text-gray-600 font-semibold">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {parsedUnits.map((row, i) => (
                                    <tr key={i} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                                        <td className="px-4 py-2 font-bold text-gray-900">{row.numero}</td>
                                        <td className="px-4 py-2 text-gray-600">{row.type}</td>
                                        <td className="px-4 py-2 font-mono text-blue-600">{row.precioLista}</td>
                                        <td className="px-4 py-2 text-gray-600 font-medium">{row.superficie ? `${row.superficie} m²` : '-'}</td>
                                        <td className="px-4 py-2">
                                            <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-black uppercase tracking-tight">
                                                {row.observaciones || '-'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="pt-6 border-t border-gray-100 flex justify-between">
               <button onClick={() => setStep(1)} className="px-6 py-3 text-gray-600 font-medium hover:bg-gray-100 rounded-xl">Atrás</button>
               <button disabled={parsedUnits.length === 0 || validationErrors.length > 0} onClick={handleFinalSave} className="px-8 py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg hover:bg-green-700 disabled:opacity-50 transition-all flex items-center gap-2">
                 <CheckCircle className="w-5 h-5" /> Finalizar y Crear Proyecto
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
