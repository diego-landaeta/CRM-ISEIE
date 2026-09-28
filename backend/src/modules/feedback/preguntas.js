import { MOTIVOS } from './motivos.js';

/**
 * Las preguntas de la encuesta de feedback, en UN solo sitio.
 *
 * Diego, 28/09: «más preguntas con todo eso: cómo le fue con el gestor, el
 * nombre del gestor, qué le pareció el contenido… que pueda escribir, selección
 * múltiple».
 *
 * La pantalla NO las conoce: las pinta tal como llegan del servidor. Cambiar una
 * pregunta, quitarla o añadir otra se hace aquí y no toca el frontal. Lo que se
 * guarda es la CLAVE de cada respuesta, así que reescribir un texto no rompe lo
 * que ya contestó nadie.
 *
 * Solo la primera es obligatoria: una encuesta que exige ocho respuestas se
 * abandona en la tercera, y es mejor una respuesta que ninguna.
 *
 * Tipos:
 *   unica  : una opción
 *   varias : las que quiera
 *   escala : de 1 a 5
 *   texto  : escribir (máx. 1000)
 *
 * {gestora} y {programa} se rellenan con los de esa persona.
 */
export const PREGUNTAS = [
  {
    clave: 'motivo', tipo: 'unica', obligatoria: true,
    texto: '¿Por qué no seguiste adelante?',
    opciones: MOTIVOS,
  },
  {
    clave: 'nota_atencion', tipo: 'escala',
    texto: '¿Cómo te atendió {gestora}?',
    ayuda: '1 = muy mal · 5 = muy bien',
  },
  {
    clave: 'mensaje_gestora', tipo: 'texto',
    texto: '¿Algo que quieras decirle a {gestora} o que mejorarías de cómo te atendió?',
  },
  {
    clave: 'a_tiempo', tipo: 'unica',
    texto: '¿{gestora} te respondió a tiempo?',
    opciones: [
      { clave: 'enseguida', texto: 'Sí, enseguida' },
      { clave: 'un_poco', texto: 'Tardó un poco' },
      { clave: 'demasiado', texto: 'Tardó demasiado' },
      { clave: 'nunca', texto: 'No me respondió' },
    ],
  },
  {
    clave: 'claridad', tipo: 'unica',
    texto: '¿La información que te dimos fue clara?',
    opciones: [
      { clave: 'si', texto: 'Sí, muy clara' },
      { clave: 'mas_o_menos', texto: 'Más o menos' },
      { clave: 'no', texto: 'No, me quedaron dudas' },
    ],
  },
  {
    clave: 'contenido', tipo: 'unica',
    texto: '¿Qué te pareció el contenido de {programa}?',
    opciones: [
      { clave: 'muy_interesante', texto: 'Muy interesante' },
      { clave: 'no_lo_que_buscaba', texto: 'Interesante, pero no era lo que buscaba' },
      { clave: 'basico', texto: 'Demasiado básico para mí' },
      { clave: 'avanzado', texto: 'Demasiado avanzado para mí' },
      { clave: 'no_lo_vi', texto: 'No llegué a verlo' },
    ],
  },
  {
    clave: 'decidirse', tipo: 'varias',
    texto: '¿Qué te habría hecho decidirte?',
    ayuda: 'Puedes marcar varias',
    opciones: [
      { clave: 'precio', texto: 'Un precio más bajo' },
      { clave: 'plazos', texto: 'Poder pagar a plazos' },
      { clave: 'beca', texto: 'Una beca o un descuento' },
      { clave: 'fechas', texto: 'Otras fechas u horarios' },
      { clave: 'temario', texto: 'Más información del temario' },
      { clave: 'llamada', texto: 'Hablar con alguien por teléfono' },
      { clave: 'nada', texto: 'Nada: no era para mí' },
    ],
  },
  {
    clave: 'avisar', tipo: 'unica',
    texto: '¿Quieres que te avisemos de próximas convocatorias o becas?',
    opciones: [
      { clave: 'si', texto: 'Sí, avisadme' },
      { clave: 'no', texto: 'No, gracias' },
    ],
  },
  {
    clave: 'comentario', tipo: 'texto',
    texto: '¿Algo más que quieras contarnos?',
  },
];

/** Las preguntas con los nombres de esa persona ya puestos. */
export function preguntasPara({ gestora = null, programa = null } = {}) {
  const quien = gestora || 'nuestro equipo';
  // El nombre del curso, entre comillas: «el contenido de «Máster en…»», no
  // «el contenido de Máster en…». Sin curso conocido, «la formación».
  const que = programa ? `«${programa}»` : 'la formación';
  return PREGUNTAS.map((p) => ({
    ...p,
    // «¿nuestro equipo te respondió…?» -> «¿Nuestro equipo…?»: el nombre puede
    // caer al principio de la pregunta.
    texto: p.texto.replace('{gestora}', quien).replace('{programa}', que)
      .replace(/^(¿?)(\p{Ll})/u, (_, signo, letra) => signo + letra.toUpperCase()),
  }));
}

/**
 * Deja solo lo válido de lo que llega de la encuesta. Lo que no encaja con su
 * pregunta se descarta en silencio: no se le devuelve un error a quien nos está
 * haciendo el favor de contestar.
 */
export function limpiarRespuestas(entrada = {}) {
  const r = {};
  for (const p of PREGUNTAS) {
    const v = entrada[p.clave];
    if (v === undefined || v === null || v === '') continue;
    if (p.tipo === 'unica') {
      if (p.opciones.some((o) => o.clave === v)) r[p.clave] = v;
    } else if (p.tipo === 'varias') {
      const lista = (Array.isArray(v) ? v : [v]).filter((x) => p.opciones.some((o) => o.clave === x));
      if (lista.length) r[p.clave] = [...new Set(lista)];
    } else if (p.tipo === 'escala') {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= 5) r[p.clave] = n;
    } else if (p.tipo === 'texto') {
      const t = String(v).trim().slice(0, 1000);
      if (t) r[p.clave] = t;
    }
  }
  return r;
}

/** «¿Por qué…?: El precio» — para la línea del historial y el aviso. */
export function textoDeRespuesta(clave, valor) {
  const p = PREGUNTAS.find((x) => x.clave === clave);
  if (!p) return String(valor);
  if (p.tipo === 'escala') return `${valor}/5`;
  if (p.tipo === 'texto') return `«${valor}»`;
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista.map((v) => p.opciones.find((o) => o.clave === v)?.texto || v).join(', ');
}
