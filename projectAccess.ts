export type ProjectScopedUser = {
  id: string;
  role: string;
  assignedProjectIds: readonly string[];
};

export type ProjectAccessDecision =
  | { allowed: true; reason: 'admin' | 'assigned' }
  | { allowed: false; reason: 'not-assigned' | 'unassigned-empty' | 'missing-project-id' };

export function getProjectAccessDecision(user: ProjectScopedUser, projectId: string | null | undefined): ProjectAccessDecision {
  if (!projectId) return { allowed: false, reason: 'missing-project-id' };
  if (user.role === 'Admin') return { allowed: true, reason: 'admin' };

  // Decision definitiva: para un usuario no-admin, assigned_project_ids: []
  // significa "sin acceso / aun no asignado" (NO acceso global). Se distingue
  // de 'not-assigned' (tiene proyectos, pero no este) con la razon
  // 'unassigned-empty' para poder poblar sus asignaciones antes de bloquear.
  if (user.assignedProjectIds.length === 0) {
    return { allowed: false, reason: 'unassigned-empty' };
  }

  if (user.assignedProjectIds.includes(projectId)) {
    return { allowed: true, reason: 'assigned' };
  }

  return { allowed: false, reason: 'not-assigned' };
}

export function canAccessProject(user: ProjectScopedUser, projectId: string | null | undefined): boolean {
  return getProjectAccessDecision(user, projectId).allowed;
}
