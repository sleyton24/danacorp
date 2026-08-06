export interface PaymentItem {
  uid: string;          // identidad estable de la fila (Bloque C). NO es el label editable.
  id: string;           // label editable por el usuario ("Cuota 1", "Promesa"…), decorativo.
  date: string;
  amount: string;
  status: 'Pagado' | 'Pendiente' | 'Atrasado';
  fechaPagoReal?: string;
  observacion?: string;
}

export interface ClientHistory {
  fecha: string;
  tipo: 'Creación' | 'Cambio Estado' | 'Pago' | 'Nota' | 'Desistimiento' | 'Cotización';
  descripcion: string;
  etapa?: string;
  usuario?: string;
}

export interface ClientDocument {
  id: string;
  name: string;
  type: string; 
  category: 'General' | 'Cotización' | 'Legal' | 'Bancario' | 'Entrega';
  url: string; 
  date: string;
  size: string;
}

export interface Client {
  id: string;
  projectId: string;
  tipoPersona: 'Natural' | 'Juridica';
  nombre: string;
  rut: string;
  nacionalidad?: string;
  profesion?: string;
  sueldoRange?: string; // Nuevo campo opcional
  fechaNacimiento?: string;
  email: string;
  telefono: string;
  direccion?: string;
  ciudad?: string;
  comuna?: string;
  region?: string;
  ejecutivoId?: string;
  estado: 'Activo' | 'Prospecto' | 'Cerrado' | 'Desistido';
  fechaRegistro: string;
  historial: ClientHistory[];
  documents: ClientDocument[];
  representanteNombre?: string;
  representanteRut?: string;
  representanteNacionalidad?: string;
  representanteEmail?: string;
  representanteTelefono?: string;
  representanteDireccion?: string;
}

export interface Project {
  id: string;
  nombre: string;
  fechaCreacion: string;
  /**
   * TERMINADO: el proyecto sigue consultable y sus reportes descargables, pero ningún
   * endpoint de escritura lo acepta. La columna de BD conserva el nombre 'archivado';
   * en pantalla el concepto se llama "Terminado".
   */
  archivado?: boolean;
  /** Sello del cierre vigente. Se limpian al reabrir. */
  archivadoAt?: string;
  archivadoPor?: string;
  /** Conteos que devuelve GET /api/projects; se usan al confirmar una eliminación. */
  unidadesCount?: number;
  clientesCount?: number;
  discountConfig?: DiscountConfig;
}

export interface User {
  id: string;
  name: string;
  email: string;
  company?: string;
  role: 'Admin' | 'Supervisor' | 'Ventas' | 'Lectura' | 'JefeSala';
  avatar?: string;
  assignedProjectIds?: string[];
  passwordTemporal?: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  section: string;
  action: string;
  target?: string;
  details: string;
}

export interface Notification {
  id: string;
  date: string;
  title: string;
  message: string;
  type: 'alert' | 'info' | 'warning';
  read: boolean;
  targetUserRole: 'Admin' | 'Supervisor' | 'Ventas' | 'All';
  linkToView?: string;
  relatedId?: string;
  emailSentTo: string[];
}

export interface RealEstateUnit {
  id: string;
  projectId: string;
  numero: string;
  type: 'Departamento' | 'Bodega' | 'Estacionamiento';
  estado: 'Disponible' | 'Reservado' | 'Promesado' | 'Escriturado' | 'Libre Asignación' | 'Asignado';
  
  superficie?: number;
  terraza?: number;
  orientacion?: string;
  piso?: number;
  dormitorios?: number;
  banos?: number;
  
  gastoComun?: number;
  gastosOperacionales?: number;
  gastosNotariales?: number;
  gastosConservador?: number;

  bodegas: string[];
  estacionamientos: string[];
  
  clienteId?: string;
  asignadoPor?: string;
  ejecutivoId?: string;
  fechaAsignacion?: string;
  
  precioLista: number;
  precioVenta: number;
  pie: number;
  
  pieFormaPago?: 'Contado' | 'Cuotas';
  pieCuotas?: number;

  /**
   * Día del mes (1..31) en que vencen las cuotas que genera el cronograma. Los meses más
   * cortos toman su último día y los fines de semana se adelantan al viernes; ver
   * fechaCuota() en utils/cronogramaUtils.ts. Opcional: las unidades anteriores al campo
   * caen en DIA_PAGO_DEFAULT.
   */
  diaPago?: number;

  bonoDescuento: number;
  reservaMonto: number;
  
  reservaFormaPago?: 'Contado' | 'Cuotas';
  reservaCuotas?: number;

  creditoHipotecario: number;
  tasaFinanciamiento?: number | null;
  
  totalPagado: number;
  saldoPorPagar: number;
  
  canalVenta?: 'Sala de Ventas' | 'Corredor' | 'Web' | 'Referido' | 'Otro';
  intermediario?: string;
  
  /**
   * Hitos: Contado no admite bloque de crédito. Nullable a propósito — las unidades
   * anteriores a este campo quedan "no declaradas" y siguen mostrando el crédito que ya
   * tengan cargado, en vez de que se les invente una declaración. Ver aplicaCredito()
   * en utils/hitosCredito.ts.
   */
  formaFinanciamiento?: 'Contado' | 'Financiamiento' | null;
  /** Banco financista. La columna ya existía (la consumen Resumen y Descargas); desde
   *  ahora también se edita en Hitos. */
  banco?: string | null;
  /** Plazo del crédito en años. Solo aplica con Financiamiento. */
  plazoCreditoAnios?: number | null;
  notaria?: string;
  repertorio?: string;

  fechaReserva?: string;
  fechaPromesa?: string;
  // Las dos del bloque de crédito aceptan null: un guardado con Contado las vacía
  // explícitamente (null viaja en el JSON, undefined no). Ver limpiarCamposCredito().
  fechaSolicitudCredito?: string | null;
  fechaAprobacionCredito?: string | null;
  fechaEscritura?: string;
  fechaTerminoPago?: string;
  fechaAlzamiento?: string; 
  fechaEntrega?: string;
  fechaPago?: string;

  facturaNumero?: string;
  facturaFecha?: string;
  recepcionMunicipalNumero?: string;
  recepcionMunicipalFecha?: string;
  cbrFojas?: string;
  cbrNumero?: string;
  cbrAno?: string;
  /**
   * Hitos, posterior a la firma de Escritura. Ambas OPCIONALES: nunca son requisito para
   * que el proceso de la unidad se considere completo. Si se completan, se valida el orden
   * (escritura ≤ ingreso ≤ inscripción) en validarOrdenCBR().
   */
  fechaIngresoCBR?: string;
  fechaInscripcionCBR?: string;
  
  planPagos: PaymentItem[];
  observaciones: string;
  documents?: ClientDocument[];

  // Descuento directo desde UnitDetail
  descuentoPct?: number;
  descuentoCliente?: number;
  descuentoPendiente?: boolean;
  descuentoSolicitudId?: string;

  aplicaBonoPie?: boolean;

  reservaVendedorId?: string;
  reservaExpira?: string;
  historialOcupacion?: OcupacionEntry[];
  precioListaOriginal?: number;
}

export interface OcupacionEntry {
  tipo: 'Reserva' | 'Promesa' | 'Escritura';
  clienteId: string;
  clienteNombre: string;
  clienteRut?: string;
  vendedorId: string;
  vendedorNombre: string;
  fechaInicio: string;
  fechaFin?: string;
  motivo?: string;
}

export interface DiscountConfig {
  jefeMaxPct: number;            // banda 1: aprueba solo JefeSala
  supervisorMaxPct: number;      // banda 2: aprueba JefeSala + Supervisor; encima no permitido para Ventas
  bonoPiePct: number;            // % bono pie, editable solo por Admin
  vigenciaCotizacionDias: number; // días de validez del PDF
}

export interface ProjectConfig {
  projectId: string;
  bonoPiePct: number;
  discountConfig: DiscountConfig;
  // Configuración del proyecto para PDF
  reservaCLP?: number;
  direccionProyecto?: string;
  comunaProyecto?: string;
  ciudadProyecto?: string;
  nombreInmobiliaria?: string;
  cantidadCuotasPie?: number;
  duracionReservaDias?: number;
  maxCuotas?: number;
  horasSolicitudAprobacionReserva?: number; // plazo (h) para aprobar la solicitud de reserva; default 72
}

export interface DiscountRequestRecord {
  id: string;
  projectId: string;
  unitId: string;
  unitNumero: string;
  vendedorId: string;
  vendedorNombre: string;
  cotizacionId?: string;
  precioOriginal: number;
  precioSolicitado: number;
  descuentoPct: number;
  descuentoMonto: number;
  estado: 'Pendiente' | 'AprobadoJefe' | 'Aprobado' | 'Rechazado' | 'Cancelado';
  aprobadoJefeId?: string;
  aprobadoJefeAt?: string;
  aprobadoSupervisorId?: string;
  aprobadoSupervisorAt?: string;
  rechazadoPorId?: string;
  rechazadoPorAt?: string;
  rechazoMotivo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendNotification {
  id: string;
  paraUserId?: string;
  paraRol?: string;
  titulo: string;
  mensaje: string;
  tipo: 'info' | 'success' | 'warning' | 'error';
  leida: boolean;
  linkView?: string;
  relatedId?: string;
  createdAt: string;
}


export interface PaymentPlan {
  id: string;
  quotationId: string;
  unitNumero: string;
  projectId: string;
  clienteId?: string;
  clienteRut?: string;
  clienteNombre?: string;
  precioVentaFinal: number;
  promesaPct: number;
  cuotasPct: number;
  cuotasN: number;
  escrituraPct: number;
  creditoPct: number;
  bonoPiePct: number;
  aplicaBonoPie: boolean;
  descuentoPct: number;
  createdAt: string;
}

export interface PriceHistoryEntry {
  id: string;
  unitId: string;
  projectId: string;
  precioAnterior: number;
  precioNuevo: number;
  variacionPct: number;
  motivo?: string;
  usuarioId: string;
  usuarioNombre: string;
  createdAt: string;
}

export interface TransactionData {
  meta: { obra: string; fechaActual: string; folio: string; };
  comprador: { nombre: string; rut: string; ciudad: string; comuna: string; telefono: string; email: string; };
  propiedad: { depto: string; bodega: string; estacionamiento: string; caracteristica: string; };
  financiero: { precioVenta: string; precioLista: string; pie: string; reserva: string; totalEscritura: string; totalPagado: string; saldoPorPagar: string; bonoDescuento: string; };
  fechas: { fechaEntrega: string; fechaEscritura: string; notaria: string; banco: string; tipoOperacion: string; };
  pagos: PaymentItem[];
  observaciones: string;
}
