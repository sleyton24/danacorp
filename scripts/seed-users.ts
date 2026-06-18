import bcrypt from 'bcryptjs';
import { db } from '../db';

// Los 5 usuarios que antes estaban hardcodeados en texto plano en server.ts.
// Se siembran con hash bcrypt. ON CONFLICT (id) DO NOTHING -> idempotente: re-ejecutar
// no pisa contraseñas ya cambiadas. Las claves iniciales se deben rotar tras el primer login.
const USERS = [
  { id: 'u1', name: 'Administrador Principal', email: 'admin@danacorp.cl',      password: 'admin123',      role: 'Admin',      company: 'Danacorp',        assignedProjectIds: [] as string[] },
  { id: 'u3', name: 'Jefe de Sala',            email: 'jefe@danacorp.cl',       password: 'jefe123',       role: 'JefeSala',   company: 'Sala de Ventas',  assignedProjectIds: ['p1'] },
  { id: 'u5', name: 'Supervisor Demo',         email: 'supervisor@danacorp.cl', password: 'supervisor123', role: 'Supervisor', company: 'Danacorp',        assignedProjectIds: ['p1'] },
  { id: 'u2', name: 'Vendedor Demo',           email: 'vendedor@danacorp.cl',   password: 'vendedor123',   role: 'Ventas',     company: 'Danacorp Ventas', assignedProjectIds: ['p1'] },
  { id: 'u4', name: 'Solo Lectura',            email: 'lectura@danacorp.cl',    password: 'lectura123',    role: 'Lectura',    company: 'Danacorp',        assignedProjectIds: [] },
];

export async function seedUsers(): Promise<number> {
  let inserted = 0;
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const r = await db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, company, assigned_project_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `).run(u.id, u.name, u.email, hash, u.role, u.company, JSON.stringify(u.assignedProjectIds));
    inserted += r.changes;
  }
  return inserted;
}
