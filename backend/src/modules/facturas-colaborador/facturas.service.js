import crypto from 'node:crypto';
import pool, { getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
// R2 si está configurado; si no, el disco del servidor (revisión del 10/10: sin R2 la subida daba 500).
import { guardar as guardarArchivo, leer as leerArchivo, urlDeDescarga } from './almacen.js';
import * as model from './facturas.model.js';
import { anotar } from './facturas-colaborador.model.js';
import { ambitoDe } from './facturas-colaborador.service.js';
import { logger } from '../../shared/utils/logger.js';
import { correosActivos, empresaCorta, enviarCorreoDelMes, enviarAcuse, enviarAvisoDePago, urlDelEnlace, conceptoSugerido } from './facturas.emails.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { enUtf8 } from '../whatsapp/media.service.js';
import { calcularDesglose } from './desglose.js';
import { leerImporteDelPdf, cuadraConElPdf } from './importePdf.js';

/*
  Facturas de colaboradores (#202) · el mes, el enlace y la subida.

  El enlace (Definición acordada, 01/10):
    - token aleatorio de 32 bytes; en la base solo su sha256, como los del MCP;
    - vale para un colaborador, una empresa y un mes, y no abre nada más;
    - caduca a los 60 días, y en cuanto se sube la factura ya no admite otra;
    - administración puede mandar uno nuevo (el viejo deja de valer).
*/

export const DIAS_DE_ENLACE = 60;
export const TOPE_BYTES = 10 * 1024 * 1024;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «2026-09-01» → «septiembre de 2026». */
export function nombreDelMes(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

export const huella = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * El enlace de una semilla: 32 bytes, firmados con la clave del servidor. Como
 * las firmas de los documentos de matrícula (`firmaDeDocumento.js`), se lee la
 * clave en cada llamada.
 */
export function enlaceDeLaSemilla(semilla) {
  const clave = process.env.JWT_SECRET;
  if (!clave) throw new Error('Falta JWT_SECRET: no se pueden hacer los enlaces de las facturas');
  return crypto.createHmac('sha256', clave).update(`facturas-colaborador:${semilla}`).digest('base64url');
}

/**
 * Un enlace nuevo. En la base quedan la semilla (al azar) y la huella del
 * enlace; el enlace en sí, no. Así se cumplen las dos cosas de la definición:
 * «solo se guarda su sha256» y el recordatorio «con el mismo enlace».
 */
function tokenNuevo() {
  const semilla = crypto.randomBytes(32).toString('hex');
  const token = enlaceDeLaSemilla(semilla);
  return { token, hash: huella(token), semilla };
}

const caducidad = (ahora = Date.now()) => new Date(ahora + DIAS_DE_ENLACE * 24 * 3600 * 1000);

async function enTransaccion(fn) {
  const db = await getClient();
  let roto = false;
  try {
    await db.query('BEGIN');
    const r = await fn(db);
    await db.query('COMMIT');
    return r;
  } catch (err) {
    // Si el ROLLBACK también falla, el error que cuenta es el primero, y esa
    // conexión no vuelve al pool (`release(true)` la cierra).
    await db.query('ROLLBACK').catch(() => { roto = true; });
    throw err;
  } finally {
    db.release(roto);
  }
}

/**
 * Prepara el mes: una fila y un enlace por cada colaborador activo y empresa.
 * Devuelve los enlaces EN CLARO solo aquí, en memoria, para quien los vaya a
 * mandar por correo: en la base no quedan.
 */
export async function prepararMes(periodo) {
  const pendientes = await model.pendientesDePreparar(periodo);
  const preparados = [];
  for (const p of pendientes) {
    const { token, hash, semilla } = tokenNuevo();
    // Una por una, fuera de una transacción común: si una falla, las demás siguen.
    const id = await model.crearDelMes(pool, {
      colaboradorId: p.colaborador_id,
      issuerId: p.issuer_id,
      periodo,
      importeEsperado: p.importe_acordado,
      tokenHash: hash,
      semilla,
      caducaAt: caducidad(),
    });
    if (id) preparados.push({ facturaId: id, colaboradorId: p.colaborador_id, issuerId: p.issuer_id, token });
  }
  return preparados;
}

/**
 * Lo que `sendEmail` devuelve sin enviar y no es un fallo: el freno de los
 * entornos de pruebas y la clave de idempotencia (ya salió antes).
 */
const NO_ES_FALLO = new Set(['FRENO_DE_PRUEBAS', 'YA_ENVIADO']);

/**
 * Manda el enlace de una fila por correo y lo apunta: `enviado` (o
 * `recordatorio`) si Brevo lo acepta, `no_enviado` si falla. Con los correos
 * apagados solo queda en el log (lo hace `despachar`) y la fila sigue «sin enviar».
 */
export async function mandarEnlace(facturaId, token, { recordatorio = false, nuevo = false, clave }) {
  const f = await model.porId(facturaId, null);
  if (!f) return { sent: false };
  try {
    const marca = await model.marcaDeLaEmpresa(f.issuer_id);
    const r = await enviarCorreoDelMes({ f, token, recordatorio, nuevo, clave, marca });
    if (r?.sent) {
      await model.marcarEnviado(facturaId);
      await anotar(pool, {
        facturaId, evento: recordatorio ? 'recordatorio' : 'enviado', detalle: { para: f.colaborador_email },
      });
    } else if (r && !r.simulated && !NO_ES_FALLO.has(r.reason)) {
      // `sendEmail` no lanza: si Brevo no lo acepta, lo dice con {sent:false}.
      await anotar(pool, {
        facturaId, evento: 'no_enviado', detalle: { motivo: r.reason || r.error || 'desconocido', recordatorio },
      });
    }
    return r;
  } catch (err) {
    logger.error({ err: err.message, facturaId }, 'No se pudo mandar el enlace de la factura de colaborador');
    await anotar(pool, { facturaId, evento: 'no_enviado', detalle: { motivo: err.message, recordatorio } });
    return { sent: false, error: err.message };
  }
}

/**
 * El aviso en la campana a administración. Si falla, la factura ya está
 * guardada: se apunta en el log y el colaborador no ve un error (si lo viera,
 * al reintentar le diría «Ya subiste…»).
 */
async function avisarDeLaFactura(f) {
  try {
    await avisar(f);
  } catch (err) {
    logger.error({ err: err.message, facturaId: f.id }, 'No se pudo avisar en la campana de la factura de colaborador');
  }
}

async function avisar(f) {
  const importe = f.importe === null ? '' : ` · ${Number(f.importe).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`;
  // Sin nadie a quien avisar, nada: una lista vacía podría entenderse como «para todos».
  const destinatarios = await model.avisarA(f.issuer_id);
  if (!destinatarios?.length) return;
  await notifyUsers({
    targetUserIds: destinatarios,
    type: 'factura_colaborador',
    title: `Factura recibida: ${f.colaborador_nombre}`,
    message: `${nombreDelMes(f.periodo)} · ${f.razon_social}${importe} · ${f.numero_recepcion}`,
    // En ISEIE Finanzas vive en /accounting (en MultiCRM, /finanzas).
    link_path: `/accounting/facturas-colaboradores?periodo=${f.periodo.slice(0, 7)}`,
    metadata: { factura_id: f.id, issuer_id: f.issuer_id },
  });
}

/** El acuse con la copia. Si falla, la factura ya está guardada: solo se apunta en el log. */
/**
 * El acuse al colaborador y la campana, DESPUÉS de responder (revisión del 10/10):
 * con un adjunto de 10 MB, Brevo puede tardar; dentro de la petición el colaborador
 * esperaba o le cortaba nginx con la factura ya guardada, y al reintentar le salía
 * «Ya subiste la factura». Cada uno se protege solo: un fallo no afecta al otro.
 */
function despuesDeResponder(subida, nombre, buffer) {
  setImmediate(() => {
    mandarAcuse(subida, { nombre, buffer }).catch((err) => logger.error({ err: err.message, facturaId: subida?.id }, 'Factura de colaborador: fallo el acuse'));
    avisarDeLaFactura(subida).catch((err) => logger.error({ err: err.message, facturaId: subida?.id }, 'Factura de colaborador: fallo el aviso'));
  });
}

async function mandarAcuse(f, archivo) {
  try {
    const r = await enviarAcuse({ f, archivo, marca: await model.marcaDeLaEmpresa(f.issuer_id) });
    if (r?.sent) await anotar(pool, { facturaId: f.id, evento: 'acuse', detalle: { para: f.colaborador_email } });
  } catch (err) {
    logger.error({ err: err.message, facturaId: f.id }, 'No se pudo mandar el acuse de la factura de colaborador');
  }
}

/* ─────────────────────────── el enlace (sin usuario) ─────────────────────────── */

const ENLACE_NO_VALE = () => new AppError('Este enlace no existe o ya no es válido', 404, 'NOT_FOUND');

/** Lo que ve el colaborador: nada de huellas, claves de archivo ni correos. */
function paraElColaborador(f) {
  return {
    estado: f.estado,
    periodo: f.periodo.slice(0, 7),
    mes: nombreDelMes(f.periodo),
    colaborador: f.colaborador_nombre,
    empresa: {
      razon_social: f.razon_social,
      nif: f.empresa_nif,
      direccion: f.direccion,
      cp: f.cp,
      ciudad: f.ciudad,
      pais: f.pais,
      logo_url: f.logo_url,
    },
    importe_acordado: f.importe_esperado === null ? null : Number(f.importe_esperado),
    caduca_at: f.caduca_at,
    // Cómo cobra de esta empresa (segunda parte), para pedirle el desglose. Sin
    // modalidad, null: la factura se sube como en la primera parte.
    cobro: f.modalidad ? {
      modalidad: f.modalidad,
      importe_fijo: num(f.importe_fijo),
      tarifa_hora: num(f.tarifa_hora),
      iva_pct: num(f.iva_pct),
      irpf_pct: num(f.irpf_pct),
      concepto: conceptoSugerido(f.area, f.periodo),
    } : null,
    recibida: f.subida_at ? {
      subida_at: f.subida_at,
      numero_recepcion: f.numero_recepcion,
      importe: f.importe === null ? null : Number(f.importe),
      numero_factura: f.numero_factura,
      archivo: f.nombre_original,
      // Lo que calculó el CRM con el desglose (null sin él), para enseñarlo.
      total: num(f.total),
      // Lo que pone el PDF y si cuadra con lo escrito (corrección de Diego del
      // 13/10). `cuadra` null = no se pudo leer el PDF (o es una foto): no es «No cuadra».
      importe_pdf: num(f.importe_pdf),
      cuadra: f.cuadra ?? null,
      es_pdf: f.mime === 'application/pdf',
    } : null,
    // El estado del pago («Mi factura», ficha de Diego del 07/10): la fecha y la
    // forma, nada más (ni el justificante ni quién lo marcó).
    pago: f.pagada_at ? { pagada_at: f.pagada_at, forma_pago: f.forma_pago } : null,
  };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Si cobra por proyecto y aún puede subirla, los campus de esa empresa para elegir en cada línea. */
async function conCampus(datos, issuerId) {
  const sube = datos.cobro?.modalidad === 'proyecto' && !datos.recibida && !['anulada', 'caducado'].includes(datos.estado);
  return sube ? { ...datos, campus: await model.campusDeLaEmpresa(issuerId) } : datos;
}

/** La primera vez que se usa un enlace caducado, queda en el registro. */
async function anotarCaducado(f, ip) {
  if (f.estado === 'caducado' && !(await model.tieneEvento(f.id, 'caducado'))) {
    await anotar(pool, { facturaId: f.id, evento: 'caducado', ip, detalle: { caduco: f.caduca_at } });
  }
}

/**
 * «Este mes no facturo a esta empresa» desde el enlace (Diego, 31/10). No le llega
 * el recordatorio del día 5 ni sale como pendiente; se deshace con `deshacer` o
 * subiendo la factura. Un enlace caducado, recibido o anulado no se toca.
 */
export async function sinFacturaPorEnlace(token, { motivo = null, deshacer = false } = {}, ip) {
  const f = await model.porTokenHash(huella(token));
  if (!f) throw ENLACE_NO_VALE();
  await anotarCaducado(f, ip);
  await enTransaccion(async (db) => {
    const fila = await model.bloquear(db, f.id);
    if (fila.anulada_at) throw new AppError('Esta factura se anuló: te llegará un enlace nuevo', 409, 'ANULADA');
    if (fila.subida_at) throw new AppError('Esta factura ya está recibida', 409, 'YA_SUBIDA');
    if (fila.caduca_at && new Date(fila.caduca_at) < new Date()) {
      throw new AppError('Este enlace ha caducado: pide uno nuevo a administración', 410, 'CADUCADO');
    }
    if (deshacer) {
      await model.quitarSinFactura(db, f.id);
      await anotar(db, { facturaId: f.id, evento: 'sin_factura_deshecho', ip });
    } else {
      const m = typeof motivo === 'string' ? motivo.trim().slice(0, 300) : '';
      await model.marcarSinFactura(db, f.id, m || null);
      await anotar(db, { facturaId: f.id, evento: 'sin_factura', ip, detalle: m ? { motivo: m } : null });
    }
  });
  const ahora = await model.porTokenHash(huella(token));
  return conCampus(paraElColaborador(ahora), ahora.issuer_id);
}

export async function verEnlace(token, ip) {
  const f = await model.porTokenHash(huella(token));
  if (!f) throw ENLACE_NO_VALE();
  await anotarCaducado(f, ip);
  if (['enviado', 'sin_enviar', 'no_enviado'].includes(f.estado) && await model.marcarAbierto(f.id)) {
    await anotar(pool, { facturaId: f.id, evento: 'abierto', ip });
    f.estado = 'abierto';
  }
  return conCampus(paraElColaborador(f), f.issuer_id);
}

const FIRMAS = [
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
];

/** El tipo de verdad, por los primeros bytes; lo que diga el navegador no cuenta. */
export function tipoReal(buffer) {
  return FIRMAS.find((f) => f.bytes.every((b, i) => buffer[i] === b)) || null;
}

/** «2026-09_CEDIA_Laura-Perez_F-2026-09.pdf» (Definición acordada, «Archivos y descargas»). */
export function nombreDelArchivo({ periodo, empresa, colaborador, numeroFactura, ext }) {
  const limpio = (t) => String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40);
  const corta = limpio(String(empresa).split(/\s+/)[0]) || 'empresa';
  return [periodo.slice(0, 7), corta, limpio(colaborador), limpio(numeroFactura)].filter(Boolean).join('_') + `.${ext}`;
}

export async function subir(token, datos, ip) {
  const f = await model.porTokenHash(huella(token));
  if (!f) throw ENLACE_NO_VALE();
  await anotarCaducado(f, ip);
  const nombre = await guardarFactura(f, datos, { ip, enlaceHash: huella(token) });
  // Ya guardada: se lee fuera de la transacción, con lo que ve todo el mundo.
  const subida = await model.porTokenHash(huella(token));
  despuesDeResponder(subida, nombre, datos.archivo.buffer);
  return paraElColaborador(subida);
}

/**
 * Subir la factura de una fila del mes. Lo mismo por el enlace del correo que
 * desde «Mi factura»: una por empresa y mes, PDF o foto, 10 MB.
 */
async function guardarFactura(f, { archivo, importe, numeroFactura, desglose: entrada = {} }, { ip = null, userId = null, enlaceHash = null }) {
  const delMes = `${nombreDelMes(f.periodo)} para ${f.razon_social}`;
  if (f.estado === 'anulada') {
    throw new AppError('Esta factura se anuló: te llegará un enlace nuevo', 409, 'ANULADA');
  }
  if (f.estado === 'recibida') {
    throw new AppError(`Ya subiste la factura de ${delMes}`, 409, 'YA_SUBIDA');
  }
  if (f.estado === 'caducado') {
    throw new AppError('Este enlace ha caducado: pide uno nuevo a administración', 410, 'CADUCADO');
  }

  if (!archivo) throw new AppError('Falta el archivo de la factura', 400, 'FILE_REQUIRED');
  if (archivo.size > TOPE_BYTES) throw new AppError('El archivo pasa de 10 MB', 400, 'FILE_TOO_LARGE');
  const tipo = tipoReal(archivo.buffer);
  if (!tipo) throw new AppError('El archivo tiene que ser un PDF o una foto JPG o PNG', 400, 'INVALID_FILE_TYPE');

  // El desglose, según cómo cobra de esta empresa (segunda parte). Se comprueba
  // antes de subir nada a R2. Se guarda para enseñarlo y para lo acordado, pero
  // ya no decide si cuadra.
  const desglose = calcularDesglose({
    cobro: f, area: f.area, periodo: f.periodo, entrada,
    campus: f.modalidad === 'proyecto' ? (await model.campusDeLaEmpresa(f.issuer_id)).map((p) => p.id) : [],
  });

  // «El monto es que coincida el PDF y lo que se escribió de factura ahí» (Diego,
  // 13/10): cuadra si el total del PDF es el importe escrito. Se lee aquí, fuera
  // de la transacción y antes de R2, con su tope de tiempo. Si no se puede leer
  // (escaneado, roto, o una foto), null: se guarda igual, «No se pudo leer el PDF».
  const importePdf = tipo.mime === 'application/pdf' ? await leerImporteDelPdf(archivo.buffer, importe) : null;
  const cuadraConElPdfSubido = cuadraConElPdf(importe, importePdf);

  const sha256 = crypto.createHash('sha256').update(archivo.buffer).digest('hex');
  const nombre = nombreDelArchivo({
    periodo: f.periodo, empresa: f.razon_social, colaborador: f.colaborador_nombre, numeroFactura, ext: tipo.ext,
  });

  // El nombre tal como lo puso el colaborador: multer lo lee como Latin-1 y
  // «Peña» llegaba como «PeÃ±a». El mismo arreglo que los adjuntos de WhatsApp.
  const nombreOriginal = (enUtf8(archivo.originalname) || nombre).slice(0, 255);

  // El archivo, a R2 antes de abrir la transacción: con la subida dentro, la
  // conexión a la base y el candado de la fila quedaban ocupados todo lo que
  // tardara. Si luego la factura no se guarda (otra subida se adelantó), el
  // archivo se queda en R2 sin fila que lo use: es lo raro, y no se pierde nada.
  const archivoKey = await guardarArchivo(
    `facturas-colaborador/${f.periodo.slice(0, 7)}/${f.id}-${sha256.slice(0, 8)}/${nombre}`, archivo.buffer, tipo.mime);

  await enTransaccion(async (db) => {
    // Con la fila bloqueada: dos envíos a la vez no pueden subir los dos.
    const fila = await model.bloquear(db, f.id);
    if (enlaceHash && fila.token_hash !== enlaceHash) throw ENLACE_NO_VALE();
    if (fila.anulada_at) throw new AppError('Esta factura se anuló: te llegará un enlace nuevo', 409, 'ANULADA');
    if (fila.subida_at) throw new AppError(`Ya subiste la factura de ${delMes}`, 409, 'YA_SUBIDA');

    const numeroRecepcion = await model.siguienteRecepcion(db, f.periodo);
    await model.guardarSubida(db, f.id, {
      numeroRecepcion, importe, numeroFactura, archivoKey, nombreOriginal,
      mime: tipo.mime, tamano: archivo.size, sha256, desglose, importePdf, cuadra: cuadraConElPdfSubido,
    });
    await anotar(db, {
      facturaId: f.id, evento: 'recibida', ip, userId,
      detalle: {
        archivo: nombreOriginal, tamano: archivo.size, importe,
        numero_factura: numeroFactura, numero_recepcion: numeroRecepcion,
        // Lo leído del PDF, o null si no se pudo leer; y si cuadra con lo escrito.
        importe_pdf: importePdf, cuadra: cuadraConElPdfSubido,
        ...(desglose ? {
          modalidad: f.modalidad, base: desglose.base, iva: desglose.iva, irpf: desglose.irpf,
          total: desglose.total, horas: desglose.horas,
        } : {}),
      },
    });
  });
  return nombre;
}

/* ─────────────────────────── «Mi factura» (colaborador con usuario) ─────────────────────────── */

const NO_ES_TUYA = () => new AppError('Factura no encontrada', 404, 'NOT_FOUND');

/** Sus meses: los de los colaboradores de la lista que llevan su usuario. */
export async function mias(user) {
  const filas = await model.delUsuario(user.userId);
  return Promise.all(filas.map(async (f) => ({
    id: f.id,
    ...(await conCampus(paraElColaborador(f), f.issuer_id)),
    // Su enlace, rehecho con la semilla; solo mientras sirve para subirla.
    // Solo si el enlace rehecho cuadra con su huella: si cambió la clave del servidor no funcionaría.
    enlace: f.token_semilla && !['recibida', 'anulada', 'caducado'].includes(f.estado)
      && (!f.token_hash || huella(enlaceDeLaSemilla(f.token_semilla)) === f.token_hash)
      ? urlDelEnlace(enlaceDeLaSemilla(f.token_semilla)) : null,
  })));
}

export async function subirMia(user, id, datos, ip) {
  const f = await model.delUsuarioPorId(user.userId, id);
  if (!f) throw NO_ES_TUYA();
  const nombre = await guardarFactura(f, datos, { ip, userId: user.userId });
  const subida = await model.delUsuarioPorId(user.userId, id);
  despuesDeResponder(subida, nombre, datos.archivo.buffer);
  return { id, ...paraElColaborador(subida) };
}

export async function archivoMio(user, id) {
  const f = await model.delUsuarioPorId(user.userId, id);
  if (!f) throw NO_ES_TUYA();
  if (!f.archivo_key) throw new AppError('Esta factura todavía no tiene archivo', 404, 'NOT_FOUND');
  return { url: await urlDeDescarga(f.id, f.archivo_key), nombre: f.nombre_original, caduca_en_segundos: 15 * 60 };
}

/* ─────────────────────────── administración ─────────────────────────── */

const NO_ESTA = () => new AppError('Factura no encontrada', 404, 'NOT_FOUND');

export async function delMes(user, filtros) {
  const ambito = await ambitoDe(user);
  if (filtros.issuerId && ambito && !ambito.includes(filtros.issuerId)) {
    throw new AppError('Esa empresa no es de tus campus', 403, 'FORBIDDEN');
  }
  const filas = await model.delMes({ ...filtros, issuerIds: ambito });
  const vivas = filas.filter((f) => f.estado !== 'anulada');
  const suma = (k) => vivas.reduce((s, f) => s + (f[k] === null ? 0 : Number(f[k])), 0);
  // «3.150,00 € de 3.600,00 € acordados»: lo acordado es la base, así que con desglose
  // cuenta su base (600 de 600, no los 636 con IVA e IRPF), como la diferencia de cada fila.
  const recibido = vivas.reduce((s, f) => s + (f.importe === null ? 0 : Number(f.base ?? f.importe)), 0);
  return {
    periodo: filtros.periodo.slice(0, 7),
    mes: nombreDelMes(filtros.periodo),
    resumen: {
      total: vivas.length,
      recibidas: vivas.filter((f) => f.estado === 'recibida').length,
      importe_recibido: Math.round(recibido * 100) / 100,
      importe_acordado: Math.round(suma('importe_esperado') * 100) / 100,
    },
    facturas: filas,
  };
}

/**
 * Las pestañas Enviadas, Por pagar (con el total pendiente), Pagadas e
 * Historial («Añadido 01/10 (tarde)»). Un admin, solo lo de sus empresas.
 */
export async function deLaVista(user, filtros) {
  const ambito = await ambitoDe(user);
  if (filtros.issuerId && ambito && !ambito.includes(filtros.issuerId)) {
    throw new AppError('Esa empresa no es de tus campus', 403, 'FORBIDDEN');
  }
  const filas = await model.deLaVista({ ...filtros, issuerIds: ambito });
  const suma = (l) => Math.round(l.reduce((s, f) => s + (f.importe === null ? 0 : Number(f.importe)), 0) * 100) / 100;
  const vivas = filas.filter((f) => f.estado !== 'anulada');
  return {
    vista: filtros.vista,
    resumen: {
      total: filas.length,
      importe: suma(vivas),
      // «Por pagar (con el total pendiente)»: lo recibido y aún sin pagar.
      pendiente: suma(vivas.filter((f) => f.subida_at && !f.pagada_at)),
    },
    facturas: filas,
  };
}

/** Coste por campus del mes: horas y base de las líneas del desglose, de las empresas que se ven. */
export async function costePorCampus(user, periodo, issuerId = null) {
  const ambito = await ambitoDe(user);
  if (issuerId && ambito && !ambito.includes(issuerId)) throw new AppError('Esa empresa no es de tus campus', 403, 'FORBIDDEN');
  const filas = await model.costePorCampus({ periodo, issuerIds: ambito, issuerId });
  return { periodo: periodo.slice(0, 7), mes: nombreDelMes(periodo), campus: filas };
}

/**
 * La hora de Madrid, para el Excel: ExcelJS escribe la fecha en UTC, y una factura
 * subida a las 12:44 de Madrid salía a las 10:44. Se pasa la hora de reloj de Madrid
 * como si fuera UTC, que es lo que el Excel enseña.
 */
function horaDeMadrid(fecha) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(fecha)).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

const AREA_ES = {
  soporte: 'Soporte', desarrollo: 'Desarrollo', wordpress: 'WordPress', seo: 'SEO', contenido: 'Contenido', otra: 'Otra',
};

/**
 * El ZIP del mes de una empresa, para mandárselo al gestor:
 * «facturas-colaboradores_2026-09_CEDIA.zip», con las facturas recibidas y un
 * resumen.xlsx con las columnas de la definición (colaborador, área y NIF;
 * número de factura; importe, lo acordado y la diferencia; fecha de subida y
 * número de recepción). Un admin, solo de sus empresas.
 */
export async function zipDelMes(user, periodo, issuerId) {
  const ambito = await ambitoDe(user);
  if (ambito && !ambito.includes(issuerId)) throw new AppError('Esa empresa no es de tus campus', 403, 'FORBIDDEN');
  const empresa = await model.razonSocial(issuerId);
  if (!empresa) throw new AppError('Esa empresa no existe', 404, 'NOT_FOUND');
  const filas = await model.paraElZip(periodo, issuerId);
  if (!filas.length) {
    throw new AppError(`No hay facturas recibidas de ${nombreDelMes(periodo)} para ${empresa}`, 404, 'NOT_FOUND');
  }

  // Se cargan aquí, al pedir el ZIP, y no al arrancar (como en wasapiCsv.js).
  const [{ default: JSZip }, { default: ExcelJS }] = await Promise.all([import('jszip'), import('exceljs')]);
  const zip = new JSZip();
  const usados = new Set();
  for (const f of filas) {
    // El nombre con que se guardó: «2026-09_CEDIA_Laura-Perez_F-2026-09.pdf» (de R2 o del disco).
    // Si dos se llaman igual (mismo nombre y mismo número de factura), la segunda lleva
    // su número de recepción: si no, una pisaba a la otra dentro del ZIP sin avisar.
    let nombre = f.archivo_key.split('/').pop();
    if (usados.has(nombre)) nombre = nombre.replace(/(\.[^.]+)?$/, `_${f.numero_recepcion}$1`);
    usados.add(nombre);
    // La fecha de cada archivo dentro del ZIP: cuándo se subió, en hora de Madrid como el resumen.
    // JSZip guarda la hora tal cual en UTC y Windows la enseña como local: salía 4 o 6 horas de más.
    zip.file(nombre, await leerArchivo(f.archivo_key), { date: horaDeMadrid(f.subida_at) });
  }

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Resumen');
  hoja.columns = [
    { header: 'Colaborador', key: 'colaborador', width: 28 },
    { header: 'Área', key: 'area', width: 14 },
    { header: 'NIF', key: 'nif', width: 14 },
    { header: 'Número de factura', key: 'numero_factura', width: 20 },
    { header: 'Importe', key: 'importe', width: 12, style: { numFmt: '#,##0.00 €' } },
    { header: 'Acordado', key: 'acordado', width: 12, style: { numFmt: '#,##0.00 €' } },
    { header: 'Diferencia', key: 'diferencia', width: 12, style: { numFmt: '#,##0.00 €' } },
    { header: 'Fecha de subida', key: 'subida', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Número de recepción', key: 'numero_recepcion', width: 20 },
  ];
  hoja.getRow(1).font = { bold: true };
  for (const f of filas) {
    hoja.addRow({
      colaborador: f.colaborador, area: AREA_ES[f.area] || f.area, nif: f.nif || '',
      numero_factura: f.numero_factura, importe: num(f.importe), acordado: num(f.importe_esperado),
      diferencia: num(f.diferencia), subida: horaDeMadrid(f.subida_at), numero_recepcion: f.numero_recepcion,
    });
  }
  zip.file('resumen.xlsx', Buffer.from(await libro.xlsx.writeBuffer()), { date: horaDeMadrid(new Date()) });

  return {
    nombre: `facturas-colaboradores_${periodo.slice(0, 7)}_${empresaCorta(empresa)}.zip`,
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  };
}

/**
 * El desglose de una factura, para administración («Administración lo ve todo»):
 * las líneas (encargo, campus, horas, tarifa e importe) y lo que calculó el CRM,
 * y los dos importes que deciden si cuadra: el escrito y el del PDF (13/10).
 * Sin desglose (subida sin modalidad), las líneas van vacías. `cuadra` null =
 * no se pudo leer el PDF.
 */
export async function desgloseDeFactura(user, id) {
  const f = await model.porId(id, await ambitoDe(user));
  if (!f) throw NO_ESTA();
  return {
    importe: num(f.importe), base: num(f.base), iva: num(f.iva), irpf: num(f.irpf),
    total: num(f.total), horas: num(f.horas),
    importe_pdf: num(f.importe_pdf), cuadra: f.cuadra ?? null, es_pdf: f.mime === 'application/pdf',
    lineas: await model.lineasDe(id),
  };
}

/** El archivo, con un enlace firmado de 15 minutos. */
export async function urlDelArchivo(user, id) {
  const f = await model.porId(id, await ambitoDe(user));
  if (!f) throw NO_ESTA();
  if (!f.archivo_key) throw new AppError('Esta factura todavía no tiene archivo', 404, 'NOT_FOUND');
  return { url: await urlDeDescarga(f.id, f.archivo_key), nombre: f.nombre_original, caduca_en_segundos: 15 * 60 };
}

/* ─────────────────────────── el pago (segunda parte) ─────────────────────────── */

/**
 * «Marcar pagada» («Añadido 01/10 (tarde)»): la fecha (hoy por defecto, la pone
 * la pantalla), la forma de pago y, si se quiere, el justificante. Una o varias
 * a la vez, solo un admin (el permiso lo mira la ruta), y todo al registro. El
 * estado del pago no se mezcla con el de la factura: solo se paga una recibida.
 */
export async function pagar(user, { ids, fecha, forma, referencia, archivo }, ip) {
  const ambito = await ambitoDe(user);
  const facturas = [];
  for (const id of ids) {
    const f = await model.porId(id, ambito);
    if (!f) throw NO_ESTA();
    facturas.push(f);
  }
  const nombres = (l) => l.map((f) => `${f.colaborador_nombre} (${nombreDelMes(f.periodo)})`).join(', ');
  const sinRecibir = facturas.filter((f) => !f.subida_at || f.anulada_at);
  if (sinRecibir.length) {
    throw new AppError(`Solo se pagan facturas recibidas, y ${sinRecibir.length === 1 ? 'esta no lo está' : 'estas no lo están'}: ${nombres(sinRecibir)}`, 409, 'NO_RECIBIDA');
  }
  const yaPagadas = facturas.filter((f) => f.pagada_at);
  if (yaPagadas.length) {
    throw new AppError(`${yaPagadas.length === 1 ? 'Ya está pagada' : 'Ya están pagadas'}: ${nombres(yaPagadas)}`, 409, 'YA_PAGADA');
  }

  // El justificante, guardado antes de la transacción (como el archivo de la factura): R2 o el disco.
  let justificante = null;
  let nombreJustificante = null;
  if (archivo) {
    if (archivo.size > TOPE_BYTES) throw new AppError('El justificante pasa de 10 MB', 400, 'FILE_TOO_LARGE');
    const tipo = tipoReal(archivo.buffer);
    if (!tipo) throw new AppError('El justificante tiene que ser un PDF o una foto JPG o PNG', 400, 'INVALID_FILE_TYPE');
    const sha = crypto.createHash('sha256').update(archivo.buffer).digest('hex').slice(0, 8);
    nombreJustificante = (enUtf8(archivo.originalname) || `justificante.${tipo.ext}`).slice(0, 255);
    justificante = await guardarArchivo(
      `facturas-colaborador/pagos/${fecha.slice(0, 7)}/${sha}/justificante-${fecha}.${tipo.ext}`, archivo.buffer, tipo.mime);
  }

  await enTransaccion(async (db) => {
    // Bloqueadas: si otro pago o una anulación se adelantó, este no sigue.
    for (const fila of await model.bloquearVarias(db, ids)) {
      if (fila.pagada_at) throw new AppError('Alguien acaba de marcarla como pagada. Actualiza la lista.', 409, 'YA_PAGADA');
      if (!fila.subida_at || fila.anulada_at) throw new AppError('Solo se pagan facturas recibidas: actualiza la lista.', 409, 'NO_RECIBIDA');
    }
    for (const f of facturas) {
      await model.marcarPagada(db, f.id, { fecha, porUserId: user.userId, forma, justificante, referencia });
      await anotar(db, {
        facturaId: f.id, evento: 'pagada', userId: user.userId, ip,
        detalle: {
          fecha, forma_pago: forma, referencia_pago: referencia, justificante: nombreJustificante,
          importe: f.importe === null ? null : Number(f.importe), ...(ids.length > 1 ? { junto_con: ids.length } : {}),
        },
      });
    }
  });

  // El aviso, DESPUÉS de responder (como el acuse de la revisión del 10/10): con muchas
  // a la vez y los correos encendidos, la petición esperaba a Brevo y podía cortarse
  // con el pago ya guardado.
  setImmediate(async () => {
    for (const f of facturas) await mandarAvisoDePago(f.id);
  });
  return { pagadas: ids, fecha, forma_pago: forma };
}

/** El aviso al colaborador. Si falla, el pago ya está guardado: solo se apunta en el log. */
async function mandarAvisoDePago(id) {
  try {
    const f = await model.porId(id, null);
    // Sale después de responder: si entretanto se deshizo el pago, no se avisa de nada.
    if (!f?.pagada_at) return;
    // La vez que se paga: si se deshace y se vuelve a pagar, aunque sea el mismo día, sale otro aviso.
    const vez = await model.vecesQue(id, 'pagada');
    const r = await enviarAvisoDePago({ f, vez, marca: await model.marcaDeLaEmpresa(f.issuer_id) });
    if (r?.sent) await anotar(pool, { facturaId: id, evento: 'aviso_pago', detalle: { para: f.colaborador_email } });
  } catch (err) {
    logger.error({ err: err.message, facturaId: id }, 'No se pudo mandar el aviso de pago de la factura de colaborador');
  }
}

/** «Se puede deshacer con motivo»: vuelve a «por pagar», y lo que había queda en el registro. */
export async function deshacerPago(user, id, motivo, ip) {
  const f = await model.porId(id, await ambitoDe(user));
  if (!f) throw NO_ESTA();
  if (!f.pagada_at) throw new AppError('Esta factura no está pagada', 409, 'NO_PAGADA');
  await enTransaccion(async (db) => {
    const [fila] = await model.bloquearVarias(db, [id]);
    if (!fila.pagada_at) throw new AppError('Esta factura no está pagada', 409, 'NO_PAGADA');
    await model.deshacerPago(db, id);
    await anotar(db, {
      facturaId: id, evento: 'pago_deshecho', userId: user.userId, ip,
      detalle: { motivo, antes: { fecha: f.pagada_at, forma_pago: f.forma_pago, referencia_pago: f.referencia_pago } },
    });
  });
  return { id };
}

export async function urlDelJustificante(user, id) {
  const f = await model.porId(id, await ambitoDe(user));
  if (!f) throw NO_ESTA();
  if (!f.justificante) throw new AppError('Este pago no tiene justificante', 404, 'NOT_FOUND');
  return { url: await urlDeDescarga(f.id, f.justificante, 'justificante'), caduca_en_segundos: 15 * 60 };
}

/**
 * Anular: la factura se queda (con su archivo) marcada como anulada, y nace
 * otra fila del mismo mes con un enlace nuevo para que la vuelva a subir.
 */
export async function anular(user, id, motivo, ip) {
  const f = await model.porId(id, await ambitoDe(user));
  if (!f) throw NO_ESTA();
  if (f.anulada_at) throw new AppError('Esta factura ya está anulada', 409, 'CONFLICT');
  // Pagada y anulada a la vez no cuadra: primero se deshace el pago, con su motivo.
  if (f.pagada_at) throw new AppError('Esta factura está pagada: deshaz el pago antes de anularla', 409, 'PAGADA');

  const { token, hash, semilla } = tokenNuevo();
  const nuevaId = await enTransaccion(async (db) => {
    // Con la fila bloqueada: si otra anulación se adelantó, esta no sigue.
    const fila = await model.bloquear(db, id);
    if (fila.anulada_at) throw new AppError('Esta factura ya está anulada', 409, 'CONFLICT');
    // Y con la fila bloqueada: si otro admin la pagó entretanto, no queda pagada y anulada a la vez.
    if (fila.pagada_at) throw new AppError('Esta factura está pagada: deshaz el pago antes de anularla', 409, 'PAGADA');
    await model.anular(db, id, user.userId, motivo);
    await anotar(db, { facturaId: id, evento: 'anulada', userId: user.userId, ip, detalle: { motivo } });
    const nueva = await model.crearDelMes(db, {
      colaboradorId: f.colaborador_id, issuerId: f.issuer_id, periodo: f.periodo,
      importeEsperado: f.importe_esperado, tokenHash: hash, semilla, caducaAt: caducidad(),
    });
    await anotar(db, { facturaId: nueva, evento: 'reenviado', userId: user.userId, ip, detalle: { sustituye_a: id } });
    return nueva;
  });
  await mandarEnlace(nuevaId, token, { nuevo: true, clave: `facturas-colaborador-reenvio-${nuevaId}-${Date.now()}` });
  return { anulada: id, nueva: nuevaId, token };
}

/** Un enlace nuevo para quien todavía no la ha subido. El viejo deja de valer. */
export async function reenviar(user, id, ip) {
  const f = await model.porId(id, await ambitoDe(user));
  if (!f) throw NO_ESTA();
  if (f.anulada_at) throw new AppError('Esta factura está anulada', 409, 'CONFLICT');
  if (f.subida_at) throw new AppError('Esta factura ya está recibida', 409, 'CONFLICT');

  const { token, hash, semilla } = tokenNuevo();
  await enTransaccion(async (db) => {
    // Con la fila bloqueada: si la subida se adelantó, no se cambia el enlace
    // de una factura ya recibida.
    const fila = await model.bloquear(db, id);
    if (fila.anulada_at) throw new AppError('Esta factura está anulada', 409, 'CONFLICT');
    if (fila.subida_at) throw new AppError('Esta factura ya está recibida', 409, 'CONFLICT');
    await model.cambiarEnlace(db, id, hash, semilla, caducidad());
    await anotar(db, { facturaId: id, evento: 'reenviado', userId: user.userId, ip });
  });
  await mandarEnlace(id, token, { nuevo: true, clave: `facturas-colaborador-reenvio-${id}-${Date.now()}` });
  return { id, token };
}

export async function registroDeFactura(user, id) {
  if (!(await model.porId(id, await ambitoDe(user)))) throw NO_ESTA();
  return model.registroDeFactura(id);
}

/* ─────────────────────────── la tarea del mes ─────────────────────────── */

/**
 * El día 5: a quien todavía no ha subido la del mes anterior, el recordatorio,
 * con el mismo enlace (Definición acordada, «Cómo funciona», 6). Se rehace con
 * su semilla y se comprueba contra la huella: si no cuadra (la clave del
 * servidor cambió), no se manda un enlace que no funcionaría.
 */
export async function recordar(periodo) {
  let recordados = 0;
  for (const { id, token_semilla: semilla, token_hash: hash } of await model.sinSubir(periodo)) {
    if (!semilla || await model.tieneEvento(id, 'recordatorio') || await model.recordatorioFallido(id)) continue;
    const token = enlaceDeLaSemilla(semilla);
    if (huella(token) !== hash) {
      logger.warn({ facturaId: id }, 'El enlace de la factura no cuadra con su huella: no se manda el recordatorio');
      continue;
    }
    const r = await mandarEnlace(id, token, { recordatorio: true, clave: `facturas-colaborador-recordatorio-${id}` });
    if (r?.sent) recordados++;
  }
  return { recordados };
}

/** El último día del mes: prepara el mes y manda a cada uno su enlace. */
export async function prepararYMandar(periodo) {
  const preparados = await prepararMes(periodo);
  let mandados = 0;
  for (const p of preparados) {
    const r = await mandarEnlace(p.facturaId, p.token, { clave: `facturas-colaborador-mes-${p.facturaId}` });
    if (r?.sent) mandados++;
  }
  // Y las del mes ya preparadas cuyo enlace no salió (revisión del 10/10): si el mes
  // se preparó con los correos apagados, salen en cuanto se encienden. Solo con los
  // correos encendidos, para no llenar el registro de intentos en cada vuelta. Misma
  // clave que el envío del mes: Brevo no lo repite si ya salió.
  let pendientes = 0;
  if (correosActivos()) {
    const nuevos = new Set(preparados.map((p) => p.facturaId));
    for (const { id, token_semilla: semilla, token_hash: hash } of await model.sinEnviar(periodo)) {
      if (nuevos.has(id) || !semilla) continue;
      const token = enlaceDeLaSemilla(semilla);
      if (huella(token) !== hash) continue;
      const r = await mandarEnlace(id, token, { clave: `facturas-colaborador-mes-${id}` });
      if (r?.sent) { mandados++; pendientes++; }
    }
  }
  return { preparados: preparados.length, mandados, pendientes_enviados: pendientes };
}
