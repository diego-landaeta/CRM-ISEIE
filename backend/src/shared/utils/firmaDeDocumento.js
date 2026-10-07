import crypto from 'node:crypto';

/**
 * Enlaces firmados y con caducidad para los documentos de una matrícula.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTO
 *
 * La ruta `/api/matriculas/:id/doc/:tipo` estaba FUERA de `verifyToken`, con
 * este comentario al lado:
 *
 *     // Doc download es publico (la URL ya es no-guessable)
 *
 * La URL es `/api/matriculas/1/doc/dni`. El 1 es la matrícula, y la siguiente
 * es la 2. No hay nada que adivinar: se cuenta. Cualquiera con un navegador y
 * sin cuenta en el CRM se bajaba los DNI escaneados de todas las matrículas.
 * Comprobado: HTTP 200 sin mandar credencial ninguna.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON PONERLE `verifyToken`
 *
 * Porque el botón de la pantalla es un `<a href>` normal, y una etiqueta `<a>`
 * no puede mandar una cabecera `Authorization`. Con el candado puesto a secas,
 * el botón deja de funcionar para todo el mundo.
 *
 * Así que la credencial viaja EN LA PROPIA DIRECCIÓN, firmada y con fecha de
 * caducidad — es lo mismo que hacen los enlaces pre-firmados de R2, que este
 * CRM ya usa para los dossiers (`presignedUrl.js`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROTEGE Y QUÉ NO
 *
 * La firma se calcula sobre la matrícula, el tipo de documento y el instante
 * de caducidad. Cambiar el número de la matrícula invalida la firma, así que
 * contar 1, 2, 3 deja de servir: haría falta la clave del servidor para
 * fabricar la firma de cada número.
 *
 * Lo que NO protege: quien reciba un enlace ya firmado puede abrirlo mientras
 * no caduque. Por eso son QUINCE MINUTOS y se firman al leer la ficha, no al
 * subir el documento — un enlace guardado en la base duraría para siempre, que
 * es de donde venimos.
 */

/** Quince minutos, igual que los enlaces pre-firmados de R2. */
const VALIDEZ_SEGUNDOS = 15 * 60;

/**
 * La clave con la que se firma.
 *
 * Se lee en cada llamada y no al cargar el módulo: así las pruebas pueden
 * ponerla y quitarla, y un despliegue que cambie el `.env` no necesita que
 * nadie recuerde reiniciar en el orden correcto.
 */
function clave() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Falta JWT_SECRET: no se pueden firmar los documentos');
  return s;
}

function calcular(id, tipo, exp) {
  return crypto.createHmac('sha256', clave())
    .update(`matricula:${id}:${tipo}:${exp}`)
    .digest('base64url');
}

/** La parte de la dirección que lleva la firma: `?exp=…&sig=…`. */
export function firmaParaUrl(id, tipo, ahora = Date.now()) {
  const exp = Math.floor(ahora / 1000) + VALIDEZ_SEGUNDOS;
  return `exp=${exp}&sig=${calcular(id, tipo, exp)}`;
}

/** La dirección completa y firmada de un documento. */
export function urlFirmada(id, tipo) {
  return `/api/matriculas/${id}/doc/${tipo}?${firmaParaUrl(id, tipo)}`;
}

/**
 * ¿Vale esta firma para este documento, ahora?
 *
 * La comparación es en tiempo constante (`timingSafeEqual`): con un `===` se
 * puede averiguar una firma byte a byte midiendo lo que tarda en fallar.
 */
export function firmaValida({ id, tipo, exp, sig }, ahora = Date.now()) {
  if (!exp || !sig) return false;
  const caduca = Number(exp);
  if (!Number.isFinite(caduca)) return false;
  if (caduca * 1000 < ahora) return false;

  const esperada = Buffer.from(calcular(id, tipo, String(caduca)), 'utf8');
  const recibida = Buffer.from(String(sig), 'utf8');
  if (esperada.length !== recibida.length) return false;
  return crypto.timingSafeEqual(esperada, recibida);
}
