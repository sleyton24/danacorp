export interface PaymentItem {
  id: string;
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
  fechaAsignacion?: string;
  
  precioLista: number;
  precioVenta: number;
  pie: number;
  
  pieFormaPago?: 'Contado' | 'Cuotas';
  pieCuotas?: number;

  bonoDescuento: number;
  reservaMonto: number;
  
  reservaFormaPago?: 'Contado' | 'Cuotas';
  reservaCuotas?: number;

  creditoHipotecario: number;
  tasaFinanciamiento?: number;
  
  totalPagado: number;
  saldoPorPagar: number;
  
  canalVenta?: 'Sala de Ventas' | 'Corredor' | 'Web' | 'Referido' | 'Otro';
  intermediario?: string;
  
  banco?: string;
  notaria?: string;
  repertorio?: string;
  
  fechaReserva?: string;
  fechaPromesa?: string; 
  fechaSolicitudCredito?: string;
  fechaAprobacionCredito?: string;
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
  
  planPagos: PaymentItem[];
  observaciones: string;
  documents?: ClientDocument[];

  // Descuento directo desde UnitDetail
  descuentoPct?: number;
  descuentoPendiente?: boolean;
  descuentoSolicitudId?: string;

  aplicaBonoPie?: boolean;
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

export interface TransactionData {
  meta: { obra: string; fechaActual: string; folio: string; };
  comprador: { nombre: string; rut: string; ciudad: string; comuna: string; telefono: string; email: string; };
  propiedad: { depto: string; bodega: string; estacionamiento: string; caracteristica: string; };
  financiero: { precioVenta: string; precioLista: string; pie: string; reserva: string; totalEscritura: string; totalPagado: string; saldoPorPagar: string; bonoDescuento: string; };
  fechas: { fechaEntrega: string; fechaEscritura: string; notaria: string; banco: string; tipoOperacion: string; };
  pagos: PaymentItem[];
  observaciones: string;
}
