import React, { useState } from 'react';
import { User } from '../types';

interface LoginScreenProps {
  onLogin: (user: User, token: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error || 'Credenciales incorrectas');
        return;
      }
      const data = await res.json() as { token: string; user: User };
      localStorage.setItem('dw_token', data.token);
      localStorage.setItem('dw_user', JSON.stringify(data.user));
      onLogin(data.user, data.token);
    } catch {
      setError('No se pudo conectar con el servidor. ¿Está corriendo npm run server?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-10 w-full max-w-md">

        <div className="flex items-center justify-center bg-white rounded-lg w-full h-24 px-3 py-2 overflow-hidden mb-6">
          <img
            src="/Danacorp.png"
            alt="Danacorp"
            className="max-h-full max-w-full object-contain"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              img.insertAdjacentHTML('afterend',
                '<span class="font-black text-blue-600 text-2xl">DANACORP</span>');
            }}
          />
        </div>

        <h2 className="text-2xl font-bold text-gray-800 mb-1">Iniciar Sesión</h2>
        <p className="text-gray-500 text-sm mb-8">Ingresa tus credenciales para continuar.</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@danacorp.cl"
              required
              autoFocus
              className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all text-gray-900"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
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
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest text-center mb-3">
            Usuarios de prueba
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="font-bold text-gray-700">Admin</div>
              <div className="font-mono">admin@danacorp.cl</div>
              <div className="font-mono text-gray-400">admin123</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="font-bold text-gray-700">JefeSala</div>
              <div className="font-mono">jefe@danacorp.cl</div>
              <div className="font-mono text-gray-400">jefe123</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="font-bold text-gray-700">Supervisor</div>
              <div className="font-mono">supervisor@danacorp.cl</div>
              <div className="font-mono text-gray-400">supervisor123</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="font-bold text-gray-700">Ventas</div>
              <div className="font-mono">vendedor@danacorp.cl</div>
              <div className="font-mono text-gray-400">vendedor123</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
