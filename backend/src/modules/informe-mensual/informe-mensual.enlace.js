import crypto from 'node:crypto';

/**
 * El enlace de descarga del ZIP del mes, cuando no cabe en el correo (#772).
 *
 * Como el de la copia diaria: firmado (HMAC-SHA256) y con caducidad. La firma
 * es la llave, porque la gestoría no tiene usuario en el CRM. No se guarda
 * ningún fichero: al pulsarlo se vuelve a armar el ZIP de esa empresa y ese mes.
 *
 * Se firma con JWT_SECRET y un prefijo propio: una firma de este enlace no vale
 * para el de la copia, ni al revés.
 */

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
const FIRMA = /^[A-Za-z0-9_-]{43}$/;

function firma(issuerId, periodo, exp, secreto = process.env.JWT_SECRET) {
  if (!secreto) throw new Error('Falta JWT_SECRET: no se puede firmar el enlace del informe mensual');
  return crypto.createHmac('sha256', `informe-mensual:descarga:${secreto}`)
    .update(`${issuerId}.${periodo}.${exp}`).digest('base64url');
}

/** `{ exp, sig }` para una empresa y un mes, válido `horas` horas desde `ahora`. */
export function firmar(issuerId, periodo, { horas = 168, ahora = Date.now(), secreto } = {}) {
  const exp = Math.floor(ahora / 1000) + Math.round(horas * 3600);
  return { exp, sig: firma(Number(issuerId), periodo, exp, secreto) };
}

/** ¿Vale? Sin caducar, con su firma, y para esa empresa y ese mes exactamente. */
export function firmaValida(issuerId, periodo, exp, sig, { ahora = Date.now(), secreto } = {}) {
  const id = Number(issuerId);
  const n = Number(exp);
  if (!Number.isInteger(id) || id <= 0 || !PERIODO.test(String(periodo || ''))) return false;
  if (!Number.isInteger(n) || n * 1000 < ahora) return false;
  if (typeof sig !== 'string' || !FIRMA.test(sig)) return false;
  let esperada;
  try { esperada = Buffer.from(firma(id, periodo, n, secreto)); } catch { return false; }
  const recibida = Buffer.from(sig);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

/** La dirección completa del enlace. */
export function urlDeDescarga(apiPublica, issuerId, periodo, opciones = {}) {
  const { exp, sig } = firmar(issuerId, periodo, opciones);
  return {
    url: `${String(apiPublica).replace(/\/+$/, '')}/informe-mensual/descarga/${Number(issuerId)}/${periodo}?exp=${exp}&sig=${sig}`,
    caduca: new Date(exp * 1000),
  };
}
