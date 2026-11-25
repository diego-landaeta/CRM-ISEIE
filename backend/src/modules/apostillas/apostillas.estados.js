/*
  LOS ESTADOS DE UNA APOSTILLA (CRM#1130 / CRM-ISEIE#786).

  Los de la tarea, en el orden del trámite. Son los mismos que la CHECK de la
  migración 344 (en el 360, 333) y que la barra de pasos de la pantalla
  (`frontend/src/modules/apostillas/lib/apostillas.ts`): si se añade uno, en
  los tres sitios.

  «Pagada» NO es un estado: sale del cobro de la venta (o del cargo de Stripe)
  y va aparte. Diego, 25/11: «que se vea simple»: una barra de pasos y un aviso
  en la campana si lleva N días en el mismo paso.

  Entregada y Cancelada son finales: no avisan de atasco.
*/
export const ESTADOS = [
  { clave: 'pendiente_inicio', texto: 'Pendiente de iniciar' },
  { clave: 'pendiente_documentacion', texto: 'Pendiente de documentación' },
  { clave: 'en_tramite', texto: 'En trámite' },
  { clave: 'apostillada', texto: 'Apostillada' },
  { clave: 'enviada', texto: 'Enviada al estudiante' },
  { clave: 'entregada', texto: 'Entregada' },
  { clave: 'cancelada', texto: 'Cancelada o reembolsada' },
];

export const CLAVES_ESTADO = ESTADOS.map((e) => e.clave);
export const FINALES = ['entregada', 'cancelada'];
export const textoDelEstado = (clave) => ESTADOS.find((e) => e.clave === clave)?.texto || clave;

export const TIPOS_DOCUMENTO = [
  { clave: 'diploma', texto: 'Diploma o título' },
  { clave: 'apostilla', texto: 'Apostilla escaneada' },
  { clave: 'justificante_envio', texto: 'Justificante de envío' },
  { clave: 'otro', texto: 'Otro' },
];
export const CLAVES_DOCUMENTO = TIPOS_DOCUMENTO.map((t) => t.clave);

/** Sin fila en `apostillas_ajustes`, a los 7 días (Diego, 25/11). */
export const DIAS_AVISO_DE_SERIE = 7;

/**
 * Dónde se abre una apostilla desde la campana. En este CRM, Clientes ›
 * Apostillas cuelga de /clients (en el 360, de /clientes).
 */
export const rutaDeLaApostilla = (id) => `/clients/apostillas?id=${id}`;
