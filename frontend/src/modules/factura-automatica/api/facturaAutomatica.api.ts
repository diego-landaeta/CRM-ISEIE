import client from '@/shared/api/client';

/*
  Factura automática (#764) · lo que pide el CRM con sesión.

  «Enviar factura automáticamente: Sí / No» y «Enviar a este correo» (24/11),
  y la pantalla de Facturas › Facturación automática.
*/

/** Lo que se manda al crear o cambiar una venta (o un link de pago). `email` null = el de la ficha. */
export type EnvioFactura = { auto: boolean; email: string | null };

export type EnvioDeLaVenta = {
  auto: boolean;
  email: string | null;
  email_ficha: string | null;
  email_efectivo: string | null;
  confirmado: boolean;
  confirmado_at: string | null;
  confirmado_por: string | null;
  nota: string | null;
  activa?: boolean;
  formulario_reenviado?: boolean;
  peticion?: {
    estado: string; enviado_a: string | null; enviado_at: string | null; envio_error: string | null;
    caduca_at: string; respondido_at: string | null; origen_datos: string | null; motivo_revision: string | null;
  } | null;
};

export type Formulario = {
  id: number; conversion_id: number; lead_id: number | null; project_id: number; campus: string;
  alumno: string | null; gestora: string | null; estado: string; origen_datos: string | null;
  situacion: 'esperando' | 'contestado' | 'vencido' | 'revision' | string;
  enviado_a: string | null; enviado_at: string | null; envio_error: string | null; caduca_at: string;
  respondido_at: string | null; facturas: number; factura_envio_auto: boolean; envio_email: string | null;
  envio_nota: string | null; created_at: string;
};

export type FacturaSola = {
  id: number; codigo: string; fecha: string; total: number | string; cliente_nombre: string | null;
  cliente_nif: string | null; estado: string; sent_at: string | null; sent_to_email: string | null;
  envio_nota: string | null; conversion_id: number | null; lead_id: number | null; project_id: number;
  campus: string; origen_datos: string | null;
};

export type Atencion = {
  id: number; conversion_id: number; lead_id: number | null; project_id: number; campus: string;
  alumno: string | null; gestora: string | null; cobro_id: number | null; envio_email: string | null;
  estado: string; codigo: string; motivo: string; detalle: string | null; texto: string;
  donde: 'cola' | 'venta' | 'config' | null;
};

export type Panel = {
  activa: boolean; dias: number; enviar_pdf: boolean; limite: number;
  resumen: {
    formularios: number; enviados: number; contestados: number; vencidos: number; esperando: number;
    en_revision: number; posibles_duplicadas: number; atencion: number; facturas: number;
    pdf_enviados: number; las_envia_la_gestora: number;
  };
  formularios: Formulario[];
  facturas: FacturaSola[];
  atencion: Atencion[];
};

export const facturaAutomaticaApi = {
  interruptor: () => client.get<{ activa: boolean; dias: number }>('/factura-automatica/interruptor'),
  envio: (conversionId: number) => client.get<EnvioDeLaVenta>(`/factura-automatica/venta/${conversionId}/envio`),
  guardarEnvio: (conversionId: number, cuerpo: EnvioFactura) =>
    client.put<EnvioDeLaVenta>(`/factura-automatica/venta/${conversionId}/envio`, cuerpo),
  reenviar: (conversionId: number) => client.post<{ enviado: boolean }>(`/factura-automatica/venta/${conversionId}/reenviar`, {}),
  panel: (ambito: string) => client.get<Panel>(`/factura-automatica/panel${ambito}`),
};
