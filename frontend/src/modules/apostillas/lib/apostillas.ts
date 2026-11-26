/*
  Apostilla de La Haya (CRM#1130 / CRM-ISEIE#786): los pasos y cómo se leen.

  Los mismos estados que el servidor (`apostillas.estados.js`) y que la CHECK
  de la migración 344 (en el 360, 333). «Pagada» no es un paso: sale del cobro.
  Diego, 25/11: «que se vea simple»: una barra de pasos y, si lleva los días del
  aviso en el mismo paso, el aviso en la campana.
*/

export type EstadoApostilla =
  | 'pendiente_inicio' | 'pendiente_documentacion' | 'en_tramite'
  | 'apostillada' | 'enviada' | 'entregada' | 'cancelada';

export const PASOS: ReadonlyArray<{ clave: EstadoApostilla; texto: string; corto: string }> = [
  { clave: 'pendiente_inicio', texto: 'Pendiente de iniciar', corto: 'Por iniciar' },
  { clave: 'pendiente_documentacion', texto: 'Pendiente de documentación', corto: 'Documentación' },
  { clave: 'en_tramite', texto: 'En trámite', corto: 'En trámite' },
  { clave: 'apostillada', texto: 'Apostillada', corto: 'Apostillada' },
  { clave: 'enviada', texto: 'Enviada al estudiante', corto: 'Enviada' },
  { clave: 'entregada', texto: 'Entregada', corto: 'Entregada' },
];

export const CANCELADA = { clave: 'cancelada' as const, texto: 'Cancelada o reembolsada', corto: 'Cancelada' };

export const ESTADOS = [...PASOS, CANCELADA];

export const textoDelEstado = (e: string | null | undefined) => ESTADOS.find((x) => x.clave === e)?.texto || e || '';

/** El número de paso (1…6), o 0 si está cancelada. */
export function numeroDePaso(e: EstadoApostilla): number {
  const i = PASOS.findIndex((p) => p.clave === e);
  return i < 0 ? 0 : i + 1;
}

export const FINALES: ReadonlyArray<EstadoApostilla> = ['entregada', 'cancelada'];

/** ¿Lleva los días del aviso (o más) en el mismo paso? Los finales no se atascan. */
export function estaAtascada(a: { estado: EstadoApostilla; dias_en_estado: number; dias_aviso: number }): boolean {
  return !FINALES.includes(a.estado) && a.dias_en_estado >= a.dias_aviso;
}

/** «hoy», «1 día», «8 días». */
export function diasTexto(n: number): string {
  if (!n || n < 1) return 'hoy';
  return n === 1 ? '1 día' : `${n} días`;
}

/** El mismo texto que el aviso de la campana (apostillas.avisos.js · tituloAtascada). */
export function fraseAtascada(a: { cliente: string | null; estado: EstadoApostilla; dias_en_estado: number }): string {
  return `La apostilla ${a.cliente ? `de ${a.cliente}` : 'sin asociar'} lleva ${a.dias_en_estado} días en «${textoDelEstado(a.estado)}»`;
}

export const TIPOS_DOCUMENTO = [
  { clave: 'diploma', texto: 'Diploma o título' },
  { clave: 'apostilla', texto: 'Apostilla escaneada' },
  { clave: 'justificante_envio', texto: 'Justificante de envío' },
  { clave: 'otro', texto: 'Otro' },
] as const;
export type TipoDocumento = typeof TIPOS_DOCUMENTO[number]['clave'];
export const textoDelDocumento = (t: string) => TIPOS_DOCUMENTO.find((x) => x.clave === t)?.texto || t;

const ORIGEN: Record<string, string> = { venta: 'De una venta', stripe: 'De un link de Stripe', manual: 'Creada a mano' };
export const textoDelOrigen = (o: string) => ORIGEN[o] || o;

export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(n || 0));

/** «2026-11» → «nov. 2026». */
export function mesTexto(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  if (!a || !m) return mes;
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Dónde vive el apartado. En este CRM, junto a Clientes (/clients/…); en el
 * 360, /clientes/apostillas. Lo usan el menú, los bloques y la campana.
 */
export const RUTA_APOSTILLAS = '/clients/apostillas';
export const rutaDeLaApostilla = (id: number) => `${RUTA_APOSTILLAS}?id=${id}`;

/** La ficha del cliente y la de la venta (en el 360: /clientes/:id y /finanzas/ventas/:id). */
export const rutaDelCliente = (leadId: number) => `/clients/${leadId}`;
export const rutaDeLaVenta = (conversionId: number) => `/ventas/${conversionId}`;
