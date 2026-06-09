import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { Camera, Save, Moon, Sun, Briefcase } from 'lucide-react';

interface SettingsPanelProps {
  currentUser: User;
  users: User[]; // Kept for interface compatibility but not used for list
  onAddUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
  onUpdateUser: (user: User) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  currentUser, 
  onUpdateUser,
  darkMode,
  toggleDarkMode
}) => {
  // Profile Edit State
  const [profileForm, setProfileForm] = useState({
      name: currentUser.name,
      email: currentUser.email,
      company: currentUser.company || ''
  });

  useEffect(() => {
      setProfileForm({
          name: currentUser.name,
          email: currentUser.email,
          company: currentUser.company || ''
      });
  }, [currentUser]);

  const handleUpdateProfile = (e: React.FormEvent) => {
      e.preventDefault();
      onUpdateUser({
          ...currentUser,
          name: profileForm.name,
          email: profileForm.email,
          company: profileForm.company
      });
      alert('Perfil actualizado correctamente');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
           <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Configuración</h2>
           <p className="text-gray-500 dark:text-gray-400">Administra tu perfil y las preferencias del sistema.</p>
        </div>
      </div>

      {/* Profile Tab Content (Now the only content) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
               <h3 className="font-bold text-gray-800 dark:text-white mb-6">Información Personal</h3>
               
               <div className="flex items-center gap-6 mb-8">
                  <div className="relative group cursor-pointer">
                      <div className="w-24 h-24 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 text-3xl font-bold">
                          {currentUser.avatar ? (
                              <img src={currentUser.avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                          ) : (
                              currentUser.name.charAt(0)
                          )}
                      </div>
                      <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Camera className="w-6 h-6 text-white" />
                      </div>
                  </div>
                  <div>
                      <h4 className="text-xl font-bold text-gray-900 dark:text-white">{currentUser.name}</h4>
                      <p className="text-gray-500 dark:text-gray-400">{currentUser.email}</p>
                      <div className="flex gap-2 mt-2">
                        <span className="inline-block px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-bold rounded">
                            {currentUser.role}
                        </span>
                        {currentUser.company && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 text-xs font-bold rounded">
                                <Briefcase className="w-3 h-3"/> {currentUser.company}
                            </span>
                        )}
                      </div>
                  </div>
               </div>

               <form onSubmit={handleUpdateProfile} className="space-y-4">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre Completo</label>
                      <input 
                        type="text" 
                        value={profileForm.name}
                        onChange={(e) => setProfileForm({...profileForm, name: e.target.value})}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo Electrónico</label>
                      <input 
                        type="email" 
                        value={profileForm.email}
                        onChange={(e) => setProfileForm({...profileForm, email: e.target.value})}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Empresa</label>
                      <input 
                        type="text" 
                        value={profileForm.company}
                        onChange={(e) => setProfileForm({...profileForm, company: e.target.value})}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                  </div>

                  <div className="pt-4">
                      <button 
                        type="submit"
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
                      >
                          <Save className="w-4 h-4" /> Actualizar Perfil
                      </button>
                  </div>
               </form>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 h-fit">
                <h3 className="font-bold text-gray-800 dark:text-white mb-6">Apariencia</h3>
                
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${darkMode ? 'bg-indigo-900 text-indigo-300' : 'bg-yellow-100 text-yellow-600'}`}>
                            {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                        </div>
                        <div>
                            <p className="font-medium text-gray-900 dark:text-white">Modo Blackout</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Cambia entre tema claro y oscuro.</p>
                        </div>
                    </div>
                    <button 
                        onClick={toggleDarkMode}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${darkMode ? 'bg-blue-600' : 'bg-gray-200'}`}
                    >
                        <span 
                           className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} 
                        />
                    </button>
                </div>
            </div>
      </div>
    </div>
  );
};