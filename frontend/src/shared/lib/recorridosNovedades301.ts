import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS NUEVOS DE LA 3.0.0 (Diego, 24/11: «actualiza Novedades para ver
 * y que los recorridos estén actualizados»): los de lo que trajeron la 2.9.8 y la
 * 3.0.0 y aún no tenía recorrido.
 *
 *  1. Consultas y el chat del campus (3.0.0).
 *  2. Conciliación › Facturas y cobros (2.9.8, CRM#905).
 *
 * Como los demás, se suman a `RECORRIDOS_COBROS`: el botón «Recorrido» de la
 * cabecera, «Ver recorrido» de cada pantalla y de Novedades, y las pruebas de
 * siempre los ven. Solo importa TIPOS de `recorridosCobros` (sin ciclo).
 */
export type IdRecorridoNovedades301 = 'consultas-chat' | 'conciliacion-facturas';

type RecorridoNovedades301 = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoNovedades301 };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;

export const RECORRIDOS_NOVEDADES_301: Record<IdRecorridoNovedades301, RecorridoNovedades301> = {
  // ─── Consultas: el chat del campus (3.0.0) ─────────────────────────────────
  'consultas-chat': {
    id: 'consultas-chat',
    rutas: ['/consultas'],
    titulo: 'Consultas y el chat del campus',
    permiso: ['consultas.view', 'consultas.atender'],
    pantalla: ['modules/consultas/pages/ConsultasPage.tsx'],
    pasos: [
      {
        titulo: 'Las dudas de los alumnos',
        texto: 'Lo que el alumno escribe en el chat de Moodle llega aquí. Se contesta desde el CRM y la respuesta le sale en Moodle, a nombre de su tutora. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-estado'),
        titulo: 'Pendientes primero',
        texto: '«Pendientes» son las que esperan respuesta. El color dice cuánto llevan esperando: verde, a tiempo; ámbar, cerca del plazo; rojo, pasado el plazo.',
      },
      {
        donde: anclaje('consultas-buscar'),
        titulo: 'Buscar',
        texto: 'Por el nombre del alumno, su correo o el curso.',
      },
      {
        donde: anclaje('consultas-lista'),
        titulo: 'Abrir y contestar',
        texto: 'Pulsa una consulta para ver la conversación entera y escribir la respuesta. Si pone «respuesta sin llegar al campus», ábrela: desde la consulta se vuelve a enviar.',
      },
      {
        donde: anclaje('consultas-leer'),
        permiso: 'consultas.gestionar',
        titulo: 'Leer el campus ahora',
        texto: 'El CRM lee el campus solo cada 5 minutos. Si esperas una duda que acaba de escribir un alumno, pulsa aquí.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
  // ─── Finanzas › Conciliación › Facturas y cobros (2.9.8, #905) ─────────────
  'conciliacion-facturas': {
    id: 'conciliacion-facturas',
    rutas: ['/accounting/conciliacion/facturas'],
    titulo: 'Conciliación: facturas y cobros',
    permiso: 'facturas.gestionar',
    pantalla: ['modules/accounting/pages/ConciliacionFacturasPage.tsx'],
    pasos: [
      {
        titulo: 'Cada factura con su cobro',
        texto: 'Aquí salen las facturas emitidas que no tienen su cobro apuntado y los cobros que no tienen factura, para enlazarlos. Enlazar no cambia el número, el importe ni los datos del cliente. Son {pasos} pasos.',
      },
      {
        donde: anclaje('conciliacion-filtros'),
        titulo: 'Campus y mes',
        texto: 'Elige el campus y el mes que quieres cuadrar. Arriba ves cuántas hay de cada tipo.',
      },
      {
        donde: anclaje('conciliacion-sin-cobro'),
        titulo: 'Facturas sin cobro',
        texto: 'Cada factura propone los cobros que le pueden corresponder: mismo campus, mismo importe, a 7 días o menos y del mismo cliente (venta, correo, nombre o NIF). «Enlazar» la une con el que es.',
      },
      {
        donde: anclaje('conciliacion-sin-factura'),
        titulo: 'Cobros sin factura',
        texto: 'Los cobros que no tienen factura, con la factura que les puede corresponder. Si no tienen ninguna, «Emitir factura» te lleva a la cola de facturación de su campus.',
      },
      {
        donde: anclaje('conciliacion-todas'),
        titulo: 'Enlazar todas las seguras',
        texto: 'Las parejas «seguras» (la factura solo casa con ese cobro y el cobro solo con esa factura) se enlazan de una vez. Antes te pide confirmar.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
};
