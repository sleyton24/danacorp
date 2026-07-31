import { db } from '../db';

/**
 * Datos sintéticos para verificar de punta a punta el rediseño de Resumen/Performance
 * (docs/propuesta-analitica) contra un Postgres LOCAL de desarrollo — nunca apuntar esto
 * al VPS de producción. Puerto a TypeScript del generador de docs/propuesta-analitica/
 * prototipo.html (funciones `generar()`/`vaciar()`), respetando el esquema real y las
 * invariantes de dominio: una unidad no sale de Disponible sin cliente asignado,
 * Escriturado es terminal, plan_pagos coherente con el estado.
 *
 * Idempotente por reset: borra y vuelve a crear únicamente los proyectos DEMO_PROJECT_IDS,
 * así se puede re-ejecutar mientras se itera sin acumular basura ni requerir ON CONFLICT
 * por fila.
 *
 * Uso: npx tsx scripts/seed-analitica-demo.ts
 */

const DEMO_PROJECT_IDS = ['demo-sv155', 'demo-sv999'];

// Vendedores = los usuarios ya sembrados por seed-users.ts (no se crean usuarios nuevos).
const VENDEDORES = [
  { id: 'u2', name: 'Vendedor Demo' },
  { id: 'u3', name: 'Jefe de Sala' },
  { id: 'u5', name: 'Supervisor Demo' },
  { id: 'u1', name: 'Administrador Principal' },
];

const BANCOS = ['BANCO DE CHILE', 'SANTANDER', 'BCI', 'ESTADO', 'ITAU'];

// PRNG determinista (mismo algoritmo que el prototipo) — no Math.random(), para que cada
// corrida produzca la misma distribución y sea fácil comparar antes/después de un cambio.
let seed = 20260731;
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rnd() * arr.length)]; }
function entre(a: number, b: number): number { return a + Math.floor(rnd() * (b - a + 1)); }

const AHORA = new Date();
const isoFecha = (d: Date) => d.toISOString().slice(0, 10);
/** Fecha de hito hace `mesesAtras` meses, día aleatorio del mes (igual criterio que el prototipo). */
function fechaHace(mesesAtras: number): string {
  const d = new Date(AHORA.getFullYear(), AHORA.getMonth() - mesesAtras, entre(1, 28));
  return isoFecha(d);
}

interface UnidadDemo {
  id: string; projectId: string; type: 'Departamento' | 'Bodega' | 'Estacionamiento';
  numero: string; piso: number | null; dormitorios?: number; banos?: number;
  superficie: number; precioVenta: number; estado: string;
  banco: string | null; ejecutivoId: string | null; fechaHito: string | null;
  bodegas: string[]; estacionamientos: string[];
  clienteId: string | null;
}

/**
 * Genera un proyecto con departamentos (con vínculos a bodegas/estacionamientos propios) y
 * clientes coherentes con el estado de las unidades que se les asignan.
 */
function generarProyecto(projectId: string, nDeptos: number, nEstac: number, nBod: number, poblado: boolean) {
  const pisos = 12;
  const porPiso = Math.max(1, Math.round(nDeptos / pisos));
  const deptos: UnidadDemo[] = [];
  const clientes: Array<{ id: string; nombre: string; rut: string; estado: string; ejecutivoId: string; fechaRegistro: string }> = [];
  let n = 0, nCliente = 0;

  for (let piso = 1; piso <= pisos && n < nDeptos; piso++) {
    for (let i = 0; i < porPiso && n < nDeptos; i++) {
      n++;
      const dorms = pick([1, 2, 2, 3, 3, 3]);
      const banos = dorms === 1 ? 1 : dorms === 2 ? 2 : (rnd() > 0.5 ? 2 : 3);
      const superficie = Math.round((32 + dorms * 18 + rnd() * 12) * 100) / 100;
      const factorPiso = 1 + piso * 0.008;
      const precioVenta = Math.round(superficie * (68 + rnd() * 14) * factorPiso * 10) / 10;

      let estado = 'Disponible';
      if (poblado) {
        const p = rnd();
        if (p < 0.34 + piso * 0.012) estado = 'Escriturado';
        else if (p < 0.50) estado = 'Promesado';
        else if (p < 0.58) estado = 'Reservado';
      }

      const mesesAtras = estado === 'Disponible' ? null : entre(0, 17);
      const fechaHito = mesesAtras === null ? null : fechaHace(mesesAtras);
      const ejecutivoId = estado === 'Disponible' ? null : pick(VENDEDORES).id;
      const banco = (estado === 'Promesado' || estado === 'Escriturado') ? pick(BANCOS) : null;

      let clienteId: string | null = null;
      if (estado !== 'Disponible') {
        nCliente++;
        clienteId = `${projectId}-C${String(nCliente).padStart(3, '0')}`;
        const clienteEstado = estado === 'Escriturado' ? 'Cerrado' : estado === 'Promesado' ? 'Activo' : 'Activo';
        clientes.push({
          id: clienteId, nombre: `Cliente ${projectId} ${nCliente}`,
          rut: `${entre(6, 20)}.${entre(100, 999)}.${entre(100, 999)}-${entre(0, 9)}`,
          estado: clienteEstado, ejecutivoId: ejecutivoId!, fechaRegistro: fechaHito!,
        });
      }

      deptos.push({
        id: `${projectId}-D${String(n).padStart(3, '0')}`, projectId, type: 'Departamento',
        numero: `${piso}${String(i + 1).padStart(2, '0')}`, piso, dormitorios: dorms, banos, superficie,
        precioVenta, estado, banco, ejecutivoId, fechaHito, bodegas: [], estacionamientos: [], clienteId,
      });
    }
  }

  // Prospectos sueltos, sin unidad asignada — igual que el prototipo, para que la matriz de
  // vendedores tenga clientes registrados que no necesariamente cerraron.
  const nProspectos = poblado ? Math.round(deptos.length * 0.4) : 0;
  for (let i = 0; i < nProspectos; i++) {
    nCliente++;
    const mesesAtras = entre(0, 17);
    clientes.push({
      id: `${projectId}-C${String(nCliente).padStart(3, '0')}`, nombre: `Prospecto ${projectId} ${nCliente}`,
      rut: `${entre(6, 20)}.${entre(100, 999)}.${entre(100, 999)}-${entre(0, 9)}`,
      estado: 'Prospecto', ejecutivoId: pick(VENDEDORES).id, fechaRegistro: fechaHace(mesesAtras),
    });
  }

  const otras: UnidadDemo[] = [];
  const numerosBodegaPorDepto = new Map<string, string[]>();
  const numerosEstacPorDepto = new Map<string, string[]>();

  // Vinculada = tiene padre Y ese padre está efectivamente ocupado (no Disponible). Un
  // padre Disponible no "asigna" nada — la bodega/estacionamiento sigue Libre Asignación,
  // si no queda 'Asignado' sin cliente_id, violando la misma invariante que a los deptos.
  for (let i = 0; i < nEstac; i++) {
    const numero = `E${i + 1}`;
    const candidato = rnd() > 0.42 ? pick(deptos) : null;
    const padre = candidato && candidato.estado !== 'Disponible' ? candidato : null;
    otras.push({
      id: `${projectId}-E${String(i + 1).padStart(3, '0')}`, projectId, type: 'Estacionamiento',
      numero, piso: null, superficie: 12.5, precioVenta: Math.round((180 + rnd() * 90) * 10) / 10,
      estado: padre ? 'Asignado' : 'Libre Asignación', banco: null,
      ejecutivoId: padre?.ejecutivoId ?? null, fechaHito: padre?.fechaHito ?? null,
      bodegas: [], estacionamientos: [], clienteId: padre?.clienteId ?? null,
    });
    if (padre) numerosEstacPorDepto.set(padre.id, [...(numerosEstacPorDepto.get(padre.id) ?? []), numero]);
  }
  for (let i = 0; i < nBod; i++) {
    const numero = `B${i + 1}`;
    const candidato = rnd() > 0.45 ? pick(deptos) : null;
    const padre = candidato && candidato.estado !== 'Disponible' ? candidato : null;
    otras.push({
      id: `${projectId}-B${String(i + 1).padStart(3, '0')}`, projectId, type: 'Bodega',
      numero, piso: null, superficie: 4.2, precioVenta: Math.round((55 + rnd() * 40) * 10) / 10,
      estado: padre ? 'Asignado' : 'Libre Asignación', banco: null,
      ejecutivoId: padre?.ejecutivoId ?? null, fechaHito: padre?.fechaHito ?? null,
      bodegas: [], estacionamientos: [], clienteId: padre?.clienteId ?? null,
    });
    if (padre) numerosBodegaPorDepto.set(padre.id, [...(numerosBodegaPorDepto.get(padre.id) ?? []), numero]);
  }

  for (const d of deptos) {
    d.bodegas = numerosBodegaPorDepto.get(d.id) ?? [];
    d.estacionamientos = numerosEstacPorDepto.get(d.id) ?? [];
  }

  return { units: [...deptos, ...otras], clientes };
}

/** plan_pagos coherente con el estado: nada si Disponible, cuotas parciales si Promesado, mayormente pagado si Escriturado. */
function planPagosPara(estado: string, precioVenta: number, fechaHito: string | null): unknown[] {
  if (estado === 'Disponible' || !fechaHito) return [];
  const cuota = (idx: number, monto: number, pagado: boolean, fecha: string) => ({
    uid: crypto.randomUUID(), id: `Cuota ${idx}`, date: fecha, amount: String(Math.round(monto * 10) / 10),
    status: pagado ? 'Pagado' : 'Pendiente', fechaPagoReal: pagado ? fecha : '', observacion: '',
  });
  if (estado === 'Reservado') {
    return [cuota(1, Math.round(precioVenta * 0.02 * 10) / 10, true, fechaHito)];
  }
  if (estado === 'Promesado') {
    const pie = Math.round(precioVenta * (0.05 + rnd() * 0.15) * 10) / 10;
    return [cuota(1, pie, true, fechaHito)];
  }
  // Escriturado: varias cuotas, la mayoría pagadas.
  const nCuotas = entre(3, 6);
  const montoCuota = Math.round((precioVenta * (0.55 + rnd() * 0.4) / nCuotas) * 10) / 10;
  return Array.from({ length: nCuotas }, (_, i) => cuota(i + 1, montoCuota, i < nCuotas - 1, fechaHito));
}

async function limpiarDemoAnterior() {
  await db.prepare(`DELETE FROM units WHERE project_id = ANY(?)`).run(DEMO_PROJECT_IDS);
  await db.prepare(`DELETE FROM clients WHERE project_id = ANY(?)`).run(DEMO_PROJECT_IDS);
  await db.prepare(`DELETE FROM project_configs WHERE project_id = ANY(?)`).run(DEMO_PROJECT_IDS);
  await db.prepare(`DELETE FROM projects WHERE id = ANY(?)`).run(DEMO_PROJECT_IDS);
}

async function sembrarProyecto(projectId: string, nombre: string, nDeptos: number, nEstac: number, nBod: number, poblado: boolean) {
  await db.prepare(`INSERT INTO projects (id, nombre, fecha_creacion) VALUES (?, ?, ?)`)
    .run(projectId, nombre, fechaHace(20));
  await db.prepare(`INSERT INTO project_configs (id, project_id) VALUES (?, ?)`).run(`cfg-${projectId}`, projectId);

  const { units, clientes } = generarProyecto(projectId, nDeptos, nEstac, nBod, poblado);

  for (const c of clientes) {
    await db.prepare(`
      INSERT INTO clients (id, project_id, nombre, rut, email, telefono, ejecutivo_id, estado, fecha_registro)
      VALUES (?, ?, ?, ?, '', '', ?, ?, ?)
    `).run(c.id, projectId, c.nombre, c.rut, c.ejecutivoId, c.estado, c.fechaRegistro);
  }

  for (const u of units) {
    const planPagos = u.type === 'Departamento' ? planPagosPara(u.estado, u.precioVenta, u.fechaHito) : [];
    // Solo se llena la fecha de hito que corresponde al estado ACTUAL — es la única que
    // fechaHitoUnidad() de analytics.ts lee para ese estado; inventar las anteriores
    // (reserva/promesa previas a una escritura) no aporta nada a lo que se va a verificar.
    const fechaReserva = u.estado === 'Reservado' ? u.fechaHito : null;
    const fechaPromesa = u.estado === 'Promesado' ? u.fechaHito : null;
    const fechaEscritura = u.estado === 'Escriturado' ? u.fechaHito : null;
    await db.prepare(`
      INSERT INTO units (
        id, project_id, type, numero, estado, superficie, piso, dormitorios, banos,
        bodegas, estacionamientos, cliente_id, ejecutivo_id, precio_lista, precio_venta,
        banco, fecha_reserva, fecha_promesa, fecha_escritura, plan_pagos, observaciones
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      u.id, u.projectId, u.type, u.numero, u.estado, u.superficie, u.piso, u.dormitorios ?? null, u.banos ?? null,
      JSON.stringify(u.bodegas), JSON.stringify(u.estacionamientos), u.clienteId, u.ejecutivoId,
      u.precioVenta, u.precioVenta, u.banco,
      fechaReserva, fechaPromesa, fechaEscritura,
      JSON.stringify(planPagos), '',
    );
  }

  return { unidades: units.length, clientes: clientes.length };
}

async function main() {
  await limpiarDemoAnterior();
  const poblado = await sembrarProyecto('demo-sv155', 'Demo · Edificio Vista (poblado)', 60, 24, 18, true);
  const vacio = await sembrarProyecto('demo-sv999', 'Demo · Proyecto Nuevo (sin colocaciones)', 40, 15, 12, false);
  console.log(`demo-sv155: ${poblado.unidades} unidades, ${poblado.clientes} clientes`);
  console.log(`demo-sv999: ${vacio.unidades} unidades, ${vacio.clientes} clientes (todas Disponible, sin hitos)`);
  console.log('SEED_OK');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
