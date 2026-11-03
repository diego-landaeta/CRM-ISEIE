import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { getLocal, saveLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import * as model from './certifex.model.js';
import { proyectoDeCentro } from './certifex.programa.js';

/**
 * LA FIRMA DEL ALUMNO EN EL DIPLOMA (Diego, 19/10/2026; CRM #349).
 *
 * «Todo tiene que tener la firma del alumno para cargar, y si no la tiene debe salir
 * para cargarla.» Va sobre la línea «El interesado» del diploma, siempre con el fondo
 * transparente («que la firma llegue en fondo transparente», 16/10).
 *
 * De dónde sale, en este orden:
 *   1. La subida a mano en «Revisar datos antes de aprobar» (certifex_solicitudes.firma_key,
 *      migración 207), ya procesada.
 *   2. La de la matrícula de admisión del mismo correo en ese campus (matriculas.firma_key),
 *      que se procesa al leerla: puede ser una foto o un escaneo con fondo blanco. Solo
 *      de una admisión aceptada/en vigor, «Validada» (QA de Diego, 22/10).
 * Sin ninguna, el diploma sale como hasta ahora, con el nombre impreso.
 */

// Por encima de CLARO, transparente; por debajo de OSCURO, tinta entera; entre medias,
// gradual (los bordes del trazo quedan suaves). Medido en luminancia (0-255).
const CLARO = 205;
const OSCURO = 90;
// En el diploma se ve a unos 50-70 px de alto: 900 sobra y deja cada envío a Certifex
// en decenas de KB (van de 10 en 10 al emitir).
export const MAX_LADO = 900;
const MARGEN = 6;
// Por debajo de esto no hay firma: una hoja en blanco, o una foto casi vacía.
const MIN_PIXELES_TINTA = 30;

const ERROR_IMAGEN = 'No es una imagen PNG, JPG o WEBP que se pueda leer.';

/**
 * La firma como PNG con el fondo transparente y recortada al trazo. Acepta PNG, JPG o
 * WEBP (con o sin transparencia: lo que ya fuera transparente se pone sobre blanco y se
 * vuelve a calcular, así sale igual venga como venga). Conserva el color de la tinta.
 * Lanza 400 si no es una imagen o si no hay trazo.
 */
export async function firmaTransparente(buffer) {
  let img;
  try {
    img = sharp(buffer, { failOn: 'error', limitInputPixels: 50_000_000 });
    const meta = await img.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error(`formato ${meta.format}`);
  } catch {
    throw new AppError(ERROR_IMAGEN, 400, 'FIRMA_NO_VALIDA');
  }
  let raw;
  try {
    raw = await img
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: MAX_LADO, height: MAX_LADO, fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(ERROR_IMAGEN, 400, 'FIRMA_NO_VALIDA');
  }
  const { data, info: { width, height, channels } } = raw;
  const rgba = Buffer.alloc(width * height * 4);
  let tinta = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const a = lum >= CLARO ? 0 : lum <= OSCURO ? 255 : Math.round((255 * (CLARO - lum)) / (CLARO - OSCURO));
    const j = p * 4;
    rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = a;
    if (a > 64) {
      tinta++;
      const x = p % width, y = (p - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (tinta < MIN_PIXELES_TINTA) {
    throw new AppError('En la imagen no se ve ninguna firma: sube una foto o un escaneo del trazo.', 400, 'FIRMA_VACIA');
  }
  const left = Math.max(0, x0 - MARGEN), top = Math.max(0, y0 - MARGEN);
  const recorte = { left, top, width: Math.min(width, x1 + MARGEN + 1) - left, height: Math.min(height, y1 + MARGEN + 1) - top };
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract(recorte)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** El correo con el que se busca al alumno en el CRM: el revisado a mano, o el de Certifex. */
export const correoDe = (c) => String(c?.edicion?.emailCrm || c?.emailCrm || c?.titular?.email || c?.email || '').trim().toLowerCase();

async function proyectosPorCentro(centros) {
  const m = new Map();
  for (const centro of new Set(centros.filter(Boolean))) {
    try {
      m.set(centro, (await proyectoDeCentro(centro)).proyecto?.id ?? null);
    } catch (e) {
      logger.warn({ err: e.message, centro }, 'Certifex: no se pudo resolver el proyecto del campus para la firma');
      m.set(centro, null);
    }
  }
  return m;
}

/**
 * De dónde saldría la firma de cada candidato `{ matriculaId, centro, email }`:
 * Map matriculaId → `{ origen: 'subida', key, por, en }` | `{ origen: 'admision', key,
 * matriculaCrm }`. Las que no tienen, no salen. Lanza si la base no contesta.
 */
export async function origenesDeFirma(candidatos) {
  const ids = candidatos.map((c) => c.matriculaId);
  const subidas = await model.firmasSubidasDe(ids);
  const proyectos = await proyectosPorCentro(candidatos.map((c) => c.centro));
  const buscar = candidatos
    .filter((c) => !subidas.has(c.matriculaId))
    .map((c) => ({ matriculaId: c.matriculaId, projectId: proyectos.get(c.centro) ?? null, email: correoDe(c) }))
    .filter((c) => c.projectId && c.email);
  const deAdmision = await model.firmasDeAdmision(buscar);
  const out = new Map();
  for (const [id, s] of subidas) out.set(id, { origen: 'subida', key: s.key, por: s.por, en: s.en });
  for (const [id, a] of deAdmision) out.set(id, { origen: 'admision', key: a.key, matriculaCrm: a.matriculaCrm });
  return out;
}

/**
 * `c.firma` en cada fila sin diploma: `{ origen, por?, en?, matriculaCrm? }` o null (sin
 * firma: el panel pide subirla). Si la base no contesta, el listado sale igual, sin firma
 * marcada (`firma` undefined, que el panel no confunde con «no tiene»).
 */
export async function conFirma(filas) {
  const sinTitulo = filas.filter((c) => !c.nexpediente);
  if (!sinTitulo.length) return;
  try {
    const m = await origenesDeFirma(sinTitulo.map((c) => ({ matriculaId: c.matriculaId, centro: c.centro, email: correoDe(c), edicion: c.edicion })));
    for (const c of sinTitulo) {
      const o = m.get(c.matriculaId);
      c.firma = o ? { origen: o.origen, por: o.por ?? null, en: o.en ?? null, matriculaCrm: o.matriculaCrm ?? null } : null;
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo mirar la firma del alumno');
  }
}

/** Los bytes (PNG transparente) de una firma según su origen. Lanza si no se puede leer. */
export async function pngDe(origen) {
  const { buffer } = await getLocal(origen.key);
  // La subida ya se guardó procesada; la de admisión llega como la subieron.
  return origen.origen === 'subida' ? buffer : firmaTransparente(buffer);
}

/**
 * Para emitir: Map matriculaId → `data:image/png;base64,…` de las que tienen firma. Una
 * firma que no se puede leer (borrada del disco, un PDF en la matrícula…) no para la
 * emisión: sale sin firma y queda en el registro. Lanza solo si la base no contesta.
 */
export async function firmasParaEmitir(candidatos) {
  const origenes = await origenesDeFirma(candidatos);
  const out = new Map();
  for (const [id, o] of origenes) {
    try {
      out.set(id, `data:image/png;base64,${(await pngDe(o)).toString('base64')}`);
    } catch (e) {
      logger.warn({ err: e.message, matriculaId: id, origen: o.origen }, 'Certifex: la firma del alumno no se pudo leer; se emite sin ella');
    }
  }
  return out;
}

/** Guarda una firma subida a mano (ya procesada) y borra la anterior subida, si había. */
export async function guardarFirmaSubida(matriculaId, centro, png, por, base) {
  const key = `certifex/firmas/${String(centro || 'campus').toLowerCase()}/m-${matriculaId}-${randomBytes(4).toString('hex')}.png`;
  await saveLocal(key, png);
  const anterior = await model.guardarFirma(matriculaId, key, por, base);
  if (anterior && anterior !== key) {
    await deleteLocal(anterior).catch((e) => logger.warn({ err: e.message, key: anterior }, 'Certifex: no se pudo borrar la firma anterior'));
  }
  return key;
}
