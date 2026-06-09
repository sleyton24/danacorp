import React from 'react';
import { RealEstateUnit, Client, Project } from '../types';
import { Download, FileSpreadsheet, Info, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';

interface DownloadsViewProps {
  units: RealEstateUnit[];
  clients: Client[];
  project?: Project;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({ units, clients, project }) => {
  
  const handleExportDataSheet = () => {
    if (!units.length) return;

    // Calcular máximos globales para definición de columnas dinámicas
    const maxParkings = Math.max(...units.map(u => u.estacionamientos?.length || 0), 0);
    const maxStorages = Math.max(...units.map(u => u.bodegas?.length || 0), 0);
    
    // Determinamos el máximo de movimientos con estado 'Pagado' para las columnas de pagos
    const maxPayments = Math.max(...units.map(u => u.planPagos.filter(p => p.status === 'Pagado').length), 0);

    // Preparar la data para el Excel (Sábana de Datos)
    const reportData = units.map(unit => {
      const client = unit.clienteId ? clients.find(c => c.id === unit.clienteId) : null;
      
      // Encontrar desistimientos en el historial del cliente (si aplica a esta unidad)
      const desistments = client?.historial
        .filter(h => h.tipo === 'Desistimiento' && h.descripcion.includes(unit.numero))
        .map(h => `${h.fecha}: ${h.descripcion}`)
        .join(' | ') || 'Sin desistimientos';

      // Filtrar solo movimientos pagados para el desglose por columnas
      const paidMovements = unit.planPagos.filter(p => p.status === 'Pagado');

      // Objeto base con datos generales y comerciales
      const row: any = {
        'ID Sistema': unit.id,
        'Tipo': unit.type,
        'Número Unidad': unit.numero,
        'Estado Comercial': unit.estado,
        'Piso': unit.piso || '-',
        'Orientación': unit.orientacion || '-',
        'Dormitorios': unit.dormitorios || '-',
        'Baños': unit.banos || '-',
        'Superficie (m2)': unit.superficie || '-',
        'Atributos / Atributo': unit.observaciones || '-',
        
        'Precio de Lista (UF)': unit.precioLista,
        'Precio de Venta (UF)': unit.precioVenta,
        'Monto Reserva (UF)': unit.reservaMonto,
        'Monto Pie (UF)': unit.pie,
        'Crédito Hipotecario (UF)': unit.creditoHipotecario,
        'Total Pagado (UF)': unit.totalPagado,
        'Saldo por Pagar (UF)': unit.saldoPorPagar,
        
        'Banco': unit.banco || '-',
        'Notaría': unit.notaria || '-',
        'Repertorio': unit.repertorio || '-',
        
        'Fecha Reserva': unit.fechaReserva || '-',
        'Fecha Promesa': unit.fechaPromesa || '-',
        'Fecha Escritura': unit.fechaEscritura || '-',
        'Fecha Entrega': unit.fechaEntrega || '-',
        
        'Nombre Titular': client?.nombre || 'SIN ASIGNAR',
        'RUT Titular': client?.rut || '-',
        'Email Titular': client?.email || '-',
        'Teléfono Titular': client?.telefono || '-',
      };

      // Agregar columnas dinámicas para Estacionamientos
      for (let i = 0; i < maxParkings; i++) {
        row[`Estacionamiento ${i + 1}`] = unit.estacionamientos[i] || '-';
      }

      // Agregar columnas dinámicas para Bodegas
      for (let i = 0; i < maxStorages; i++) {
        row[`Bodega ${i + 1}`] = unit.bodegas[i] || '-';
      }

      // 1. Columnas dinámicas de Montos Pagados
      for (let i = 0; i < maxPayments; i++) {
        row[`Monto Pago ${i + 1} (UF)`] = paidMovements[i] ? parseFloat(paidMovements[i].amount) : '-';
      }

      // 2. Columnas dinámicas de Fechas donde se registró el pago (Fecha Real)
      for (let i = 0; i < maxPayments; i++) {
        row[`Fecha Real Pago ${i + 1}`] = paidMovements[i]?.fechaPagoReal || '-';
      }

      // 3. Columnas dinámicas de Fechas de Vencimiento de los movimientos pagados
      for (let i = 0; i < maxPayments; i++) {
        row[`Vencimiento Pago ${i + 1}`] = paidMovements[i]?.date || '-';
      }

      // Agregar desistimientos al final
      row['Desistimientos Registrados'] = desistments;

      return row;
    });

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sábana de Datos");
    
    const fileName = `Sabana_Datos_${project?.nombre.replace(/\s+/g, '_') || 'Proyecto'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
        <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
                <Download className="w-7 h-7 text-blue-600" />
                Descargas y Reportes
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
                Herramientas de extracción masiva de datos para auditoría y gestión externa.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-start gap-6 transition-all hover:shadow-md hover:border-blue-300 group">
                <div className="w-14 h-14 bg-green-50 dark:bg-green-900/30 rounded-2xl flex items-center justify-center text-green-600 dark:text-green-400 group-hover:scale-110 transition-transform">
                    <FileSpreadsheet className="w-8 h-8" />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Sábana de Datos Consolidada</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                        Exporta un archivo Excel (.xlsx) con el listado completo de unidades, vinculación de activos y el detalle cronológico de pagos desglosado por columnas.
                    </p>
                </div>
                
                <div className="w-full space-y-4 pt-4 border-t border-gray-50 dark:border-gray-700">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Estructura Dinámica:</h4>
                    <ul className="grid grid-cols-2 gap-y-2">
                        {['Atributos Unidad', 'Activos Asociados', 'Montos Pagados', 'Fechas Pago Real', 'Vencimientos Pagos', 'Desistimientos'].map(item => (
                            <li key={item} className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300">
                                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> {item}
                            </li>
                        ))}
                    </ul>
                </div>

                <button 
                    onClick={handleExportDataSheet}
                    className="mt-4 w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-blue-100 dark:shadow-none transition-all active:scale-95"
                >
                    <Download className="w-5 h-5" /> Emitir Sábana de Datos
                </button>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/10 rounded-2xl p-8 border border-blue-100 dark:border-blue-900/50 flex flex-col justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-4">
                        <Info className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        <h3 className="font-bold text-blue-900 dark:text-blue-300 uppercase tracking-tight">Notas de Generación</h3>
                    </div>
                    <div className="space-y-4 text-sm text-blue-800/80 dark:text-blue-200/60 leading-relaxed font-medium">
                        <p>• <strong>Desglose de Pagos:</strong> El sistema genera grupos de columnas para cada pago (Monto, Fecha Real, Vencimiento) facilitando la conciliación bancaria.</p>
                        <p>• <strong>Máximo de Columnas:</strong> La sábana se expande automáticamente según el cliente que registre más movimientos pagados en el proyecto.</p>
                        <p>• <strong>Activos Vinculados:</strong> Cada unidad mantiene sus estacionamientos y bodegas en columnas independientes.</p>
                    </div>
                </div>
                <div className="mt-8 pt-6 border-t border-blue-200 dark:border-blue-800">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Proyecto Actual</p>
                    <p className="text-lg font-bold text-blue-900 dark:text-blue-300">{project?.nombre || 'Cargando...'}</p>
                </div>
            </div>
        </div>
    </div>
  );
};
