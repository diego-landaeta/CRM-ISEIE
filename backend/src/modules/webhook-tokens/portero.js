import { AppError } from '../../shared/utils/AppError.js';
import { MAX_ENVIO_BYTES } from '../matriculas/admision.archivos.js';
import * as model from './token.model.js';

/**
 * EL PORTERO DEL WEBHOOK PÚBLICO (#198): va delante de leer el envío.
 *
 * El envío puede pesar 19 MB (JSON con imágenes en texto, o archivos en
 * multipart) y se lee entero en memoria. Antes se leía primero y el token se
 * miraba después: con tokens inventados —cada uno con su propio límite por
 * minuto— unas decenas de envíos a la vez llenaban la memoria del servidor sin
 * tener ningún token de verdad. Ahora el token tiene que existir y estar activo
 * ANTES de leer nada; si no, 404.
 *
 * Sin límite por IP a propósito: es la pregunta 7 de Diego en
 * docs/PARIDAD-ENTRE-CRMS.md (los envíos de Make salen de las mismas IP y un
 * límite por IP podría frenar una ráfaga legítima de nueve campus), y la decide
 * él. El límite por token (60/min) sigue en token.routes.js.
 */
export async function porteroDelWebhook(req, _res, next) {
  try {
    const tok = await model.findByToken(req.params.token);
    if (!tok) throw new AppError('Token invalido o inactivo', 404, 'INVALID_TOKEN');
    req.webhookToken = tok;
    next();
  } catch (err) { next(err); }
}

const demasiadoGrande = () => new AppError('El envío pasa de 19 MB en total.', 413, 'ENVIO_DEMASIADO_GRANDE');

/**
 * EL TOPE DEL ENVÍO ENTERO (QA de Diego, 22/10), sin guardarlo en memoria: por lo que dice
 * `Content-Length`, que mandan los formularios y Make. Vale para JSON, formulario y
 * multipart (multer solo sabe de cada archivo, no del total). Uno sin `Content-Length`
 * (por trozos) lo cortan los lectores de JSON y formulario con el mismo tope
 * (`traducirTope`), y en multipart Nginx a los 20 MB.
 */
export function topeDelEnvio(req, _res, next) {
  if (!(Number(req.headers['content-length']) > MAX_ENVIO_BYTES)) return next();
  // Se contesta DESPUÉS de vaciar lo que llega (sin guardarlo), como hacen express.json y
  // urlencoded al pasarse: contestar a mitad corta la conexión, y quien manda directamente
  // a la aplicación se encuentra un ECONNRESET en vez del 413. Detrás de Nginx el 413
  // llegaba igual (probado el 23/10), pero así sale bien en los dos casos.
  req.once('end', () => next(demasiadoGrande()));
  req.resume();
}

/** El «request entity too large» de express.json/urlencoded, con el mismo motivo que `topeDelEnvio`. */
export function traducirTope(err, _req, _res, next) {
  next(err?.type === 'entity.too.large' ? demasiadoGrande() : err);
}
