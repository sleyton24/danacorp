import React, { useState } from 'react';
import { Notification } from '../types';
import { Bell, Clock, AlertTriangle, Mail, Calendar, Trash2 } from 'lucide-react';

interface NotificationsViewProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeView?: (view: string) => void;
  onMarkAllRead?: () => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({ notifications, onMarkAsRead, onDelete, onChangeView, onMarkAllRead }) => {
  const unreadCount = notifications.filter(n => !n.read).length;

  // Selección masiva (estilo bandeja de correo)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = notifications.length > 0 && notifications.every(n => selected.has(n.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(notifications.map(n => n.id)));
  const handleDeleteSelected = () => {
    selected.forEach(id => onDelete(id));
    setSelected(new Set());
  };

  const getTypeIcon = (type: string) => {
      switch(type) {
          case 'alert': return <AlertTriangle className="w-5 h-5 text-red-500" />;
          case 'warning': return <Clock className="w-5 h-5 text-orange-500" />;
          default: return <Bell className="w-5 h-5 text-blue-500" />;
      }
  };

  const getTypeStyles = (type: string) => {
      switch(type) {
          case 'alert': return 'border-l-4 border-red-500 bg-red-50 dark:bg-red-900/10';
          case 'warning': return 'border-l-4 border-orange-500 bg-orange-50 dark:bg-orange-900/10';
          default: return 'border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/10';
      }
  };

  if (notifications.length === 0) {
      return (
          <div className="animate-fade-in flex flex-col items-center justify-center h-[60vh] text-center p-8">
              <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                  <Bell className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Estás al día</h3>
              <p className="text-gray-500 dark:text-gray-400 mt-2">No tienes notificaciones nuevas.</p>
          </div>
      );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <Bell className="w-6 h-6 text-blue-600" />
                    Centro de Notificaciones
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    Alertas de vencimientos y avisos del sistema.
                </p>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium bg-white dark:bg-gray-800 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                {unreadCount} sin leer
            </div>
        </div>

        {/* Barra de acciones masivas (estilo correo) */}
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                Seleccionar todas
                {selected.size > 0 && <span className="text-xs text-gray-400">({selected.size} seleccionada{selected.size > 1 ? 's' : ''})</span>}
            </label>
            <button
                onClick={handleDeleteSelected}
                disabled={selected.size === 0}
                className="flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-lg transition-colors bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-red-900/20 dark:text-red-400"
            >
                <Trash2 className="w-4 h-4" /> Eliminar seleccionadas
            </button>
        </div>

        <div className="space-y-4">
            {notifications.map(notification => (
                <div
                    key={notification.id}
                    onClick={() => {
                      if (!notification.read) {
                        onMarkAsRead(notification.id);
                        const token = localStorage.getItem('dw_token');
                        if (token) fetch(`/api/notifications/${notification.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
                      }
                      if (notification.linkToView && onChangeView) onChangeView(notification.linkToView);
                    }}
                    className={`relative rounded-xl p-5 border shadow-sm transition-all duration-300 ${getTypeStyles(notification.type)} ${notification.read ? 'opacity-70 grayscale-[0.3]' : 'bg-white dark:bg-gray-800 transform hover:-translate-y-1 shadow-md'} ${notification.linkToView ? 'cursor-pointer' : ''}`}
                >
                    <div className="flex justify-between items-start">
                        <div className="flex gap-4">
                            <input
                                type="checkbox"
                                checked={selected.has(notification.id)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleSelect(notification.id)}
                                className="mt-2 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                                title="Seleccionar"
                            />
                            <div className="mt-1 bg-white dark:bg-gray-700 p-2 rounded-full shadow-sm h-fit">
                                {getTypeIcon(notification.type)}
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h4 className={`font-bold text-lg ${notification.read ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                                        {notification.title}
                                    </h4>
                                    {!notification.read && (
                                        <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                                            NUEVO
                                        </span>
                                    )}
                                </div>
                                <p className="text-gray-600 dark:text-gray-300 text-sm mb-3">
                                    {notification.message}
                                </p>
                                
                                {/* Meta Data */}
                                <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {notification.date}
                                    </span>
                                    {notification.emailSentTo.length > 0 && (
                                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded border border-green-100 dark:border-green-800">
                                            <Mail className="w-3.5 h-3.5" />
                                            Correo enviado a: {notification.emailSentTo.join(', ')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); onDelete(notification.id); }}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                title="Eliminar notificación"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};
