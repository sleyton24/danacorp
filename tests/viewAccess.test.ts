import { describe, it, expect } from 'vitest';
import { canViewView, vistaInicial, ADMIN_ONLY_VIEWS } from '../src/utils/viewAccess';

// Fase 1 · Parte 4 — vista de aterrizaje por rol y guard de vistas.
const ROLES = ['Admin', 'Supervisor', 'JefeSala', 'Ventas', 'Lectura'] as const;

describe('vistaInicial', () => {
  it('Ventas aterriza en performance', () => {
    expect(vistaInicial('Ventas')).toBe('performance');
  });

  it('los otros cuatro roles siguen aterrizando en summary', () => {
    for (const role of ROLES.filter(r => r !== 'Ventas')) {
      expect(vistaInicial(role)).toBe('summary');
    }
  });
});

describe('canViewView', () => {
  it('Ventas no puede renderizar summary (inventario completo, UF total, mix de bancos)', () => {
    expect(canViewView('Ventas', 'summary')).toBe(false);
  });

  it('los otros roles sí pueden ver summary', () => {
    for (const role of ROLES.filter(r => r !== 'Ventas')) {
      expect(canViewView(role, 'summary')).toBe(true);
    }
  });

  it('la vista de aterrizaje de cada rol es siempre una vista que ese rol puede ver', () => {
    // Si esto se rompe, el fallback del guard entra en contradicción consigo mismo.
    for (const role of ROLES) {
      expect(canViewView(role, vistaInicial(role))).toBe(true);
    }
  });

  it('Ventas conserva sus vistas de trabajo', () => {
    for (const view of ['quoter', 'clients', 'inventory', 'prices', 'performance', 'notifications', 'settings']) {
      expect(canViewView('Ventas', view)).toBe(true);
    }
  });

  it('las vistas admin-only siguen cerradas para todos los no-Admin', () => {
    for (const view of ADMIN_ONLY_VIEWS) {
      for (const role of ROLES.filter(r => r !== 'Admin')) {
        expect(canViewView(role, view)).toBe(false);
      }
      expect(canViewView('Admin', view)).toBe(true);
    }
  });

  it('aprobaciones sigue siendo de Supervisor, JefeSala y Admin', () => {
    expect(canViewView('Supervisor', 'approvals')).toBe(true);
    expect(canViewView('JefeSala', 'approvals')).toBe(true);
    expect(canViewView('Admin', 'approvals')).toBe(true);
    expect(canViewView('Ventas', 'approvals')).toBe(false);
    expect(canViewView('Lectura', 'approvals')).toBe(false);
  });

  it('Lectura sigue sin performance', () => {
    expect(canViewView('Lectura', 'performance')).toBe(false);
  });
});
