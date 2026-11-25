import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DE CAPTACIÓN Y PUBLICIDAD (#619, tanda H; gemela de
 * CRM#941). Diego, 19/11: «las que son así, dáselas a Ángel CEDIA». El
 * bloque 4 de la issue, en el orden del menú:
 *
 *  · Email: las secuencias de correo que salen solas.
 *  · Formularios: los formularios propios del CRM para una landing.
 *  · Widget web: el botón de WhatsApp de la web, sus pulsaciones y sus gestoras.
 *  · Meta Ads: el gasto en anuncios, campaña a campaña, frente a lo que entra.
 *
 * Google Analytics, el quinto del 360, aquí no existe (ni pantalla ni entrada
 * en el menú): no tiene recorrido.
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre (la de los anclajes y la
 * de 375 px) los ven sin tocar nada más. Ninguno se abre solo (#1012).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (no hay secuencias, «Todos» arriba en el widget, un campus fijo,
 *    los botones de administrar a quien solo consulta) se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú; el de un
 *    paso, el del botón que explica.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, anclajes y textos. Solo cambian
 * las rutas (aquí Formularios es `/forms`; en el 360, `/captacion`), lo de
 * `EN_ESTE_CRM`, justo debajo, y que aquí no hay Google Analytics.
 */

/**
 * Lo único que cambia en los textos entre los dos CRM: qué se puede poner
 * arriba en vez de un campus. Aquí, solo «Todos»; en el 360, también una
 * empresa.
 */
const EN_ESTE_CRM = {
  arriba: 'Con «Todos» arriba',
};

export type IdRecorridoGestoraF =
  | 'secuencias-email'
  | 'formularios'
  | 'widget-web'
  | 'meta-ads';

type RecorridoGestoraF = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraF };

/** Por el menú: Captación y publicidad. */
export const RECORRIDOS_GESTORA_F: Record<IdRecorridoGestoraF, RecorridoGestoraF> = {
  // ─── Captación y publicidad › Email ───────────────────────────────────────
  'secuencias-email': {
    id: 'secuencias-email',
    rutas: ['/secuencias-email'],
    titulo: 'Secuencias de email',
    permiso: 'email_sequences.view',
    pantalla: ['modules/email-sequences/pages/EmailSequencesPage.tsx'],
    pasos: [
      {
        titulo: 'Correos que salen solos',
        texto: 'Una secuencia es una serie de correos que le llegan solos a un prospecto, uno detrás de otro, con las horas que marques entre ellos. Son las de este campus. Son {pasos} pasos.',
      },
      {
        donde: anclaje('email-nueva'),
        permiso: 'email_sequences.create',
        titulo: 'Nueva secuencia',
        texto: 'Ponle nombre y elige cuándo empieza: al crearse el prospecto, al cambiar de estado, al convertirse o a mano. Luego, sus pasos: las horas de espera y el asunto y el cuerpo, o una plantilla.',
      },
      {
        donde: anclaje('email-lista'),
        titulo: 'Las secuencias',
        texto: 'Cada una con cuándo empieza, cuántos pasos tiene, cuántas personas van ahora por ella y cuántas la terminaron. «PAUSADA», si está parada.',
      },
      {
        donde: anclaje('email-acciones'),
        titulo: 'Pausar, editar o borrar',
        texto: 'La pausa la para sin perder nada y el mismo botón la reanuda. «Editar» abre sus pasos. La papelera la borra entera, con sus pasos; antes te lo pregunta.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Captación y publicidad › Formularios ─────────────────────────────────
  formularios: {
    id: 'formularios',
    rutas: ['/forms'],
    titulo: 'Formularios',
    permiso: 'forms.view',
    pantalla: ['modules/forms/pages/FormsPage.tsx'],
    pasos: [
      {
        titulo: 'Formularios para la web',
        texto: 'Formularios del propio CRM para poner en una landing: lo que alguien envía entra como prospecto de este campus. Son {pasos} pasos.',
      },
      {
        donde: anclaje('forms-nuevo'),
        permiso: 'forms.create',
        titulo: 'Nuevo formulario',
        texto: 'Elige la plantilla (contacto básico, con producto de interés o con tus campos), el texto y el color del botón, el mensaje de gracias y, si quieres, a qué página lleva después de enviarlo.',
      },
      {
        donde: anclaje('forms-lista'),
        titulo: 'Los formularios',
        texto: 'Cada uno con su plantilla, cuántos envíos ha recibido y su código. Los apagados salen en gris, con «INACTIVO».',
      },
      {
        donde: anclaje('forms-acciones'),
        titulo: 'Encender, pegar en la web, editar',
        texto: '«ON/OFF» lo enciende o lo apaga sin borrarlo: apagado, deja de recibir. «Embed» te da el código para pegarlo en la web. «Editar» lo cambia y la papelera lo borra.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Captación y publicidad › Widget web ──────────────────────────────────
  'widget-web': {
    id: 'widget-web',
    rutas: ['/captacion/whatsapp'],
    titulo: 'Widget web',
    permiso: 'widget.view',
    pantalla: ['modules/widget/pages/WhatsappWidgetPage.tsx'],
    pasos: [
      {
        titulo: 'El botón de WhatsApp de la web',
        texto: 'El botón flotante que lleva a quien visita la web al WhatsApp de una gestora, por turnos. Aquí ves cuántos lo pulsan y lo configuras, campus a campus. Son {pasos} pasos.',
      },
      {
        donde: anclaje('widget-pulsaciones'),
        titulo: 'Cuántos lo pulsan',
        texto: `Por gestora: cuántas veces el botón le mandó a alguien, cuántas altas dio por WhatsApp y cuántas tienen una pulsación suya de las 24 h antes. Cambia el periodo a la derecha. ${EN_ESTE_CRM.arriba}, sale sumado.`,
      },
      {
        donde: anclaje('widget-codigo'),
        titulo: 'El código para la web',
        texto: 'Elige el idioma del botón, copia el código y pégalo al final de la página (en WordPress, en el código personalizado de Elementor). Se pega una vez: lo demás se cambia desde aquí.',
      },
      {
        donde: anclaje('widget-configuracion'),
        permiso: 'widget.edit',
        titulo: 'Los textos del botón',
        texto: 'Enciéndelo o apágalo, y escribe el texto de la burbuja y el mensaje que le llega a la gestora, en cada idioma. La vista previa enseña cómo queda. «Guardar configuración» y en un minuto está en la web.',
      },
      {
        donde: anclaje('widget-gestoras'),
        permiso: 'widget.edit',
        titulo: 'Quién sale en el botón',
        texto: 'Las gestoras del campus, con su WhatsApp y el nombre que se ve. «En widget» la pone en el botón de todos sus campus; «Excluir solo aquí», solo en este. Teléfono, nombre y «En widget» se guardan solos; excluir, con «Guardar configuración».',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Captación y publicidad › Meta Ads ────────────────────────────────────
  'meta-ads': {
    id: 'meta-ads',
    rutas: ['/meta-ads'],
    titulo: 'Meta Ads',
    permiso: 'meta_ads.view',
    pantalla: ['modules/meta-ads/pages/MetaAdsPage.tsx'],
    pasos: [
      {
        titulo: 'Lo que se gasta en Meta y lo que trae',
        texto: 'El gasto en anuncios de Facebook e Instagram, campaña a campaña, junto a los prospectos y las ventas que llegaron al CRM. Cada campus tiene su cuenta de anuncios. Son {pasos} pasos.',
      },
      {
        donde: anclaje('meta-campus'),
        titulo: 'El campus',
        texto: `${EN_ESTE_CRM.arriba}, elige aquí de qué campus ves los anuncios.`,
      },
      {
        donde: anclaje('meta-cuenta'),
        titulo: 'La cuenta',
        texto: 'La cuenta de anuncios y cuándo se sincronizó por última vez; si falló, el motivo en rojo. Con varias cuentas, el desplegable las suma todas o enseña una sola.',
      },
      {
        donde: anclaje('meta-acciones'),
        titulo: 'Sincronizar y conectar',
        texto: '«Sincronizar ahora» trae el último día; «90d», los últimos 90 días, en segundo plano (tarda). «Cuenta» conecta otra cuenta a este campus y «Configuración» cambia la conexión o la quita.',
      },
      {
        donde: anclaje('meta-rango'),
        titulo: 'El periodo',
        texto: 'Las fechas de todo lo de abajo. 7d, 30d y 90d ponen los últimos días de un toque.',
      },
      {
        donde: anclaje('meta-cifras'),
        titulo: 'Las cifras',
        texto: 'El gasto, las impresiones, los leads (con el CTR: cuántos de cada cien pulsan el anuncio) y el CPL, lo que cuesta cada lead. Debajo, cómo va día a día.',
      },
      {
        donde: anclaje('meta-pestanas'),
        titulo: 'Campañas, productos y ventas',
        texto: '«Campañas» pone los leads que cuenta Meta junto a los que entraron al CRM; despliega una para ver sus conjuntos y anuncios. «Por producto» y «Del gasto a la venta» cruzan el gasto con lo vendido. «Manual» lo explica todo.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
