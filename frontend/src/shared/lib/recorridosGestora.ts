import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL DÍA A DÍA DE UNA GESTORA (#619, tanda C; gemela de
 * CRM#941). Diego, 19/11: «las que son así, dáselas a Ángel CEDIA».
 * Las tres pantallas que más abre una gestora después de Prospectos (que ya
 * tiene el suyo, #611): Clientes, la ficha del prospecto y La cola del día.
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido` y las pruebas de siempre (la
 * de los anclajes y la de 375 px) los ven sin tocar nada más. Van en su propio
 * fichero para no pisarse con las otras tandas.
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (la ficha de alguien sin proceso comercial, la cola vacía, un
 *    selector de equipo que una gestora no tiene) se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú; el de un
 *    paso, el del botón que explica.
 *  · Lo que se ve distinto en el PC y en el móvil (la tabla y las tarjetas) se
 *    señala por la caja que lo contiene, no por una de las dos.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, anclajes y textos. Solo cambia lo
 * de `EN_ESTE_CRM`, justo debajo, y Clientes, que aquí es la lista con su
 * buscador: en MultiCRM tiene además cifras, cobros y «Registrar venta», con sus
 * tres pasos.
 */

/**
 * Lo único que cambia entre los dos CRM. Aquí no se elige empresa arriba (la cola
 * no tiene filtro de campus), «Fusionar» está en la columna de la derecha y no en
 * la cabecera, y el buscador de Clientes filtra por cuotas.
 */
const EN_ESTE_CRM = {
  fichaCabecera: 'El nombre, el estado y de qué campus viene. A la derecha, lo que se hace con la ficha entera: link de pago, proforma y, si llevas el equipo, reasignar o compartir.',
  colaEquipo: 'Si llevas el equipo, mira la cola de una gestora o la de todas juntas.',
  clientesFiltros: 'En «Filtros» buscas por nombre, correo o teléfono y filtras por gestora, programa o cuotas, y eliges el orden. «CSV» descarga los que ves.',
};

export type IdRecorridoGestora =
  | 'clientes'
  | 'prospecto-ficha'
  | 'cola-del-dia';

type RecorridoGestora = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestora };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;


/** Por uso: Clientes, la ficha del prospecto y La cola del día. */
export const RECORRIDOS_GESTORA: Record<IdRecorridoGestora, RecorridoGestora> = {
  // ─── Clientes › Listado ────────────────────────────────────────────────────
  clientes: {
    id: 'clientes',
    rutas: ['/clients'],
    titulo: 'Clientes',
    permiso: 'clients.view',
    pantalla: ['modules/clients/pages/ClientsPage.tsx', 'modules/reports/components/ComoVoy.tsx'],
    pasos: [
      {
        titulo: 'Quién ya compró',
        texto: 'Los prospectos con al menos una venta: qué han comprado y cómo van sus cuotas. Una gestora ve solo los suyos. Son {pasos} pasos.',
      },
      {
        donde: anclaje('como-voy'),
        titulo: 'Cómo vas este mes',
        texto: 'Tus ventas y tu tasa de cierre del mes, frente a la del equipo. Si llevas equipo, lo de todo el equipo.',
      },
      {
        donde: anclaje('clientes-filtros'),
        titulo: 'Buscar y filtrar',
        texto: EN_ESTE_CRM.clientesFiltros,
      },
      {
        donde: anclaje('clientes-lista'),
        titulo: 'La lista',
        texto: 'Cada cliente con su programa, su gestora, sus cuotas y el próximo vencimiento. Pulsa uno para abrir su ficha. A la derecha: WhatsApp y correo.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Prospectos › Ficha ────────────────────────────────────────────────────
  'prospecto-ficha': {
    id: 'prospecto-ficha',
    rutas: ['/leads/:id'],
    titulo: 'La ficha del prospecto',
    permiso: 'leads.view',
    pantalla: [
      'modules/leads/components/lead-detail/LeadHeaderCard.tsx',
      'modules/leads/components/lead-detail/LeadInfoCard.tsx',
      'modules/proceso/components/AgendaDelProspecto.tsx',
      'modules/leads/components/lead-detail/LeadInteractionsCard.tsx',
      'modules/leads/pages/LeadDetailPage.tsx',
      'modules/leads/components/lead-detail/LeadSidebar.tsx',
    ],
    pasos: [
      {
        titulo: 'La ficha de una persona',
        texto: 'Todo lo de este prospecto en un sitio: sus datos, en qué paso va, lo que se ha hablado con él y sus compras. Son {pasos} pasos.',
      },
      {
        donde: anclaje('ficha-cabecera'),
        titulo: 'La cabecera',
        texto: EN_ESTE_CRM.fichaCabecera,
      },
      {
        donde: anclaje('ficha-datos'),
        titulo: 'Sus datos',
        texto: 'Contacto, programa de interés y lo demás. «Llamar» y WhatsApp abren la conversación y la dejan apuntada en su historial.',
      },
      {
        donde: anclaje('ficha-proceso'),
        titulo: 'El proceso comercial',
        texto: 'Los pasos que le tocan y cuándo, con el siguiente marcado. Copia el mensaje de WhatsApp o abre el correo del paso con su plantilla ya puesta.',
      },
      {
        donde: anclaje('ficha-interacciones'),
        titulo: 'Interacciones',
        texto: 'Las llamadas, los WhatsApp y las notas, de la más nueva a la más antigua. «+ Nueva interacción» apunta otra.',
      },
      {
        donde: anclaje('ficha-ventas'),
        titulo: 'Historial de compras',
        texto: 'Sus ventas, con lo cobrado y lo que falta de cada una. Si lo llevas tú, desde aquí se registran y se editan. Justo encima, sus links de pago.',
      },
      {
        donde: anclaje('ficha-estado'),
        titulo: 'Cambiar estado',
        texto: 'Elige el estado nuevo y pulsa «Actualizar»; «No interesado» te pide el motivo. Debajo, apuntar una interacción o un recordatorio sin bajar a buscarlo.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Hoy › La cola del día ─────────────────────────────────────────────────
  'cola-del-dia': {
    id: 'cola-del-dia',
    rutas: ['/leads/cola'],
    titulo: 'La cola del día',
    permiso: 'proceso.view',
    pantalla: ['modules/proceso/pages/ColaDelDiaPage.tsx'],
    pasos: [
      {
        titulo: 'A quién le toca hoy',
        texto: 'A quién le toca un contacto hoy y quién viene arrastrado. Una fila por persona, con su paso más urgente. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cola-equipo'),
        titulo: 'De quién es la cola',
        texto: EN_ESTE_CRM.colaEquipo,
      },
      {
        donde: anclaje('cola-salud'),
        titulo: 'Cómo va el día',
        texto: 'La frase dice si el día está bajo control, y la barra, el reparto: rojo lo atrasado, ámbar lo de hoy, azul lo de mañana.',
      },
      {
        donde: anclaje('cola-tramos'),
        titulo: 'Los tramos',
        texto: 'Atrasados, para hoy, para mañana y esta semana. Pulsa uno para ver solo ese; otra vez, para volver a lo que ya toca.',
      },
      {
        donde: anclaje('cola-filtros'),
        titulo: 'Buscar y filtrar',
        texto: 'Por nombre, correo o teléfono, por formación, por estado o por las fechas del paso. Busca en toda la cola, no solo en la página que ves.',
      },
      {
        donde: anclaje('cola-por-paso'),
        titulo: 'Por paso',
        texto: 'Cuántos hay de cada paso y cuántos llegan tarde. Pulsa uno para hacer seguidos los del mismo paso, que llevan el mismo mensaje.',
      },
      {
        donde: anclaje('cola-lista'),
        titulo: 'La lista',
        texto: 'Lo que más espera, arriba. Pulsa una fila y se abre su panel con el mensaje listo para copiar. El paso se cierra solo al apuntar un contacto.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
