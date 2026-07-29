/**
 * Guard de rol para vistas + vista de aterrizaje por rol.
 *
 * Vivían dentro de App.tsx, donde no eran testeables sin montar todo el árbol de React.
 * Son funciones puras y son security-adjacent (una regresión acá expone una vista
 * privilegiada en silencio), así que viven en su propio módulo con tests.
 */

// Refleja el gating del Sidebar, pero se valida en el RENDER (no solo ocultando el ítem),
// para que ninguna vista privilegiada se renderice si se llega por otra vía — p.ej. un link
// de notificación que hace setCurrentView directo.
export const ADMIN_ONLY_VIEWS = ['audit', 'downloads', 'profile_admin', 'create_project', 'manage_projects'];

export function canViewView(role: string, view: string): boolean {
  if (role === 'Admin') return true;
  if (ADMIN_ONLY_VIEWS.includes(view)) return false;
  if (view === 'approvals') return ['Supervisor', 'JefeSala'].includes(role);
  if (view === 'performance') return role !== 'Lectura';
  // Resumen expone inventario completo, UF total del proyecto y mix de bancos. El Sidebar
  // ya se lo ocultaba a Ventas; acá se cierra también en el render, que era el hueco por el
  // que un vendedor entraba igual (el estado inicial y los fallbacks apuntaban ahí).
  if (view === 'summary') return role !== 'Ventas';
  return true; // quoter, clients, inventory, prices, settings, notifications
}

/**
 * Vista de aterrizaje por rol. Un usuario Ventas cae en Performance, que ya tiene su
 * versión recortada (sin ranking, sin matriz de vendedores y con el filtro de vendedor
 * fijado en él mismo). Se usa en los cuatro puntos donde antes se forzaba 'summary':
 * login, restauración de sesión, fallback del guard y cambio de proyecto.
 */
export function vistaInicial(role: string): 'summary' | 'performance' {
  return role === 'Ventas' ? 'performance' : 'summary';
}
