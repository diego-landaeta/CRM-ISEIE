import crypto from 'node:crypto';

// Firma temporal para los adjuntos.
//
// Un <img src="..."> o un <audio src="..."> los pide el NAVEGADOR, y el
// navegador no manda la cabecera Authorization. Por eso las fotos y los audios
// salian con 401: el endpoint pedia token y la etiqueta no lo lleva.
//
// La solucion no es abrir la carpeta al mundo —son conversaciones de
// clientes—, sino firmar la direccion: lleva una caducidad y una firma que solo
// puede calcular el servidor. Vale 30 minutos, lo justo para ver el chat.

const VIGENCIA_MS = 30 * 60 * 1000;

// La caducidad se redondea a tramos de cuarto de hora.
//
// La pantalla vuelve a pedir el hilo cada cinco segundos. Con una caducidad
// calculada al milisegundo, la direccion de cada foto cambiaba en cada vuelta:
// el navegador la veia como otra distinta, tiraba lo que tenia en cache y se
// bajaba otra vez TODAS las fotos y todos los audios del chat, cada cinco
// segundos. Redondeando, la direccion es la misma durante un cuarto de hora y
// el navegador la guarda. Vale entre 30 y 45 minutos, que da igual.

const clave = () => process.env.JWT_SECRET || 'sin-clave';

const calcular = (id, caduca) =>
  crypto.createHmac('sha256', clave()).update(`${id}.${caduca}`).digest('base64url');

/**
 * El permiso para pedir un adjunto, como trozo de consulta: «?c=...&f=...».
 *
 * Devuelve SOLO la firma, no la direccion entera. Antes devolvia la direccion
 * completa empezando por «/api/...» y ahi estaba el fallo: el CRM no se sirve
 * desde la raiz sino desde /crm/ (y /testeo/ en QA), asi que el navegador
 * pedia una direccion que no existe y todas las fotos salian rotas. Quien sabe
 * bajo que prefijo esta montado es el frontend; aqui solo se firma.
 */
export function firma(mensajeId) {
  const TRAMO_MS = 15 * 60 * 1000;
  const caduca = Math.ceil((Date.now() + VIGENCIA_MS) / TRAMO_MS) * TRAMO_MS;
  return `?c=${caduca}&f=${encodeURIComponent(calcular(mensajeId, caduca))}`;
}

/** ¿Es valida esta firma? */
export function valida(mensajeId, caduca, firma) {
  const c = Number(caduca);
  if (!c || Number.isNaN(c) || c < Date.now()) return false;
  const esperada = calcular(mensajeId, c);
  // Comparacion en tiempo constante: comparar con === filtra por el tiempo que
  // tarda en fallar y deja adivinar la firma byte a byte.
  const a = Buffer.from(String(firma || ''));
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
