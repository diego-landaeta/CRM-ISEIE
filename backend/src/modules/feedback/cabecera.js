import crypto from 'node:crypto';
import sharp from 'sharp';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * La cabecera de la marca para los CORREOS, como una imagen PNG sin
 * transparencias.
 *
 * Diego, 28/09: «llegó el de Fono y se ve feo: el logo sale con fondo negro,
 * en el tema oscuro y en el claro». Gmail pasa las imágenes por su proxy y a
 * un WEBP transparente le pinta el fondo de negro; y en modo oscuro los
 * clientes invierten los colores del HTML, pero no los de una imagen.
 *
 * Así que la cabecera del correo no se arma con HTML: se DIBUJA aquí —el logo
 * ya pegado sobre el fondo de la marca, con el filete de su color debajo— y el
 * correo la enseña como una sola imagen opaca. Ningún tema ni cliente la toca.
 *
 * Con sharp, no con el Chrome de puppeteer: en el servidor de MultiCRM ese
 * Chrome no arranca (le faltan librerías del sistema), y sharp trae su propio
 * motor. Se guarda en memoria por marca y versión (logo + colores): cambiar la
 * marca en el panel cambia la versión, y el correo siguiente pide la nueva.
 */

// Al doble del tamaño con el que se ve (560 × 132): en retina no sale borroso.
//
// Antes era 560 × 88 con el logo en 520 × 104. Carlos, 02/10 (#213): en el
// móvil la cabecera se queda en unos 300 px de ancho y el logo de Psiko —de
// trazo fino y casi cuadrado— medía 25 px de alto: no se distinguía. Más alta y
// con el logo más grande se reconoce en las 10 marcas (comprobado una a una).
const ANCHO = 1120;
const ALTO = 264;
const FILETE = 8;
const MARGEN = 56;
const LOGO_ALTO = 184;
const LOGO_ANCHO = 760;
const MAX_EN_MEMORIA = 60;
// Entra en la versión: si cambian las medidas, cambia la dirección de la imagen
// y Gmail no sigue enseñando la vieja que tiene guardada.
const DISENO = '2';

// `${id}:${version}` -> la promesa del PNG: si llegan diez peticiones a la vez
// para una marca sin dibujar, se dibuja una vez, no diez.
const hechas = new Map();

const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);

/** La versión de la cabecera: cambia en cuanto cambia el logo o un color. */
export function versionDe(marca) {
  return crypto.createHash('sha1')
    .update([DISENO, marca.logo_url, marca.color_cabecera, marca.theme_color, marca.proyecto || marca.nombre].join('|'))
    .digest('hex').slice(0, 10);
}

async function marcaDe(projectId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.logo_url, p.theme_color, to_jsonb(p) ->> 'color_cabecera' AS color_cabecera
       FROM projects p WHERE p.id = $1`, [projectId]);
  return rows[0] || null;
}

/** El logo, bajado de la web de la marca. Sin logo o si no baja: null. */
async function bajarLogo(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CRM cabecera de correo)' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn({ err: err.message, url }, 'cabecera: no se pudo bajar el logo');
    return null;
  }
}

/** Un rectángulo liso de un color, para el fondo y el filete. */
const liso = (width, height, background) => sharp({ create: { width, height, channels: 3, background } });

export async function dibujar(marca) {
  const fondo = hex(marca.color_cabecera) || '#ffffff';
  const acento = hex(marca.theme_color) || '#1f4e79';
  const capas = [{ input: await liso(ANCHO, FILETE, acento).png().toBuffer(), top: ALTO - FILETE, left: 0 }];
  const original = await bajarLogo(marca.logo_url);
  if (original) {
    try {
      // `inside`: cabe entero sin deformarse; el transparente se queda
      // transparente y al pegarlo encima toma el color del fondo.
      const logo = await sharp(original).resize({ width: LOGO_ANCHO, height: LOGO_ALTO, fit: 'inside' }).png().toBuffer();
      const { height } = await sharp(logo).metadata();
      capas.push({ input: logo, top: Math.round((ALTO - FILETE - height) / 2), left: MARGEN });
    } catch (err) {
      logger.warn({ err: err.message, url: marca.logo_url }, 'cabecera: el logo no se pudo leer');
    }
  }
  // Sin logo, la cabecera queda en el color de la marca y el correo lleva su
  // nombre en el texto de al lado (`alt`): mejor eso que letras sin fuente.
  // Sin canal de transparencia: nada que un proxy pueda volver a pintar de negro.
  return liso(ANCHO, ALTO, fondo).composite(capas).removeAlpha().png().toBuffer();
}

/** La cabecera de esa marca, de memoria o recién dibujada. */
export async function cabeceraDe(projectId) {
  const marca = await marcaDe(projectId);
  if (!marca) return null;
  const clave = `${marca.id}:${versionDe({ ...marca, proyecto: marca.nombre })}`;
  if (!hechas.has(clave)) {
    if (hechas.size >= MAX_EN_MEMORIA) hechas.delete(hechas.keys().next().value);
    hechas.set(clave, dibujar(marca).catch((err) => { hechas.delete(clave); throw err; }));
  }
  return hechas.get(clave);
}

/** GET /api/f/cabecera/:projectId — pública: la pide el cliente de correo. */
export async function servir(req, res, next) {
  try {
    const id = Number.parseInt(req.params.projectId, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
    const png = await cabeceraDe(id);
    if (!png) return res.status(404).end();
    res.set('Content-Type', 'image/png');
    // La URL lleva la versión (?v=...): se puede guardar un día sin miedo.
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(png);
  } catch (err) {
    return next(err);
  }
}

/*
  LA INSIGNIA: el logo solo, sobre el fondo de su marca, para la fila de cada
  empresa en los resúmenes al equipo.

  Diego, 29/09, sobre el resumen del día de ISEIE: «pusiste el logo y sello, pon
  el logo en ambos». Arriba iba la cabecera con el logo y, en la fila de la
  empresa, la imagen de FACTURACIÓN de la sociedad, que en ISEIE es el sello.

  Se dibuja por lo mismo que la cabecera: el logo de ISEIE es blanco, pensado
  para ir sobre el azul, y pegado tal cual en un correo blanco no se ve. Así
  sale sobre su color, opaco, igual en el tema claro y en el oscuro.
*/
// Al doble de como se ve (40 px de alto).
const INSIGNIA_ALTO = 80;
const INSIGNIA_MARGEN = 14;
const INSIGNIA_LOGO_ANCHO = 360;

export async function dibujarInsignia(marca) {
  const original = await bajarLogo(marca.logo_url);
  if (!original) return null;
  const fondo = hex(marca.color_cabecera) || '#ffffff';
  const logo = await sharp(original)
    .resize({ width: INSIGNIA_LOGO_ANCHO, height: INSIGNIA_ALTO - 2 * INSIGNIA_MARGEN, fit: 'inside' })
    .png().toBuffer();
  const { width, height } = await sharp(logo).metadata();
  return liso(width + 2 * INSIGNIA_MARGEN, INSIGNIA_ALTO, fondo)
    .composite([{ input: logo, top: Math.round((INSIGNIA_ALTO - height) / 2), left: INSIGNIA_MARGEN }])
    .removeAlpha().png().toBuffer();
}

/** La insignia de esa marca, de memoria o recién dibujada. Sin logo: null. */
export async function insigniaDe(projectId) {
  const marca = await marcaDe(projectId);
  if (!marca?.logo_url) return null;
  const clave = `insignia:${marca.id}:${versionDe({ ...marca, proyecto: marca.nombre })}`;
  if (!hechas.has(clave)) {
    if (hechas.size >= MAX_EN_MEMORIA) hechas.delete(hechas.keys().next().value);
    hechas.set(clave, dibujarInsignia(marca).catch((err) => { hechas.delete(clave); throw err; }));
  }
  return hechas.get(clave);
}

/** GET /api/f/insignia/:projectId — pública, como la cabecera. */
export async function servirInsignia(req, res, next) {
  try {
    const id = Number.parseInt(req.params.projectId, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
    const png = await insigniaDe(id);
    if (!png) return res.status(404).end();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(png);
  } catch (err) {
    return next(err);
  }
}
