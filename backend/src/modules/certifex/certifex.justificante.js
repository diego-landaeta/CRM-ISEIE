import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { cabeceraDe } from '../feedback/cabecera.js';
import { certifex } from './certifex.cliente.js';
import { alcanceDe, exigirCentro } from './certifex.alcance.js';
import { proyectoDeCentro } from './certifex.programa.js';

/**
 * JUSTIFICANTE DEL ENVÍO DEL DIPLOMA (Diego, 05/11/2026).
 *
 * «Necesito poder demostrar que el correo con el diploma salió»: cuándo, a qué dirección,
 * con qué asunto y con la prueba de Brevo. El correo lo manda Certifex cuando alguien del
 * CRM pulsa «Enviar»; desde su migración 0042 cada envío guarda además el destinatario,
 * el asunto y el `messageId` que devuelve Brevo, y los da en `GET /api/crm/v1/envios`.
 *
 *  · GET /api/certifex/diplomas/:nexp/envios         → la sección «Envíos» de la ficha
 *  · GET /api/certifex/diplomas/:nexp/justificante   → el PDF de una página, con la marca
 *    del campus (?envio=ID para uno concreto; si no, el último del diploma)
 *
 * Lo ve quien ve Diplomas (`diplomas.view`, o quien emite), y solo de sus campus: lo de
 * otro campus se contesta como si no existiera (404), igual que el PDF del diploma.
 *
 * El PDF no se guarda en el CRM: se rehace cada vez con lo que Certifex tiene registrado,
 * que es de solo añadir (nadie puede reescribir un envío). Si el envío es de antes de la
 * 0042, el justificante dice lo que hay —fecha, resultado y quién lo aprobó— y que el
 * resto no se guardaba entonces. No se inventa nada.
 *
 * Con pdf-lib, como las facturas y las novedades: en el servidor de MultiCRM el Chrome de
 * puppeteer no arranca.
 */

/** Forma de un número de expediente de Certifex (la misma que en certifex.emisiones.js). */
const NEXP = /^[A-Z]{2,6}-\d{4}-\d{6}-[A-Z0-9]{4}$/;
const NO_ENCONTRADO = 'Diploma no encontrado (o no es de tus campus).';

function expedienteDe(req) {
  const nexp = String(req.params.nexp || '').trim().toUpperCase();
  if (!NEXP.test(nexp)) throw new AppError('Numero de expediente no valido', 400, 'VALIDATION_ERROR');
  return nexp;
}

/**
 * Los envíos de un diploma, de Certifex, solo si su campus es de quien pregunta.
 * `estado`: además, el estado de cada correo en Brevo (entregado, abierto…).
 */
async function enviosDe(user, nexp, { estado = false } = {}) {
  const qs = new URLSearchParams({ nexpediente: nexp });
  if (estado) qs.set('estado', '1');
  let d;
  try {
    d = await certifex('GET', `/envios?${qs}`, undefined, { timeoutMs: estado ? 30_000 : 20_000 });
  } catch (e) {
    // Un Certifex sin la 0042 contesta 404 a la ruta entera: se dice tal cual.
    if (e?.statusCode === 404 && /No encontrado\.?$/.test(e.message)) {
      throw new AppError('Certifex todavía no guarda los envíos (le falta la actualización del justificante).', 501, 'CERTIFEX_SIN_ENVIOS');
    }
    if (e?.statusCode === 404) throw new AppError(NO_ENCONTRADO, 404, 'NOT_FOUND');
    throw e;
  }
  const centro = d?.credencial?.centro;
  if (!centro) throw new AppError(NO_ENCONTRADO, 404, 'NOT_FOUND');
  exigirCentro(await alcanceDe(user), centro, NO_ENCONTRADO);
  return { credencial: d.credencial, envios: Array.isArray(d.envios) ? d.envios : [] };
}

/** GET /api/certifex/diplomas/:nexp/envios */
export async function envios(req, res, next) {
  try {
    const data = await enviosDe(req.user, expedienteDe(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── fechas y textos

const partes = (iso, timeZone) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return p;
};

/** «05/11/2026 14:03:12» en esa zona horaria. */
export function fechaHora(iso, timeZone = 'Europe/Madrid', { segundos = true } = {}) {
  const p = partes(iso, timeZone);
  if (!p) return '';
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}${segundos ? `:${p.second}` : ''}`;
}

const POR_QUE_NO = {
  correo_apagado: 'el envío de correo estaba apagado en Certifex',
  sin_correo: 'el alumno no tenía correo en Certifex',
  error: 'Brevo devolvió un error al enviarlo',
};

/** «Enviado» o «No ha salido: motivo». */
export function resultadoEnTexto(resultado) {
  if (resultado === 'enviado') return 'Enviado';
  return `No ha salido: ${POR_QUE_NO[resultado] || `resultado «${resultado}»`}`;
}

const EVENTOS_BREVO = {
  requests: 'Aceptado por Brevo',
  delivered: 'Entregado al servidor del destinatario',
  opened: 'Abierto',
  uniqueOpened: 'Abierto',
  loadedByProxy: 'Abierto (cargado por el proxy del correo)',
  clicks: 'Clic en un enlace',
  softBounces: 'Rebote temporal',
  hardBounces: 'Rebote definitivo',
  bounces: 'Rebote',
  deferred: 'Aplazado',
  blocked: 'Bloqueado',
  spam: 'Marcado como spam',
  invalid: 'Dirección no válida',
  error: 'Error',
  unsubscribed: 'Baja',
};
export const eventoEnTexto = (e) => EVENTOS_BREVO[e] || e;

/**
 * Lo que dice el justificante, en filas de «etiqueta: valor», sin maquetar. Aparte del
 * PDF para poder probarlo sin leer un PDF.
 */
export function contenidoJustificante({ credencial, envio, generadoPor, ahora = new Date() }) {
  const filas = [
    ['Alumno', credencial.alumno || '—'],
    ['Formación', credencial.titulacion || '—'],
    ['Nº de expediente', credencial.nexpediente],
    ['Correo', envio.tipo === 'rechazo' ? 'Aviso de corrección de la solicitud' : 'Aviso de diploma disponible'],
    ['Resultado', resultadoEnTexto(envio.resultado)],
    ['Fecha y hora del envío', `${fechaHora(envio.en, 'Europe/Madrid')} (hora de Madrid)`],
    ['', `${fechaHora(envio.en, 'UTC')} (UTC)`],
  ];
  const notas = [];
  if (envio.sinDetalle) {
    filas.push(['Destinatario', 'No consta']);
    filas.push(['Asunto', 'No consta']);
    filas.push(['Identificador de Brevo', 'No consta']);
    notas.push('Este envío es anterior a que Certifex guardara el destinatario, el asunto y el identificador de Brevo de cada correo (noviembre de 2026). Lo que consta de él es la fecha y hora, el resultado y quién lo aprobó.');
  } else {
    filas.push(['Destinatario', envio.destinatario || (envio.resultado === 'sin_correo' ? 'Sin dirección de correo' : 'No consta')]);
    filas.push(['Asunto', envio.asunto || 'No consta']);
    filas.push(['Identificador de Brevo', envio.messageId || (envio.resultado === 'enviado' ? 'Brevo no lo devolvió' : 'No aplica: el correo no salió')]);
  }
  filas.push(['Aprobado por', envio.aprobadoPor || '—']);

  const brevo = [];
  if (envio.brevo?.ok && envio.brevo.eventos?.length) {
    for (const e of envio.brevo.eventos.slice(0, 8)) {
      brevo.push(`${eventoEnTexto(e.evento)}: ${fechaHora(e.fecha, 'Europe/Madrid')} (hora de Madrid)${e.motivo ? ` · ${e.motivo}` : ''}`);
    }
  } else if (envio.brevo?.ok) {
    brevo.push('Brevo no conserva ya eventos de este correo (los guarda un tiempo limitado). La prueba del envío es su identificador.');
  } else if (envio.brevo && !envio.brevo.ok) {
    brevo.push(`No se pudo consultar a Brevo al generar el justificante: ${envio.brevo.motivo || 'sin respuesta'}.`);
  }

  const pie = `Generado el ${fechaHora(ahora.toISOString(), 'Europe/Madrid', { segundos: false })} (hora de Madrid) desde el CRM${generadoPor ? ` por ${generadoPor}` : ''}. Datos del registro de envíos de Certifex, que no se pueden modificar.`;
  return { titulo: 'Justificante de envío del diploma', filas, brevo, notas, pie };
}

// ─────────────────────────────────────────────── el PDF

const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 52;
const UTIL = ANCHO - MARGEN * 2;

function color(hex) {
  const v = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#1f4e79';
  const n = parseInt(v.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** La marca del campus: nombre, color y la cabecera (logo sobre su fondo) si se puede. */
async function marcaDelCampus(centro) {
  try {
    const { proyecto } = await proyectoDeCentro(centro);
    if (!proyecto) return { nombre: centro, color: null, cabecera: null };
    const { rows } = await query('SELECT nombre, theme_color, logo_url FROM projects WHERE id = $1', [proyecto.id]);
    // La cabecera de los correos (el logo sobre el fondo de la marca). Sin logo sería una
    // banda lisa sin nombre: entonces mejor la banda con el nombre del campus, más abajo.
    let cabecera = null;
    if (rows[0]?.logo_url) {
      try { cabecera = await cabeceraDe(proyecto.id); } catch (e) { logger.warn({ err: e.message, centro }, 'justificante: sin cabecera de marca'); }
    }
    return { nombre: rows[0]?.nombre || proyecto.nombre || centro, color: rows[0]?.theme_color || null, cabecera };
  } catch (e) {
    logger.warn({ err: e.message, centro }, 'justificante: no se pudo leer la marca del campus');
    return { nombre: centro, color: null, cabecera: null };
  }
}

export async function pdfJustificante(c, marca) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${c.titulo} · ${c.filas.find((f) => f[0] === 'Nº de expediente')?.[1] || ''}`);
  doc.setAuthor(marca.nombre);
  doc.setCreator('CRM');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const acento = color(marca.color);
  const tinta = rgb(0.11, 0.15, 0.19);
  const gris = rgb(0.36, 0.40, 0.45);
  const blanco = rgb(1, 1, 1);

  // Helvetica solo escribe Windows-1252: lo que no sepa escribir se quita, no revienta.
  const seguro = (fuente, texto) => [...String(texto ?? '')].map((ch) => { try { fuente.encodeText(ch); return ch; } catch { return ''; } }).join('');
  const lineasDe = (texto, fuente, tam, ancho) => {
    const lineas = [];
    for (const parrafo of seguro(fuente, texto).split('\n')) {
      let actual = '';
      for (const p of parrafo.split(/\s+/).filter(Boolean)) {
        const prueba = actual ? `${actual} ${p}` : p;
        if (fuente.widthOfTextAtSize(prueba, tam) <= ancho || !actual) actual = prueba;
        else { lineas.push(actual); actual = p; }
      }
      // Una palabra sin espacios más ancha que la columna (un identificador largo) se parte.
      while (actual && fuente.widthOfTextAtSize(actual, tam) > ancho) {
        let i = actual.length;
        while (i > 1 && fuente.widthOfTextAtSize(actual.slice(0, i), tam) > ancho) i -= 1;
        lineas.push(actual.slice(0, i));
        actual = actual.slice(i);
      }
      if (actual) lineas.push(actual);
    }
    return lineas;
  };

  const pagina = doc.addPage([ANCHO, ALTO]);
  let y = ALTO;

  // ── Cabecera con la marca del campus ──
  let conImagen = false;
  if (marca.cabecera) {
    try {
      const img = await doc.embedPng(marca.cabecera);
      const alto = (ANCHO * img.height) / img.width;
      pagina.drawImage(img, { x: 0, y: ALTO - alto, width: ANCHO, height: alto });
      y = ALTO - alto;
      conImagen = true;
    } catch (e) {
      logger.warn({ err: e.message }, 'justificante: la cabecera no se pudo pegar');
    }
  }
  if (!conImagen) {
    const alto = 84;
    pagina.drawRectangle({ x: 0, y: ALTO - alto, width: ANCHO, height: alto, color: acento });
    pagina.drawText(seguro(negrita, marca.nombre), { x: MARGEN, y: ALTO - 52, size: 20, font: negrita, color: blanco });
    y = ALTO - alto;
  }

  y -= 40;
  pagina.drawText(seguro(negrita, c.titulo), { x: MARGEN, y, size: 18, font: negrita, color: tinta });
  y -= 18;
  pagina.drawText(seguro(normal, marca.nombre), { x: MARGEN, y, size: 10.5, font: normal, color: gris });
  y -= 14;
  pagina.drawLine({ start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y }, thickness: 1, color: acento });
  y -= 22;

  // ── Los datos, en dos columnas ──
  const COL = 150;
  const valorAncho = UTIL - COL;
  for (const [etiqueta, valor] of c.filas) {
    const fuenteValor = etiqueta === 'Identificador de Brevo' && !/^No /.test(valor) && !/^Brevo/.test(valor) ? mono : normal;
    const tam = fuenteValor === mono ? 9.5 : 10.5;
    const lineas = lineasDe(valor, fuenteValor, tam, valorAncho);
    if (etiqueta) pagina.drawText(seguro(negrita, etiqueta), { x: MARGEN, y, size: 10.5, font: negrita, color: tinta });
    for (const [i, l] of lineas.entries()) {
      pagina.drawText(l, { x: MARGEN + COL, y: y - i * 14, size: tam, font: fuenteValor, color: tinta });
    }
    y -= Math.max(1, lineas.length) * 14 + 6;
  }

  const bloque = (titulo, textos, { tam = 9.5, tinte = tinta } = {}) => {
    if (!textos.length) return;
    y -= 8;
    pagina.drawText(seguro(negrita, titulo), { x: MARGEN, y, size: 11, font: negrita, color: acento });
    y -= 16;
    for (const t of textos) {
      for (const l of lineasDe(t, normal, tam, UTIL)) {
        if (y < 90) return;
        pagina.drawText(l, { x: MARGEN, y, size: tam, font: normal, color: tinte });
        y -= tam * 1.4;
      }
      y -= 3;
    }
  };
  bloque('Estado en Brevo', c.brevo);
  bloque('Nota', c.notas, { tinte: gris });

  // ── Pie ──
  pagina.drawLine({ start: { x: MARGEN, y: 70 }, end: { x: ANCHO - MARGEN, y: 70 }, thickness: 0.5, color: gris });
  lineasDe(c.pie, normal, 8.5, UTIL).slice(0, 3).forEach((l, i) => {
    pagina.drawText(l, { x: MARGEN, y: 56 - i * 11, size: 8.5, font: normal, color: gris });
  });

  return Buffer.from(await doc.save());
}

/** GET /api/certifex/diplomas/:nexp/justificante[?envio=ID] */
export async function justificante(req, res, next) {
  try {
    const nexp = expedienteDe(req);
    let id = null;
    if (req.query.envio != null && req.query.envio !== '') {
      id = Number(req.query.envio);
      if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Envio no valido', 400, 'VALIDATION_ERROR');
    }
    const { credencial, envios: lista } = await enviosDe(req.user, nexp, { estado: true });
    // Sin elegir: el último correo del DIPLOMA (no el aviso de rechazo de la solicitud).
    const envio = id != null ? lista.find((e) => Number(e.id) === id) : (lista.find((e) => e.tipo === 'credencial') || lista[0]);
    if (!envio) {
      throw new AppError(id != null ? 'Ese envío no es de este diploma.' : 'Este diploma no tiene ningún envío registrado.', 404, 'NOT_FOUND');
    }
    const contenido = contenidoJustificante({ credencial, envio, generadoPor: req.user?.email || null });
    const pdf = await pdfJustificante(contenido, await marcaDelCampus(credencial.centro));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="justificante-envio-${nexp}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err) { next(err); }
}
