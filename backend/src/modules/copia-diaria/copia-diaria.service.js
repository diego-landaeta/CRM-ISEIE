import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import * as model from './copia-diaria.model.js';
import { leerConfig, queFalta } from './copia-diaria.config.js';
import { volcarCifrado } from './copia-diaria.volcado.js';
import { urlDeDescarga, ficheroValido } from './copia-diaria.enlace.js';
import { correoDeLaCopia, asuntoDeLaCopia, megas } from './copia-diaria.correo.js';

/**
 * La copia diaria de la base: volcarla, cifrarla, mandarla y guardar las últimas.
 *
 * Cada día deja dos ficheros en la carpeta: el zip cifrado y un .json con lo que
 * se sabe de él (tamaño, huella, si ya salió el correo). El .json es lo que hace
 * que la vuelta se pueda repetir sin repetir nada:
 *
 *   · sin zip de hoy           → se vuelca, se cifra y se manda;
 *   · zip sin correo enviado   → solo se manda (falló Brevo, no hay que volcar otra vez);
 *   · zip con correo enviado   → nada.
 *
 * Así un reinicio a las 03:40 no hace dos copias ni manda dos correos, y no
 * hace falta ninguna tabla nueva.
 */

/** Cuántas veces se intenta en el día antes de dejarlo para mañana. */
export const MAX_INTENTOS = 3;
/** Desde la hora y durante este rato: si el servidor estaba parado a las 03:30, sale al volver. */
export const VENTANA_MIN = 6 * 60;

const intentos = new Map();
const faltaDicha = new Set();

/** El día (AAAA-MM-DD) y el minuto del día en la zona. */
export function relojEn(ahora = new Date(), zona = 'Europe/Madrid') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, minuto: Number(p.hour) * 60 + Number(p.minute) };
}

/** ¿Toca ahora? Desde la hora y durante VENTANA_MIN, sin pasar de medianoche. */
export function enVentana(ahora, cfg) {
  const { minuto } = relojEn(ahora, cfg.zona);
  return minuto >= cfg.minuto && minuto < Math.min(cfg.minuto + VENTANA_MIN, 24 * 60);
}

const seguro = (s) => String(s || 'crm').replace(/[^A-Za-z0-9_.-]/g, '_');

export function nombresDelDia(base, dia) {
  const raiz = `${seguro(base)}-${dia}`;
  return { fichero: `${raiz}.zip`, dentro: `${raiz}.sql`, estado: `${raiz}.json` };
}

/** La carpeta, solo para el usuario de la app (700). */
export async function prepararCarpeta(carpeta) {
  await fs.promises.mkdir(carpeta, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(carpeta, 0o700);
}

async function leerEstado(carpeta, nombre) {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(carpeta, nombre), 'utf8'));
  } catch {
    return null;
  }
}

async function guardarEstado(carpeta, nombre, estado) {
  const ruta = path.join(carpeta, nombre);
  await fs.promises.writeFile(`${ruta}.tmp`, JSON.stringify(estado, null, 2), { mode: 0o600 });
  await fs.promises.rename(`${ruta}.tmp`, ruta);
}

const existe = (ruta) => fs.promises.access(ruta).then(() => true, () => false);

/**
 * Deja las `guardar` últimas copias de esta base y borra las demás (con su .json).
 * También los restos de un volcado que se cortó (.part) de hace más de un día.
 */
export async function aplicarRetencion({ carpeta, base, guardar }, ahora = Date.now()) {
  let nombres;
  try { nombres = await fs.promises.readdir(carpeta); } catch { return { borradas: [] }; }
  const patron = new RegExp(`^${seguro(base).replace(/[.]/g, '\\.')}-(\\d{4}-\\d{2}-\\d{2})\\.zip$`);
  const copias = nombres.filter((n) => patron.test(n)).sort().reverse();
  const borradas = [];
  for (const viejo of copias.slice(guardar)) {
    await fs.promises.rm(path.join(carpeta, viejo), { force: true });
    await fs.promises.rm(path.join(carpeta, viejo.replace(/\.zip$/, '.json')), { force: true });
    borradas.push(viejo);
  }
  for (const n of nombres.filter((x) => x.endsWith('.part') || x.endsWith('.json.tmp'))) {
    const ruta = path.join(carpeta, n);
    const { mtimeMs } = await fs.promises.stat(ruta).catch(() => ({ mtimeMs: ahora }));
    if (ahora - mtimeMs > 24 * 3600 * 1000) await fs.promises.rm(ruta, { force: true });
  }
  return { borradas };
}

/** La ruta del fichero para el enlace de descarga, o null si no vale o no está. */
export async function rutaParaDescargar(fichero, cfg = leerConfig()) {
  if (!ficheroValido(fichero) || path.basename(fichero) !== fichero) return null;
  if (!fichero.startsWith(`${seguro(cfg.base)}-`)) return null;
  const ruta = path.join(cfg.carpeta, fichero);
  if (path.dirname(ruta) !== cfg.carpeta) return null;
  return (await existe(ruta)) ? ruta : null;
}

/** Un aviso al superadmin por día, en la campanita, como los demás trabajos. */
async function avisarDelFallo(dia, motivo) {
  try {
    if (await model.yaAvisadoDelFallo(dia)) return;
    const para = await model.superAdminsActivos();
    if (!para.length) return;
    await notifyUsers({
      targetUserIds: para,
      type: model.TIPO_FALLO,
      title: 'La copia diaria de la base ha fallado',
      message: `${String(motivo).slice(0, 400)}. Se reintenta en la siguiente vuelta (hasta ${MAX_INTENTOS} veces al día); el detalle está en el registro del servidor.`,
      link_path: null,
      metadata: { dia },
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Copia diaria: no se pudo avisar del fallo');
  }
}

async function mandar({ cfg, dia, nombres, datos, ruta }) {
  const adjunta = datos.bytes <= cfg.maxAdjuntoBytes;
  const enlace = adjunta ? null : urlDeDescarga(cfg.apiPublica, nombres.fichero, { horas: cfg.enlaceHoras });
  const { htmlContent, textContent } = correoDeLaCopia({
    dia, base: cfg.base, fichero: nombres.fichero, dentro: nombres.dentro,
    bytes: datos.bytes, bytesSql: datos.bytesSql, tablas: datos.tablas, filas: datos.filas,
    sha256: datos.sha256, guardadas: cfg.guardar, zona: cfg.zona, enlace,
    maxAdjuntoBytes: cfg.maxAdjuntoBytes,
  });
  const r = await sendEmail({
    to: cfg.para.map((email) => ({ email })),
    subject: asuntoDeLaCopia(dia),
    htmlContent,
    textContent,
    tags: ['copia-diaria'],
    // Un correo por base y día: si ya salió, no se repite aunque se pierda el .json.
    clave: `copia-diaria:${cfg.base}:${dia}`,
    cuenta: 'crm',
    attachment: adjunta
      ? [{ name: nombres.fichero, content: (await fs.promises.readFile(ruta)).toString('base64') }]
      : undefined,
  });
  if (!r?.sent && !r?.repetido) {
    throw new Error(`el correo no salió (${r?.reason || 'sin motivo'}${r?.detalle ? `: ${r.detalle}` : ''})`);
  }
  return { via: adjunta ? 'adjunto' : 'enlace', repetido: Boolean(r?.repetido) };
}

/**
 * La copia de hoy, si no está hecha. Lanza si falla (el latido lo apunta como
 * fallo) después de avisar al superadmin.
 */
export async function hacerCopiaDelDia({ ahora = new Date(), cfg = leerConfig() } = {}) {
  const { dia } = relojEn(ahora, cfg.zona);
  const falta = queFalta(cfg);
  if (falta) {
    // Una vez al día en el registro, no en cada vuelta.
    if (!faltaDicha.has(`${dia}:${falta}`)) {
      faltaDicha.add(`${dia}:${falta}`);
      logger.error(`Copia diaria: ${falta}`);
    }
    return { omitido: falta };
  }

  const nombres = nombresDelDia(cfg.base, dia);
  if ((await leerEstado(cfg.carpeta, nombres.estado))?.enviado) return { omitido: 'ya hecha', dia };
  if ((intentos.get(dia) || 0) >= MAX_INTENTOS) return { omitido: 'sin más intentos hoy', dia };

  const soltar = await model.tomarCerrojo();
  if (!soltar) return { omitido: 'la está haciendo otro proceso', dia };

  try {
    // Otra vez, ya con el cerrojo: el otro proceso pudo acabarla mientras.
    let estado = await leerEstado(cfg.carpeta, nombres.estado);
    if (estado?.enviado) return { omitido: 'ya hecha', dia };
    intentos.set(dia, (intentos.get(dia) || 0) + 1);

    await prepararCarpeta(cfg.carpeta);
    const ruta = path.join(cfg.carpeta, nombres.fichero);

    if (!estado || !(await existe(ruta))) {
      const inicio = Date.now();
      const stats = await model.estadisticas();
      const volcado = await volcarCifrado({
        destino: ruta, nombreDentro: nombres.dentro, clave: cfg.clave,
        conexion: cfg.conexion, pgDump: cfg.pgDump,
      });
      estado = {
        dia, base: cfg.base, fichero: nombres.fichero, ...stats, ...volcado,
        hecha: new Date().toISOString(), segundos: Math.round((Date.now() - inicio) / 1000),
        enviado: false,
      };
      await guardarEstado(cfg.carpeta, nombres.estado, estado);
      logger.info({ dia, bytes: volcado.bytes, segundos: estado.segundos }, `Copia diaria: hecha (${megas(volcado.bytes)})`);
    }

    const envio = await mandar({ cfg, dia, nombres, datos: estado, ruta });
    estado = { ...estado, enviado: true, via: envio.via, enviadoEn: new Date().toISOString() };
    await guardarEstado(cfg.carpeta, nombres.estado, estado);
    const { borradas } = await aplicarRetencion(cfg);
    logger.info({ dia, via: envio.via, para: cfg.para.length, borradas: borradas.length }, 'Copia diaria: enviada');
    return { dia, bytes: estado.bytes, tablas: estado.tablas, via: envio.via, borradas: borradas.length };
  } catch (err) {
    logger.error({ err: err.message, dia }, 'Copia diaria: falló');
    await avisarDelFallo(dia, err.message);
    throw err;
  } finally {
    await soltar();
  }
}

/** Para las pruebas. */
export const _internos = { intentos, faltaDicha };
