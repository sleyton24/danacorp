import React, { useState } from 'react';
import { User } from '../types';

interface ForcePasswordChangeProps {
  currentUser: User;
  onChanged: () => void;
  onLogout: () => void;
}

// Pantalla bloqueante de cambio de clave en el primer ingreso (password_temporal === true).
// Sin sidebar ni acceso a ninguna vista: solo el formulario y cerrar sesión. Reusa el
// lenguaje visual de LoginScreen (tarjeta blanca centrada, rounded-2xl, inputs rounded-xl).
export const ForcePasswordChange: React.FC<ForcePasswordChangeProps> = ({ currentUser, onChanged, onLogout }) => {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validación de coincidencia en el cliente antes de llamar.
    if (passwordNueva !== passwordConfirm) {
      setError('La nueva contraseña y su confirmación no coinciden.');
      return;
    }
    if (passwordNueva.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('dw_token');
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ passwordActual, passwordNueva }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error || 'No se pudo cambiar la contraseña.');
        return;
      }
      // Actualizar dw_user en localStorage: LoginScreen lo dejó con el flag en true; sin esto,
      // un refresh podría mostrar la pantalla de nuevo.
      try {
        const stored = localStorage.getItem('dw_user');
        if (stored) {
          const u = JSON.parse(stored) as User;
          localStorage.setItem('dw_user', JSON.stringify({ ...u, passwordTemporal: false }));
        }
      } catch { /* dw_user corrupto: no bloquear el flujo */ }
      onChanged();
    } catch {
      setError('No se pudo conectar con el servidor. ¿Está corriendo npm run server?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-10 w-full max-w-md">
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Cambia tu contraseña</h2>
        <p className="text-gray-500 text-sm mb-8">
          Tu cuenta tiene una clave provisoria. Debes cambiarla antes de continuar,
          <span className="font-medium text-gray-700"> {currentUser.name}</span>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Contraseña actual (provisoria)
            </label>
            <input
              type="password"
              value={passwordActual}
              onChange={e => setPasswordActual(e.target.value)}
              placeholder="••••••••"
              required
              autoFocus
              className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all text-gray-900"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Nueva contraseña
            </label>
            <input
              type="password"
              value={passwordNueva}
              onChange={e => setPasswordNueva(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all text-gray-900"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Confirmar nueva contraseña
            </label>
            <input
              type="password"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="Repite la nueva contraseña"
              required
              className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all text-gray-900"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-600 font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-100 active:scale-95"
          >
            {loading ? 'Guardando...' : 'Cambiar contraseña'}
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full py-3 border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition-all"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
};
