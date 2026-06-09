import React, { useState } from 'react';
import { PaymentItem } from '../types';
import { Calendar, Plus, Check, X } from 'lucide-react';

interface PaymentTableProps {
  payments: PaymentItem[];
  onAddPayment?: (payment: PaymentItem) => void;
}

export const PaymentTable: React.FC<PaymentTableProps> = ({ payments, onAddPayment }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newPayment, setNewPayment] = useState<PaymentItem>({
    id: `F.${payments.length + 1}`,
    date: '',
    amount: '',
    status: 'Pendiente'
  });

  const formatUF = (val: number) => {
      return val.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  const handleSave = () => {
    if (newPayment.date && newPayment.amount && onAddPayment) {
      onAddPayment(newPayment);
      setIsAdding(false);
      setNewPayment({
        id: `F.${payments.length + 2}`, // Suggest next ID
        date: '',
        amount: '',
        status: 'Pendiente'
      });
    }
  };

  if (payments.length === 0 && !isAdding) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 italic text-sm mb-3">No hay pagos registrados.</p>
        {onAddPayment && (
          <button 
            onClick={() => setIsAdding(true)}
            className="text-blue-600 text-sm font-medium hover:text-blue-700 flex items-center justify-center gap-1 mx-auto"
          >
            <Plus className="w-4 h-4" /> Agregar primer pago
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 font-semibold text-gray-600">Cuota</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-3 font-semibold text-gray-600 text-right">Monto (UF)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {payments.map((payment, index) => {
              const numAmount = parseFloat(payment.amount.replace(/[^\d.-]/g, '')) || 0;
              return (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-gray-600 font-medium">{payment.id || `F.${index + 1}`}</td>
                <td className="px-4 py-2.5 text-gray-800 flex items-center gap-2">
                  <Calendar className="w-3 h-3 text-gray-400" />
                  {payment.date}
                </td>
                <td className="px-4 py-2.5 text-gray-900 font-mono text-right">{formatUF(numAmount)}</td>
              </tr>
            )})}
            
            {/* Adding Row */}
            {isAdding && (
              <tr className="bg-blue-50/50">
                <td className="px-4 py-2">
                  <input 
                    type="text" 
                    value={newPayment.id} 
                    onChange={e => setNewPayment({...newPayment, id: e.target.value})}
                    className="w-16 px-2 py-1 text-sm border border-blue-200 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                  />
                </td>
                <td className="px-4 py-2">
                  <input 
                    type="date" 
                    value={newPayment.date} 
                    onChange={e => setNewPayment({...newPayment, date: e.target.value})}
                    className="w-full px-2 py-1 text-sm border border-blue-200 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white text-gray-700"
                  />
                </td>
                <td className="px-4 py-2">
                  <input 
                    type="number" 
                    placeholder="0.0"
                    step="0.1"
                    value={newPayment.amount} 
                    onChange={e => setNewPayment({...newPayment, amount: e.target.value})}
                    className="w-full px-2 py-1 text-sm border border-blue-200 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white text-right font-mono"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Actions */}
      {onAddPayment && (
        <div className="pt-3 border-t border-gray-100 mt-2">
          {isAdding ? (
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded flex items-center gap-1 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={!newPayment.date || !newPayment.amount}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="w-3.5 h-3.5" /> Guardar
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setIsAdding(true)}
              className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Agregar nueva cuota
            </button>
          )}
        </div>
      )}
    </div>
  );
};