import { describe, expect, it } from 'vitest';
import { canAccessProject, getProjectAccessDecision, type ProjectScopedUser } from '../projectAccess';

const user = (overrides: Partial<ProjectScopedUser>): ProjectScopedUser => ({
  id: 'u-test',
  role: 'Ventas',
  assignedProjectIds: [],
  ...overrides,
});

describe('canAccessProject', () => {
  it('permite a Admin ver cualquier proyecto', () => {
    expect(canAccessProject(user({ role: 'Admin', assignedProjectIds: [] }), 'p1')).toBe(true);
    expect(getProjectAccessDecision(user({ role: 'Admin' }), 'p2').reason).toBe('admin');
  });

  it('permite a un vendedor asignado ver solo sus proyectos', () => {
    const vendedor = user({ assignedProjectIds: ['p1', 'p3'] });

    expect(canAccessProject(vendedor, 'p1')).toBe(true);
    expect(canAccessProject(vendedor, 'p3')).toBe(true);
  });

  it('niega a un vendedor con proyectos poblados cuando el proyecto no esta asignado', () => {
    const vendedor = user({ assignedProjectIds: ['p1'] });

    expect(canAccessProject(vendedor, 'p2')).toBe(false);
    expect(getProjectAccessDecision(vendedor, 'p2')).toEqual({ allowed: false, reason: 'not-assigned' });
  });

  it('niega a un vendedor sin proyectos asignados ([]) — sin acceso, no acceso global', () => {
    const vendedor = user({ role: 'Ventas', assignedProjectIds: [] });

    expect(canAccessProject(vendedor, 'p1')).toBe(false);
    expect(getProjectAccessDecision(vendedor, 'p1')).toEqual({ allowed: false, reason: 'unassigned-empty' });
  });

  it('niega a Lectura con assigned_project_ids vacio ([] = sin acceso / aun no asignado)', () => {
    const lectura = user({ role: 'Lectura', assignedProjectIds: [] });

    expect(canAccessProject(lectura, 'p-legacy')).toBe(false);
    expect(getProjectAccessDecision(lectura, 'p-legacy').reason).toBe('unassigned-empty');
  });

  it('niega cuando no hay projectId evaluable', () => {
    expect(canAccessProject(user({ role: 'Ventas', assignedProjectIds: ['p1'] }), '')).toBe(false);
  });
});
