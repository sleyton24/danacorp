import React, { useState, useRef } from 'react';
import { extractTransactionData } from '../services/geminiService';
import { TransactionData, Client, RealEstateUnit, PaymentItem } from '../types';
import { Upload, Loader2, ArrowRight, CheckCircle, FileText, User, Home, DollarSign, Calendar, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { InfoCard } from './InfoCard';
import { LabeledValue } from './LabeledValue';
import { PaymentTable } from './PaymentTable';

interface LegacyImportViewProps {
  onSave: (data: TransactionData) => void;
  units: RealEstateUnit[];
}

export const LegacyImportView: React.FC<LegacyImportViewProps> = ({ onSave, units }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<TransactionData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
        setData(null); // Reset prev data
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const processImage = async () => {
    if (!preview) return;

    setIsLoading(true);
    try {
      // Remove data:image/png;base64, part
      const base64Data = preview.split(',')[1];
      const result = await extractTransactionData(base64Data);
      setData(result);
    } catch (error) {
      alert("Error al procesar la imagen. Intente nuevamente.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusOfUnit = (unitNumber: string) => {
      const unit = units.find(u => u.numero === unitNumber);
      if (!unit) return { text: 'No existe', color: 'text-red-500' };
      if (unit.estado === 'Disponible') return { text: 'Disponible', color: 'text-green-500' };
      return { text: `Ocupado (${unit.estado})`, color: 'text-orange-500' };
  };

  return (
    <div className="animate-fade-in pb-12">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <span className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-300">
                <Upload className="w-8 h-8" />
            </span>
            Importador Legacy
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-2 text-lg">
            Digitaliza las fichas antiguas de Microsoft Works mediante IA. Sube una captura para comenzar.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* Left Column: Upload & Preview */}
        <div className="space-y-6">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`
                relative border-3 border-dashed rounded-3xl p-8 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center gap-4 min-h-[400px] overflow-hidden group
                ${preview ? 'border-blue-400 bg-gray-50 dark:bg-gray-800' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 hover:bg-blue-50/10'}
            `}
          >
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*"
            />
            
            {preview ? (
                <>
                    <img src={preview} alt="Preview" className="max-h-[350px] object-contain rounded-lg shadow-sm z-10" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <p className="text-white font-medium flex items-center gap-2">
                            <ImageIcon className="w-5 h-5" /> Cambiar Imagen
                        </p>
                    </div>
                </>
            ) : (
                <div className="text-center">
                    <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-300 mb-4 mx-auto group-hover:scale-110 transition-transform">
                        <Upload className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Sube tu captura aquí</h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                        Aceptamos capturas de pantalla de Microsoft Works, Excel antiguo o fichas escaneadas (JPG, PNG).
                    </p>
                </div>
            )}
          </div>

          <button
            onClick={processImage}
            disabled={!preview || isLoading}
            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-3 transition-all
                ${!preview || isLoading 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' 
                    : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-[1.02]'}
            `}
          >
            {isLoading ? (
                <>
                    <Loader2 className="w-6 h-6 animate-spin" /> Procesando con IA...
                </>
            ) : (
                <>
                    <ArrowRight className="w-6 h-6" /> Procesar Imagen
                </>
            )}
          </button>
        </div>

        {/* Right Column: Results & Validation */}
        <div className="space-y-6">
            {!data && !isLoading && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-3xl min-h-[400px] bg-white dark:bg-gray-800 p-8 text-center">
                    <FileText className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-lg font-medium">Los datos extraídos aparecerán aquí</p>
                    <p className="text-sm opacity-60">Revisa la información antes de guardar.</p>
                </div>
            )}

            {isLoading && (
                 <div className="h-full flex flex-col items-center justify-center min-h-[400px] bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-8">
                     <div className="relative w-24 h-24 mb-6">
                         <div className="absolute inset-0 border-4 border-blue-100 dark:border-blue-900 rounded-full"></div>
                         <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                     </div>
                     <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Analizando Documento...</h3>
                     <p className="text-gray-500 dark:text-gray-400 text-center max-w-xs">
                         Gemini está identificando comprador, montos y fechas de la imagen legacy.
                     </p>
                 </div>
            )}

            {data && (
                <div className="animate-in slide-in-from-right duration-500 space-y-6">
                    
                    {/* Validation Header */}
                    <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl border border-green-200 dark:border-green-800 flex items-start gap-3">
                        <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                        <div>
                            <h3 className="font-bold text-green-800 dark:text-green-300">Extracción Exitosa</h3>
                            <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                                Hemos detectado los datos. Por favor valida la información antes de importar al sistema.
                            </p>
                        </div>
                    </div>

                    {/* Cards Grid */}
                    <InfoCard title="Datos del Comprador" icon={<User className="w-5 h-5"/>}>
                        <div className="grid grid-cols-2 gap-4">
                            <LabeledValue label="Nombre" value={data.comprador.nombre} highlight />
                            <LabeledValue label="RUT" value={data.comprador.rut} />
                            <LabeledValue label="Email" value={data.comprador.email} />
                            <LabeledValue label="Teléfono" value={data.comprador.telefono} />
                        </div>
                    </InfoCard>

                    <InfoCard title="Unidad & Precio" icon={<Home className="w-5 h-5"/>}>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <LabeledValue label="Departamento" value={data.propiedad.depto} highlight />
                                {data.propiedad.depto && (
                                    <span className={`text-xs font-bold ${getStatusOfUnit(data.propiedad.depto).color}`}>
                                        Estado Actual: {getStatusOfUnit(data.propiedad.depto).text}
                                    </span>
                                )}
                            </div>
                            <LabeledValue label="Obra / Proyecto" value={data.meta.obra} />
                        </div>
                        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                             <LabeledValue label="Precio Venta" value={data.financiero.precioVenta} />
                             <LabeledValue label="Pie (UF)" value={data.financiero.pie} />
                             <LabeledValue label="Crédito" value={data.financiero.totalEscritura} />
                        </div>
                    </InfoCard>

                    <InfoCard title="Fechas Críticas" icon={<Calendar className="w-5 h-5"/>}>
                        <div className="grid grid-cols-3 gap-4">
                            <LabeledValue label="Fecha Escritura" value={data.fechas.fechaEscritura} />
                            <LabeledValue label="Fecha Entrega" value={data.fechas.fechaEntrega} />
                            <LabeledValue label="Notaría" value={data.fechas.notaria} />
                        </div>
                    </InfoCard>

                    {/* Financial Summary Box */}
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-gray-200 dark:border-gray-700">
                        <h4 className="font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                            <DollarSign className="w-4 h-4" /> Plan de Pagos Detectado
                        </h4>
                        <PaymentTable payments={data.pagos} />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-4 pt-4">
                        <button 
                           onClick={() => setData(null)}
                           className="flex-1 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                            Cancelar
                        </button>
                        <button 
                           onClick={() => onSave(data)}
                           className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 shadow-lg hover:shadow-green-500/30 flex items-center justify-center gap-2"
                        >
                            <CheckCircle className="w-5 h-5" /> Confirmar e Importar
                        </button>
                    </div>

                </div>
            )}
        </div>

      </div>
    </div>
  );
};
