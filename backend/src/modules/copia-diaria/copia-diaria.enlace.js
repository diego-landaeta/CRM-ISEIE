import crypto from 'node:crypto';

/**
 * El enlace de descarga, cuando la copia no cabe en el correo.
 *
 * Firmado (HMAC-SHA256) y con caducidad. La firma es la llave: no pide entrar,
 * porque quien lo recibe no tiene por qué tener usuario en este CRM. Solo da el
 * fichero CIFRADO; la contraseña nunca viaja ni en el enlace ni en el correo.
 *
 * Se firma con JWT_SECRET y un prefijo propio, NO con la contraseña del zip: la
 * firma va a la vista en el correo, y una firma hecha con la contraseña daría
 * para probar contraseñas a toda velocidad sin tocar el zip.
 */

const FICHERO = /^[A-Za-z0-9_.-]{1,120}-\d{4}-\d{2}-\d{2}\.zip$/;
const FIRMA = /^[A-Za-z0-9_-]{43}$/;

export const ficheroValido = (f) => FICHERO.test(String(f || '')) && !String(f).includes('..');

function firma(fichero, exp, secreto = process.env.JWT_SECRET) {
  if (!secreto) throw new Error('Falta JWT_SECRET: no se puede firmar el enlace de la copia');
  return crypto.createHmac('sha256', `copia-diaria:descarga:${secreto}`)
    .update(`${fichero}.${exp}`).digest('base64url');
}

/** `{ exp, sig }` para un fichero, válido `horas` horas desde `ahora`. */
export function firmar(fichero, { horas = 48, ahora = Date.now(), secreto } = {}) {
  const exp = Math.floor(ahora / 1000) + Math.round(horas * 3600);
  return { exp, sig: firma(fichero, exp, secreto) };
}

/** ¿Vale? Sin caducar, con su firma y para ese fichero exactamente. */
export function firmaValida(fichero, exp, sig, { ahora = Date.now(), secreto } = {}) {
  const n = Number(exp);
  if (!ficheroValido(fichero) || !Number.isInteger(n) || n * 1000 < ahora) return false;
  if (typeof sig !== 'string' || !FIRMA.test(sig)) return false;
  let esperada;
  try { esperada = Buffer.from(firma(fichero, n, secreto)); } catch { return false; }
  const recibida = Buffer.from(sig);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

/** La dirección completa del enlace. */
export function urlDeDescarga(apiPublica, fichero, opciones = {}) {
  const { exp, sig } = firmar(fichero, opciones);
  return {
    url: `${String(apiPublica).replace(/\/+$/, '')}/copia-diaria/descarga/${encodeURIComponent(fichero)}?exp=${exp}&sig=${sig}`,
    caduca: new Date(exp * 1000),
  };
}
