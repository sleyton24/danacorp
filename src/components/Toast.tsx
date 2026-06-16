import React, { useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

interface ToastItemProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
} as const;

const STYLES = {
  success: {
    container: 'bg-white border border-green-200 shadow-lg',
    icon: 'text-green-500',
    bar: 'bg-green-500',
  },
  error: {
    container: 'bg-white border border-red-200 shadow-lg',
    icon: 'text-red-500',
    bar: 'bg-red-500',
  },
  warning: {
    container: 'bg-white border border-yellow-200 shadow-lg',
    icon: 'text-yellow-500',
    bar: 'bg-yellow-400',
  },
} as const;

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);

  // Trigger slide-in on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Auto-close after 3 s
  useEffect(() => {
    timerRef.current = setTimeout(() => handleClose(), 3000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  const Icon = ICONS[toast.type];
  const style = STYLES[toast.type];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        'relative flex items-start gap-3 rounded-xl px-4 py-3 pr-9 max-w-sm w-full overflow-hidden',
        'transition-all duration-300 ease-out',
        style.container,
        visible && !leaving
          ? 'translate-x-0 opacity-100'
          : leaving
          ? 'translate-x-8 opacity-0'
          : 'translate-x-full opacity-0',
      ].join(' ')}
    >
      {/* Progress bar */}
      <div className={`absolute bottom-0 left-0 h-0.5 ${style.bar} animate-toast-shrink`} />

      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${style.icon}`} />
      <span className="text-sm font-medium text-gray-800 leading-snug">{toast.message}</span>

      {/* Close button */}
      <button
        onClick={handleClose}
        aria-label="Cerrar notificación"
        className="absolute top-2.5 right-2.5 p-0.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notificaciones"
      className="fixed bottom-6 right-6 z-[9997] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
};
