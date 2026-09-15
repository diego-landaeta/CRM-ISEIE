import { Fragment, type ReactNode } from 'react';

/**
 * El texto de un mensaje, con el formato de WhatsApp puesto.
 *
 * Reportado por una gestora: «aparecen unas letras en los mensajes enviados (se
 * siguen enviando y no permite corregir desde la app)».
 *
 * Esas letras son los asteriscos. El chat pintaba el texto crudo:
 *
 *     {m.texto && <div className="wa-texto">{m.texto}</div>}
 *
 * Así que `*Plazas disponibles:* 3` salía con los asteriscos a la vista mientras
 * el móvil lo enseñaba en negrita. El mensaje siempre estuvo bien —por eso «se
 * siguen enviando»—; lo que estaba mal era cómo lo pintábamos aquí. En su
 * captura se ven en `Conscientes*`, `bles:*` y `ocatoria:*`.
 *
 * Se construyen nodos de React, NUNCA `dangerouslySetInnerHTML`: este texto lo
 * escribe quien está al otro lado del chat y no hay ninguna razón para dejarle
 * meter etiquetas en nuestra pantalla.
 */

/** Los cuatro de WhatsApp, en el orden en que conviene mirarlos. */
const MARCAS = [
  // El monoespaciado primero: sus tres comillas contienen a las demás marcas, y
  // mirarlo después dejaría que un asterisco de dentro partiera el bloque.
  { abre: '```', envuelve: (n: ReactNode, k: number) => <code key={k} className="wa-mono">{n}</code> },
  { abre: '*',   envuelve: (n: ReactNode, k: number) => <strong key={k}>{n}</strong> },
  { abre: '_',   envuelve: (n: ReactNode, k: number) => <em key={k}>{n}</em> },
  { abre: '~',   envuelve: (n: ReactNode, k: number) => <s key={k}>{n}</s> },
];

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Un par de marcas de verdad: la de abrir pegada al texto por la derecha, la de
 * cerrar pegada por la izquierda, y ninguna en mitad de una palabra.
 *
 * Sin esto, `2*3*4` saldría con el 3 en negrita y un precio como `5*` se comería
 * media frase buscando el asterisco que lo cierra.
 */
function patron(abre: string): RegExp {
  const m = escapar(abre);
  return abre === '```'
    ? new RegExp(`${m}([\\s\\S]+?)${m}`)
    : new RegExp(`(^|[\\s(¡¿"'\\[{])${m}(\\S[^\\n]*?\\S|\\S)${m}(?=$|[\\s.,;:!?)"'\\]}])`);
}

/** Parte el texto por la primera marca que aparezca y sigue por dentro y por fuera. */
function trocear(texto: string, desde = 0, llave = { n: 0 }): ReactNode[] {
  if (desde >= MARCAS.length) return [texto];

  const { abre, envuelve } = MARCAS[desde];
  const re = patron(abre);
  const salida: ReactNode[] = [];
  let resto = texto;

  for (;;) {
    const hallado = re.exec(resto);
    if (!hallado) break;

    // El monoespaciado no lleva el grupo de «lo que hay antes»; los otros sí.
    const antesDeLaMarca = abre === '```' ? '' : hallado[1];
    const dentro = abre === '```' ? hallado[1] : hallado[2];

    const previo = resto.slice(0, hallado.index) + antesDeLaMarca;
    if (previo) salida.push(...trocear(previo, desde + 1, llave));

    // Dentro del monoespaciado no se busca más formato: es texto literal.
    const hijos = abre === '```' ? [dentro] : trocear(dentro, desde + 1, llave);
    salida.push(envuelve(hijos, llave.n++));

    resto = resto.slice(hallado.index + hallado[0].length);
  }

  if (resto) salida.push(...trocear(resto, desde + 1, llave));
  return salida;
}

export default function TextoDeWhatsapp({ texto }: { texto: string }) {
  if (!texto) return null;
  // Los saltos de línea se respetan con CSS (`white-space: pre-wrap`), no
  // partiendo el texto: así una lista del bot se lee como se escribió.
  return <Fragment>{trocear(texto)}</Fragment>;
}

export { trocear as _trocear };
