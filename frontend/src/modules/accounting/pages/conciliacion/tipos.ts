// Lo que devuelve GET /api/stripe-payments/conciliacion (CRM#906).

/** Por qué casa: la venta que el cargo ya tenía, el mismo correo o el mismo nombre. */
export type Por = 'venta' | 'correo' | 'nombre';

export interface CobroCandidato {
  id: number;
  conversion_id: number;
  importe: number;
  fecha: string;
  metodo: string | null;
  lead_id: number;
  alumno: string | null;
  email: string | null;
  programa: string | null;
  factura_id: number | null;
  factura_codigo: string | null;
  por: Por;
  /** Cuántos cargos más piden este mismo cobro. */
  otrosCargos: number;
}

export interface VentaDelAlumno {
  id: number;
  lead_id: number;
  alumno: string | null;
  email: string | null;
  programa: string | null;
  fecha: string | null;
  total: number;
  cobrado: number;
  pendiente: number;
  por: Por;
}

export interface CargoSinEnlazar {
  id: number;
  project_id: number;
  proyecto: string;
  stripe_id: string;
  importe: number;
  fecha: string;
  customer_email: string | null;
  customer_name: string | null;
  description: string | null;
  lead_id: number | null;
  conversion_id: number | null;
  moneda: string;
  cobros: CobroCandidato[];
  ventas: VentaDelAlumno[];
  ficha: { id: number; nombre: string; responsable_id: number | null } | null;
  seguro: boolean;
  sugerencia: 'enlazar' | 'apuntar' | 'crear';
}

export interface Conciliacion {
  cargos: CargoSinEnlazar[];
  meses: { mes: string; cargos: number; importe: number }[];
  resumen: {
    cargos: number; importe: number; seguros: number; importeSeguros: number;
    conCobro: number; conVenta: number; sinVenta: number;
  };
}
