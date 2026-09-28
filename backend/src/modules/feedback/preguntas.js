import { MOTIVOS } from './motivos.js';

/**
 * Las preguntas de la encuesta de feedback, en UN solo sitio.
 *
 * Diego, 28/09: seis preguntas, todas en desplegable, y si elige «Otro» que
 * pueda escribir. El que le atendió es «el asesor» —vale para gestoras y
 * gestores— con su nombre debajo: «El asesor: Yosbely». La nota se le suma a
 * su gestora por dentro (`feedback_envios.gestora_id` → panel, «Nota de
 * atención»).
 *
 * La pantalla NO las conoce: las pinta tal como llegan del servidor. Cambiar una
 * pregunta, quitarla o añadir otra se hace aquí y no toca el frontal. Lo que se
 * guarda es la CLAVE de cada respuesta, así que reescribir un texto no rompe lo
 * que ya contestó nadie.
 *
 * Solo la primera es obligatoria: una encuesta que exige todas se abandona a la
 * mitad, y es mejor una respuesta que ninguna.
 *
 * Tipos (todos se pintan como desplegable):
 *   unica  : una opción
 *   varias : las que quiera
 *   escala : de 1 a 5, con su palabra («4 · Bien»); se guarda el número
 *
 * `escribir`: la opción que abre un recuadro para escribir. Lo escrito se guarda
 * en `<clave>_otro`.
 *
 * {programa} se rellena con el curso de esa persona y {asesor} con el nombre de
 * su gestora; sin gestora, esa línea no sale.
 */
export const ESCALA = [
  { clave: '5', texto: 'Muy bien' },
  { clave: '4', texto: 'Bien' },
  { clave: '3', texto: 'Regular' },
  { clave: '2', texto: 'Mal' },
  { clave: '1', texto: 'Muy mal' },
];

export const PREGUNTAS = [
  {
    clave: 'motivo', tipo: 'unica', obligatoria: true,
    texto: '¿Por qué no seguiste adelante?',
    opciones: MOTIVOS,
    escribir: 'otro',
  },
  {
    clave: 'nota_atencion', tipo: 'escala',
    texto: '¿Cómo te atendió el asesor?',
    destacado: 'El asesor: {asesor}',
    opciones: ESCALA,
  },
  {
    clave: 'a_tiempo', tipo: 'unica',
    texto: '¿El asesor te respondió a tiempo?',
    opciones: [
      { clave: 'enseguida', texto: 'Sí, enseguida' },
      { clave: 'un_poco', texto: 'Tardó un poco' },
      { clave: 'demasiado', texto: 'Tardó demasiado' },
      { clave: 'nunca', texto: 'No me respondió' },
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
      { clave: 'otra', texto: 'Otra cosa' },
    ],
    escribir: 'otra',
  },
  {
    // Diego, 28/09: el «sí» tiene que acabar siendo un futuro contacto para su
    // gestora. Cómo (cuándo, en qué agenda) está por decidir; de momento queda
    // en su historial y en el aviso a la gestora.
    clave: 'avisar', tipo: 'unica',
    texto: '¿Quieres que el asesor te vuelva a contactar más adelante?',
    opciones: [
      { clave: 'si', texto: 'Sí, que me contacte más adelante' },
      { clave: 'no', texto: 'No, gracias' },
    ],
  },
];

/** Las preguntas con el curso y el asesor de esa persona ya puestos. */
export function preguntasPara({ programa = null, asesor = null } = {}) {
  // El nombre del curso, entre comillas: «el contenido de «Máster en…»», no
  // «el contenido de Máster en…». Sin curso conocido, «la formación».
  const que = programa ? `«${programa}»` : 'la formación';
  return PREGUNTAS.map(({ destacado, ...p }) => ({
    ...p,
    texto: p.texto.replace('{programa}', que),
    ...(destacado && asesor ? { destacado: destacado.replace('{asesor}', asesor) } : {}),
  }));
}

const vale = (p, clave) => p.opciones.some((o) => o.clave === clave);

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
      if (vale(p, v)) r[p.clave] = v;
    } else if (p.tipo === 'varias') {
      const lista = (Array.isArray(v) ? v : [v]).filter((x) => vale(p, x));
      if (lista.length) r[p.clave] = [...new Set(lista)];
    } else if (p.tipo === 'escala') {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= 5) r[p.clave] = n;
    }
    // Lo escrito en «Otro», solo si de verdad eligió «Otro».
    const elegida = [].concat(r[p.clave] ?? []);
    if (p.escribir && elegida.includes(p.escribir)) {
      const t = String(entrada[`${p.clave}_otro`] ?? '').trim().slice(0, 1000);
      if (t) r[`${p.clave}_otro`] = t;
    }
  }
  return r;
}

/** «Otro motivo: «me mudo»» / «4/5 · Bien» — para el historial y el aviso. */
export function textoDeRespuesta(clave, valor, otro = null) {
  const p = PREGUNTAS.find((x) => x.clave === clave);
  if (!p) return String(valor);
  if (p.tipo === 'escala') return `${valor}/5 · ${ESCALA.find((o) => o.clave === String(valor))?.texto || ''}`.trim();
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista
    .map((v) => {
      const texto = p.opciones.find((o) => o.clave === v)?.texto || v;
      return v === p.escribir && otro ? `${texto}: «${otro}»` : texto;
    })
    .join(', ');
}
