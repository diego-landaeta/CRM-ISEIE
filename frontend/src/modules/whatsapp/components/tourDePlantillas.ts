import type { Paso } from './Tour';

/**
 * El tutorial guiado de las plantillas (#129).
 *
 * Diego lo pidió con esas palabras: «necesitan un tutorial guiado». Y con un
 * límite que conviene respetar: **cuatro pasos, no veinte**. Un recorrido
 * largo se cierra a la mitad y entonces no ha servido para nada.
 *
 * Son los cuatro que hacen falta para usar la pantalla de verdad: entender qué
 * hay, crear una, meter un dato del CRM y copiarla. Nada de contar todo lo que
 * la pantalla sabe hacer.
 *
 * LA REGLA QUE SE REPITE EN EL ÚLTIMO: se copia, no se envía. Está en el
 * ticket en mayúsculas y en el documento comercial con otras palabras —«la
 * plantilla marca el orden; las palabras las pones tú»—, así que el recorrido
 * termina diciéndolo en vez de con un «ya está».
 */
export const PASOS_DE_PLANTILLAS: Paso[] = [
  {
    titulo: 'Tus plantillas, guardadas aquí',
    texto: 'Las de la casa —las del proceso de ventas— y las tuyas. Se guardan en el CRM, '
         + 'no en este ordenador: si cambias de equipo o limpias el navegador, siguen estando.',
  },
  {
    donde: '[data-tour="modo"]',
    titulo: 'Consultar o editar',
    texto: 'De normal esta pantalla solo enseña. Para crear o cambiar algo, pasa a «Editar»: '
         + 'así no se toca nada sin querer mientras buscas una para copiar.',
  },
  {
    donde: '[data-tour="insertar"]',
    // Solo está en «Editar»: el recorrido pasa a esa vista (#576).
    vista: 'editar',
    titulo: 'Los datos los pone el CRM',
    texto: 'Escribe el mensaje y, donde vaya el nombre o el curso, pulsa el dato en vez de '
         + 'teclearlo. Se pone solo al usarla, con lo que el CRM sepa de esa persona. '
         + 'Escribirlo a mano es de donde salían los huecos que nunca se rellenaban.',
  },
  {
    donde: '[data-tour="copiar"]',
    // Y vuelve a «Consultar», que es donde se copian.
    vista: 'consulta',
    titulo: 'Se copia, no se envía',
    texto: 'El botón es «copiar»: el texto se pega en el chat y lo cambias antes de mandarlo. '
         + 'El CRM no manda plantillas solo, y es a propósito — cien mensajes idénticos es '
         + 'justo lo que WhatsApp detecta, y lo que hace que dejen de funcionar.',
  },
];

/** Aparte del recorrido del chat: haber visto uno no es haber visto el otro. */
export const VISTO_PLANTILLAS = 'wa-tour-plantillas-visto-v1';
