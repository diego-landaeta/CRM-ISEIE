import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL DÍA A DÍA, SEGUNDA TANDA (#619, tanda D; gemela de
 * CRM#941). Diego, 19/11: «las que son así, dáselas a Ángel CEDIA».
 * Las siguientes por uso después de la tanda C (`recorridosGestora.ts`):
 *
 *  · el Seguimiento de fin de mes, que una gestora repasa cuando la cola del día
 *    le deja hueco;
 *  · la Conexión de WhatsApp, donde cada una enlaza su número. El chat ya tiene
 *    su recorrido (`whatsapp/components/Tour.tsx`, «Tutorial») y Plantillas el
 *    suyo: no se repiten.
 *
 * Las Consultas (la bandeja y una consulta) ya tenían recorrido en main:
 * `consultas-chat` y `consulta-responder`, en `recorridosNovedades301.ts` (#740).
 * Lo que traía esta tanda y aquellos no (las pestañas, «Mis consultas / Todas», la
 * bandeja de la izquierda y la ficha del alumno) se sumó a esos dos,
 * para que no salgan dos «Ver recorrido» en la misma pantalla (Diego, 24/11).
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre los ven sin tocar nada más.
 * Ninguno se abre solo (#681).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (el aviso de antes de enlazar con el número ya enlazado) se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, anclajes y textos. Solo cambian las
 * rutas (aquí `/leads/...`, en MultiCRM `/prospectos/...`) y lo de `EN_ESTE_CRM`.
 */

/**
 * Lo único que cambia entre los dos CRM. En el repaso de ISEIE la fila abre WhatsApp
 * o el correo y apunta el contacto (la persona sale de la lista); en MultiCRM copia
 * el mensaje del paso y la persona sigue en la lista (copiar no es escribirle).
 */
const EN_ESTE_CRM = {
  seguimientoAcciones: 'WhatsApp o correo con esa persona sin abrir su panel; si el mensaje del paso sale entero, va ya escrito. Al pulsar queda apuntado el contacto y sale de la lista. Con el círculo tachado la descartas del repaso, con su motivo.',
};

export type IdRecorridoGestoraB =
  | 'seguimiento-fin-de-mes'
  | 'whatsapp-conexion';

type RecorridoGestoraB = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraB };

/** Por uso: Seguimiento de fin de mes y Conexión de WhatsApp. */
export const RECORRIDOS_GESTORA_B: Record<IdRecorridoGestoraB, RecorridoGestoraB> = {
  // ─── Hoy › Seguimiento de fin de mes ───────────────────────────────────────
  'seguimiento-fin-de-mes': {
    id: 'seguimiento-fin-de-mes',
    rutas: ['/leads/seguimiento'],
    titulo: 'Seguimiento de fin de mes',
    permiso: 'proceso.view',
    pantalla: ['modules/proceso/pages/SeguimientoPage.tsx'],
    pasos: [
      {
        titulo: 'El repaso de fin de mes',
        texto: 'Toda la base de quien entró, no compró y lleva tiempo sin noticias. No es la cola del día: se repasa cuando se puede. Los más olvidados, primero. Son {pasos} pasos.',
      },
      {
        donde: anclaje('seguimiento-antiguedad'),
        titulo: 'Por antigüedad',
        texto: 'Cuántos entraron este mes, hace 1 a 3 meses, de 3 a 6 o hace más de 6. Pulsa uno para ver solo ese tramo; otra vez, para quitarlo.',
      },
      {
        donde: anclaje('seguimiento-sin-contactar'),
        titulo: 'Sin contactar nunca',
        texto: 'Los que se perdieron sin que nadie les escribiera. Es lo primero que hay que tapar: púlsalo para ver solo a ellos.',
      },
      {
        donde: anclaje('seguimiento-filtros'),
        titulo: 'Buscar y filtrar',
        texto: 'Busca por nombre, correo o teléfono, o filtra por formación y por estado. Busca en toda la base, no solo en la página que ves.',
      },
      {
        donde: anclaje('seguimiento-lista'),
        titulo: 'La lista',
        texto: 'Cada fila dice cuándo entró, su último contacto y con qué escribirle; púlsala y se abre su panel. Marca varias con su casilla (o todas, arriba) y abajo sale la barra para darlas por contactadas o copiar sus teléfonos o correos.',
      },
      {
        donde: anclaje('seguimiento-acciones'),
        titulo: 'Sin abrir el panel',
        texto: EN_ESTE_CRM.seguimientoAcciones,
      },
      {
        donde: anclaje('seguimiento-wasapi'),
        titulo: 'Descargar para Wasapi',
        texto: 'La base del repaso, todas las páginas y con lo que tengas filtrado, en el fichero que carga Wasapi para mandarla en bloque.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── WhatsApp › Conexión ───────────────────────────────────────────────────
  'whatsapp-conexion': {
    id: 'whatsapp-conexion',
    rutas: ['/whatsapp/conexion'],
    titulo: 'Conectar tu WhatsApp',
    permiso: 'whatsapp.usar',
    pantalla: ['modules/whatsapp/pages/ConexionPage.tsx'],
    pasos: [
      {
        titulo: 'Tu número en el CRM',
        texto: 'Aquí enlazas tu WhatsApp para escribir a los prospectos desde el chat del CRM. Cada persona enlaza el suyo y nadie más del equipo ve tus conversaciones. Son {pasos} pasos.',
      },
      {
        donde: anclaje('wa-conexion-estado'),
        titulo: 'Cómo está',
        texto: 'Si tu número está enlazado y con qué nombre. La flecha de arriba lo comprueba ahora y «¿Cómo se hace?» abre la guía. Si llevas el equipo, arriba eliges de quién es el número.',
      },
      {
        donde: anclaje('wa-conexion-aviso'),
        titulo: 'Antes de enlazar, lee esto',
        texto: 'No es la vía oficial de WhatsApp y puede bloquear el número: mejor uno de empresa, nunca el personal. Sin marcar la casilla no sale el código.',
      },
      {
        donde: anclaje('wa-conexion-historial'),
        titulo: 'Qué te traes del móvil',
        texto: '«Empezar de cero» es lo recomendado: nada del pasado, solo lo que llegue desde ahora. El último mes o todo el historial se guardan en el CRM y ya no se quitan solos.',
      },
      {
        donde: anclaje('wa-conexion-boton'),
        titulo: 'Enlazar o desvincular',
        texto: '«Enlazar mi número» saca el código: en el móvil, WhatsApp › Dispositivos vinculados › Vincular un dispositivo. Se renueva solo. Ya enlazado, aquí sale «Desvincular mi número», que pregunta antes.',
      },
      {
        donde: anclaje('wa-conexion-traido'),
        titulo: 'Lo que ha entrado',
        texto: 'Cuántos chats y mensajes se han traído. Las conversaciones nuevas aparecen solas y se atan al prospecto que tenga ese teléfono. «Ir al chat» te lleva a escribir.',
      },
      {
        donde: anclaje('wa-conexion-llamadas'),
        titulo: 'Si te llaman',
        texto: 'Las llamadas se cogen en el móvil; el CRM las apunta y las perdidas salen en el chat. Si quieres, recházalas con un mensaje que escribes aquí.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
