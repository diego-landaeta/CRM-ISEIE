/*
  EL PLUGIN DEL CRM EN CADA MOODLE (#679).

  `local_crm` (tools/moodle-local-crm) avisa al CRM de cada mensaje privado del
  campus, firmado con la clave de ese campus. Aquí vive esa clave y el estado:
  si el plugin está activo y cuándo llegó el último aviso.

  Con el plugin activo, la respuesta desde el CRM sale por el plugin
  (`local_crm_enviar_mensaje`) en nombre de la tutora, con el token del campus;
  sin él, con el token personal de la tutora, como antes (consultas.service.js,
  `enviarAlCampus`).

  SOLO EN PRUEBAS mientras Diego no lo apruebe (PLUGIN_MOODLE_EN_PRODUCCION,
  shared/config/soloEnPruebas.js): apagado, aquí no se da ningún código, no se
  repasa ningún campus ni se les manda la disponibilidad, y la respuesta sale
  con el token de la tutora.

  La firma: cabecera `X-Crm-Firma: t=<unix>,v1=<hex>`, con
  v1 = HMAC-SHA256(clave, "<t>.<cuerpo>"). Fuera de 5 minutos no vale: así un
  aviso capturado no se puede repetir más tarde.
*/
import crypto from 'node:crypto';
import { query } from '../../shared/config/db.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import { llamar } from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';

export const VENTANA_FIRMA_S = 300;

/** La ruta del aviso de un campus: la que se pone en el plugin, tras la dirección del CRM. */
export const rutaDelAviso = (projectId) => `/api/moodle-avisos/${projectId}`;

/**
 * Crea (o cambia) la clave del campus y activa el plugin. La clave se enseña UNA
 * vez: después solo se guarda cifrada. Cambiarla deja de aceptar la anterior.
 */
export async function crearClave(projectId, userId = null) {
  const secreto = crypto.randomBytes(32).toString('hex');
  const enc = encrypt(secreto);
  await query(
    `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo, creado_por)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     ON CONFLICT (project_id) DO UPDATE
       SET secreto_cifrado = EXCLUDED.secreto_cifrado, secreto_iv = EXCLUDED.secreto_iv,
           secreto_tag = EXCLUDED.secreto_tag, activo = TRUE, creado_por = EXCLUDED.creado_por,
           -- Conectar (otra vez) es empezar el repaso de cero: el cursor era de los ids del
           -- Moodle de antes, y si ahora es otro (otra base) se saltaba sus primeros mensajes.
           -- Sin cursor, el repaso va por fecha y lo repetido lo descarta el índice único.
           sincronizado_hasta_id = NULL, sincronizacion_error = NULL,
           updated_at = NOW()`,
    [projectId, enc.encrypted, enc.iv, enc.authTag, userId]);
  return secreto;
}

/** Deja de aceptar avisos y vuelve a responder con el token de cada tutora. */
export async function desactivar(projectId) {
  const { rowCount } = await query(
    'UPDATE moodle_plugin_campus SET activo = FALSE, updated_at = NOW() WHERE project_id = $1', [projectId]);
  return rowCount > 0;
}

/** Lo que enseña el panel: si hay clave, si está activo y el último aviso. */
export async function estado(projectId) {
  const { rows } = await query(
    `SELECT activo, ultimo_aviso_at, updated_at, sincronizado_at, sincronizacion_error, version_plugin
       FROM moodle_plugin_campus WHERE project_id = $1`, [projectId]);
  const r = rows[0];
  return {
    project_id: projectId,
    configurado: Boolean(r),
    activo: Boolean(r?.activo),
    ultimo_aviso_at: r?.ultimo_aviso_at || null,
    // El repaso de cada 15 minutos: el último bueno, el error si lo hay y la versión del plugin.
    sincronizado_at: r?.sincronizado_at || null,
    sincronizacion_error: r?.sincronizacion_error || null,
    version_plugin: r?.version_plugin || null,
    clave_desde: r?.updated_at || null,
    ruta: rutaDelAviso(projectId),
  };
}

/** Cada cuánto repasa el CRM los campus con el plugin (moodleSincronizacionScheduler.js). */
const REPASO_POR_DEFECTO_MS = 15 * 60 * 1000;

/**
 * Cuánto puede tardar el último repaso bueno para dar el campus por al día: dos repasos
 * y cinco minutos de margen (35 min con el de serie). Un repaso que falla una vez no
 * basta para volver a leerlo cada 5 minutos; dos seguidos, sí.
 */
export function minutosPluginAlDia(env = process.env) {
  const tick = parseInt(env.MOODLE_SINCRONIZACION_TICK_MS || '', 10);
  const ms = Number.isFinite(tick) && tick > 0 ? tick : REPASO_POR_DEFECTO_MS;
  return Math.ceil((2 * ms) / 60000) + 5;
}

/**
 * Los campus que el plugin tiene al día (#689, 8b): la lectura de cada 5 minutos se los
 * salta, porque ya entran por el plugin dos veces (el aviso al momento y el repaso de
 * cada 15 minutos, que recoge lo que se pierda). Sin esto, cada campus se leía tres veces.
 *
 * Al día = plugin activo en el CRM, sin error en el repaso y con un repaso bueno reciente
 * (`minutosPluginAlDia`). Vuelve a la lectura de 5 minutos, sola, en cuanto deja de estarlo:
 * plugin desconectado, repaso con error (token revocado, plugin desinstalado o viejo) o sin
 * repaso bueno reciente (Moodle caído). Y ninguno se salta si el plugin está apagado en este
 * CRM (PLUGIN_MOODLE_EN_PRODUCCION) o el repaso lo está (MOODLE_SINCRONIZACION_DISABLED=1):
 * sin repaso, un aviso perdido no lo recogería nadie.
 *
 * @returns {Promise<Set<number>>} ids de proyecto.
 */
export async function campusConPluginAlDia(env = process.env) {
  if (!pluginMoodleActivo(env) || env.MOODLE_SINCRONIZACION_DISABLED === '1') return new Set();
  try {
    const { rows } = await query(
      `SELECT project_id FROM moodle_plugin_campus
        WHERE activo AND sincronizacion_error IS NULL
          AND sincronizado_at > NOW() - make_interval(mins => $1::int)`, [minutosPluginAlDia(env)]);
    return new Set(rows.map((r) => Number(r.project_id)));
  } catch (err) {
    // Sin la tabla (falta la 245) o con la base tropezando: se leen todos, como antes.
    logger.warn({ err: err.message }, 'consultas/plugin: no se sabe qué campus tienen el plugin al día; se leen todos');
    return new Set();
  }
}

/** ¿Responde este campus por el plugin? */
export async function pluginActivo(projectId) {
  const { rows } = await query(
    'SELECT 1 FROM moodle_plugin_campus WHERE project_id = $1 AND activo', [projectId]);
  return rows.length > 0;
}

/** La clave del campus (descifrada), o null si no tiene o el plugin está apagado. */
export async function claveDelCampus(projectId) {
  const { rows } = await query(
    `SELECT secreto_cifrado, secreto_iv, secreto_tag FROM moodle_plugin_campus
      WHERE project_id = $1 AND activo`, [projectId]);
  const r = rows[0];
  if (!r) return null;
  try {
    return decrypt(r.secreto_cifrado, r.secreto_iv, r.secreto_tag);
  } catch (err) {
    logger.warn({ projectId, err: err.message }, 'consultas/plugin: la clave del campus no se puede descifrar');
    return null;
  }
}

export async function apuntarAviso(projectId) {
  await query('UPDATE moodle_plugin_campus SET ultimo_aviso_at = NOW() WHERE project_id = $1', [projectId]);
}

// ─── Conectar un campus con UN código (como local_certifex) ─────────────────

export const HORAS_CODIGO = 24;
/** Intentos con un mismo código antes de anularlo. */
export const INTENTOS_CODIGO = 5;
const PREFIJO = 'crm1.';
const huellaDe = (c) => crypto.createHash('sha256').update(c).digest('hex');

/**
 * ¿Es una dirección del CRM de pruebas? Como `enPruebasOAprobado` (soloEnPruebas.js):
 * en ISEIE es /staging (crm.iseie.com/staging); /testeo es como se llama en MultiCRM.
 */
const deTesteo = (u) => /\/(staging|testeo)(\/|$)/.test(String(u || ''));

/**
 * La dirección pública de la API del CRM: la que el plugin llama desde el campus.
 * `API_PUBLIC_BASE_URL` si está; si no, `CRM_BASE_URL` CON SU RUTA + /api, como la
 * del frontal (shared/api/client.js): https://crm.iseie.com/api en producción y
 * https://crm.iseie.com/staging/api en /staging. Quedarse solo con el origen daría,
 * desde /staging, https://crm.iseie.com/api, la de PRODUCCIÓN: un Moodle de pruebas
 * conectado desde /staging mandaría sus avisos al CRM de producción.
 */
export function apiPublica(env = process.env) {
  const fija = String(env.API_PUBLIC_BASE_URL || '').trim();
  if (fija) return fija.replace(/\/+$/, '');
  const base = new URL(env.CRM_BASE_URL || 'http://localhost:5173/crm');
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}/api`;
}

/**
 * Crea el código que se pega en el Moodle. Lleva dentro la dirección del CRM, así
 * que en el campus solo hay que pegar una cosa. Un solo uso y 24 horas.
 */
export async function crearCodigo(projectId, userId = null) {
  if (!pluginMoodleActivo()) {
    throw new AppError('El plugin del CRM en Moodle aún no está aprobado en producción.', 403, 'PLUGIN_APAGADO');
  }
  // /staging nunca da un código que apunte a otro CRM (p. ej. un API_PUBLIC_BASE_URL de
  // producción copiado del .env de producción): el Moodle de pruebas acabaría hablando con él.
  const api = apiPublica();
  if (deTesteo(process.env.CRM_BASE_URL) && !deTesteo(new URL(api).pathname)) {
    logger.error({ api }, 'consultas/plugin: en /staging la API pública no es la de /staging; no se da el código');
    throw new AppError(`Este CRM es el de pruebas (/staging) y su API pública apunta a ${api}. Corrige API_PUBLIC_BASE_URL en el servidor antes de conectar un campus.`, 409, 'API_PUBLICA_NO_VALIDA');
  }
  const secreto = crypto.randomBytes(18).toString('base64url');
  const expira = new Date(Date.now() + HORAS_CODIGO * 3600 * 1000);
  // Un código nuevo anula los anteriores sin usar: si uno se filtró, generar otro lo mata.
  await query(
    `UPDATE moodle_conexion_codigos SET usado_at = NOW(), sitio = 'anulado' WHERE project_id = $1 AND usado_at IS NULL`,
    [projectId]);
  await query(
    `INSERT INTO moodle_conexion_codigos (project_id, huella, expira_at, creado_por) VALUES ($1, $2, $3, $4)`,
    [projectId, huellaDe(secreto), expira, userId]);
  const codigo = PREFIJO + Buffer.from(JSON.stringify({ crm: api, c: secreto })).toString('base64url');
  return { codigo, expira_at: expira.toISOString() };
}

/** La dirección del campus sin protocolo ni barra final, para comparar dos direcciones. */
export const mismaDireccion = (a, b) => {
  const limpia = (u) => String(u || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  return limpia(a) === limpia(b);
};

/**
 * El plugin se presenta con el código: el CRM comprueba que el Moodle es de verdad
 * (llama con el token que trae y exige la función del plugin), guarda la conexión
 * del campus (dirección + token, «Leer las consultas» encendido), crea la clave de
 * los avisos y se la devuelve. El código queda gastado.
 *
 * Dependencias inyectadas (para las pruebas):
 *   · `sitioPermitido(sitio)`: https y fuera de la red interna; si no, ni se llama.
 *   · `comprobar(sitio, token)`: la llamada a Moodle.
 *   · `urlActual(projectId)`: el Moodle que ya tiene el campus, si tiene.
 *   · `guardarIntegracion(projectId, sitio, token)`.
 */
export async function emparejar({ codigo, sitio, token }, { sitioPermitido = async () => ({ ok: true }), comprobar, urlActual = async () => null, guardarIntegracion }) {
  const c = String(codigo || '').trim();
  if (!c || !sitio || !token) return { ok: false, error: 'Faltan datos: código, dirección del campus o token.' };
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.expira_at, c.usado_at, p.nombre
       FROM moodle_conexion_codigos c JOIN projects p ON p.id = c.project_id
      WHERE c.huella = $1`, [huellaDe(c)]);
  const fila = rows[0];
  if (!fila) return { ok: false, error: 'El código no es válido. Genera otro en el CRM (Integraciones › Campus › Conectar campus).' };
  if (fila.usado_at) return { ok: false, error: 'Ese código ya se ha usado. Genera otro en el CRM.' };
  if (new Date(fila.expira_at) < new Date()) return { ok: false, error: 'El código ha caducado. Genera otro en el CRM.' };

  const projectId = Number(fila.project_id);
  const { rows: [cuenta] } = await query(
    'UPDATE moodle_conexion_codigos SET intentos = intentos + 1 WHERE id = $1 AND usado_at IS NULL RETURNING intentos', [fila.id]);
  if (!cuenta) return { ok: false, error: 'Ese código ya se ha usado. Genera otro en el CRM.' };
  if (cuenta.intentos > INTENTOS_CODIGO) {
    await query(`UPDATE moodle_conexion_codigos SET usado_at = NOW(), sitio = 'demasiados intentos' WHERE id = $1`, [fila.id]);
    return { ok: false, error: 'Demasiados intentos con este código. Genera otro en el CRM.' };
  }
  // Un código de un campus no puede redirigirlo a otro Moodle: el que ya tiene se cambia a mano.
  const actual = await urlActual(projectId);
  if (actual && !mismaDireccion(actual, sitio)) {
    return { ok: false, error: `Este campus del CRM ya está conectado a otro Moodle (${String(actual).replace(/^https?:\/\//i, '')}). Si es un cambio de dirección, cámbiala antes en Integraciones.` };
  }
  const permitido = await sitioPermitido(sitio);
  if (!permitido.ok) return { ok: false, error: permitido.error };
  const prueba = await comprobar(sitio, token);
  if (!prueba.ok) return { ok: false, error: prueba.error };

  // Gastar el código ANTES de guardar nada: dos intentos a la vez con el mismo código
  // no pueden conectar dos veces (el segundo no encuentra un código libre).
  const gastado = await query(
    `UPDATE moodle_conexion_codigos SET usado_at = NOW(), sitio = $2 WHERE id = $1 AND usado_at IS NULL RETURNING id`,
    [fila.id, sitio]);
  if (!gastado.rowCount) return { ok: false, error: 'Ese código ya se ha usado. Genera otro en el CRM.' };

  let secreto;
  try {
    await guardarIntegracion(projectId, sitio, token);
    secreto = await crearClave(projectId);
  } catch (err) {
    // Si no se ha podido guardar, el código vuelve a valer: que se pueda reintentar sin otro.
    await query('UPDATE moodle_conexion_codigos SET usado_at = NULL, sitio = NULL WHERE id = $1', [fila.id]).catch(() => {});
    throw err;
  }
  // Conectado: cualquier otro código pendiente de este campus sobra.
  await query(
    `UPDATE moodle_conexion_codigos SET usado_at = NOW(), sitio = 'anulado' WHERE project_id = $1 AND usado_at IS NULL`, [projectId]);
  return { ok: true, projectId, campus: fila.nombre, avisos: `${apiPublica()}${rutaDelAviso(projectId).replace(/^\/api/, '')}`, secreto };
}

/** La firma del cuerpo, como la calcula el plugin. */
export function firmar(cuerpo, secreto, t) {
  const v1 = crypto.createHmac('sha256', secreto).update(`${t}.`).update(cuerpo).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** ¿La cabecera firma este cuerpo con esta clave, y es de hace menos de 5 minutos? */
export function firmaValida(cabecera, cuerpo, secreto, ahoraMs = Date.now()) {
  if (!cabecera || !secreto) return false;
  const partes = Object.fromEntries(String(cabecera).split(',').map((p) => {
    const i = p.indexOf('=');
    return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
  }));
  const t = Number(partes.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(partes.v1 || '')) return false;
  if (Math.abs(ahoraMs / 1000 - t) > VENTANA_FIRMA_S) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(`${t}.`).update(cuerpo).digest();
  return crypto.timingSafeEqual(esperada, Buffer.from(partes.v1, 'hex'));
}

// ─── «No disponible» en el chat directo (#679, plugin 1.6.0) ──────────────────

/**
 * Manda a cada campus con el plugin activo la lista ENTERA de sus tutoras «No disponible»
 * (por su cuenta de Moodle): el botón del chat directo deja de llevar alumnos a ellas.
 * `projectIds`: solo esos campus (los de la tutora que ha cambiado); sin él, todos.
 * Un campus que no contesta no para a los demás; con el plugin anterior a la 1.6.0, la
 * función no existe y se apunta sin más.
 */
export async function avisarDisponibilidad(projectIds = null, opciones = {}) {
  // Apagado (PLUGIN_MOODLE_EN_PRODUCCION) no se escribe en ningún campus.
  if (!pluginMoodleActivo()) return [];
  const { rows: campus } = await query(
    `SELECT project_id FROM moodle_plugin_campus WHERE activo AND ($1::int[] IS NULL OR project_id = ANY($1::int[]))`,
    [projectIds]);
  const resultados = [];
  for (const { project_id: projectId } of campus) {
    try {
      const conexion = await conexionDelCampus(projectId);
      if (!conexion || conexion.error) continue;
      const { rows } = await query(
        `SELECT DISTINCT tc.moodle_user_id FROM tutor_campus tc JOIN users u ON u.id = tc.tutor_id
          WHERE tc.project_id = $1 AND tc.moodle_user_id IS NOT NULL AND u.consultas_disponible = false`, [projectId]);
      const params = {};
      rows.forEach((r, i) => { params[`nodisponibles[${i}]`] = Number(r.moodle_user_id); });
      await llamar(conexion, 'local_crm_disponibilidad', params, opciones);
      resultados.push({ projectId: Number(projectId), noDisponibles: rows.length });
    } catch (err) {
      logger.warn({ projectId, err: err.message }, 'consultas/plugin: no se ha podido mandar la disponibilidad al campus');
    }
  }
  return resultados;
}

// ─── El repaso: siempre al día con el campus (#679, plugin 1.8.0) ─────────────

/** Páginas por campus y repaso (200 mensajes cada una): lo que falte, en el siguiente. */
const PAGINAS_POR_REPASO = 10;

/**
 * Pone al día el CRM con un campus aunque se haya perdido algún aviso: pide al plugin los
 * mensajes privados desde el último que vio y los pasa por lo mismo que un aviso (lo
 * repetido se descarta por su id de Moodle). Además le vuelve a mandar la lista de «No
 * disponible». Apunta hasta dónde llegó, cuándo, la versión del plugin y el error si lo hay.
 *
 * `procesar(projectId, aviso)` es el mismo que el del aviso firmado (se inyecta para las pruebas).
 */
export async function sincronizarCampus(projectId, { procesar, desdeFecha = null, ...opciones } = {}) {
  // Apagado (PLUGIN_MOODLE_EN_PRODUCCION) no se llama a ningún campus: ni se lee ni se escribe.
  if (!pluginMoodleActivo()) return { projectId, omitido: 'plugin del CRM apagado (PLUGIN_MOODLE_EN_PRODUCCION)' };
  const { rows: [c] } = await query(
    'SELECT sincronizado_hasta_id FROM moodle_plugin_campus WHERE project_id = $1 AND activo', [projectId]);
  if (!c) return { projectId, omitido: 'sin plugin activo' };
  const conexion = await conexionDelCampus(projectId);
  if (!conexion || conexion.error) {
    await query('UPDATE moodle_plugin_campus SET sincronizacion_error = $2 WHERE project_id = $1',
      [projectId, conexion?.error || 'El campus no está conectado en Integraciones']);
    return { projectId, error: conexion?.error || 'sin conexión' };
  }
  let desdeId = c.sincronizado_hasta_id != null ? Number(c.sincronizado_hasta_id) : 0;
  // La primera vez, desde que se encendió «Leer las consultas» (o la última hora).
  const desde = desdeFecha ? Math.floor(new Date(desdeFecha).getTime() / 1000) : Math.floor(Date.now() / 1000) - 3600;
  const r = { projectId, mensajes: 0, nuevos: 0, paginas: 0, version: null, descartados: 0 };
  let atascado = null;
  try {
    for (let i = 0; i < PAGINAS_POR_REPASO && !atascado; i++) {
      const pagina = await llamar(conexion, 'local_crm_mensajes_desde',
        desdeId > 0 ? { desdeid: desdeId, limite: 200 } : { desdefecha: desde, limite: 200 }, opciones);
      r.paginas += 1;
      r.version = pagina?.version || r.version;
      let avisos = [];
      try { avisos = JSON.parse(pagina?.avisos || '[]'); } catch { avisos = []; }
      for (const aviso of avisos) {
        r.mensajes += 1;
        try {
          const hecho = await procesar(projectId, aviso);
          if (hecho && !['repetido', 'ignorado'].includes(hecho.resultado)) r.nuevos += 1;
        } catch (err) {
          logger.warn({ projectId, mensaje: aviso?.mensaje?.id, err: err.message }, 'consultas/plugin: un mensaje del repaso no se ha podido guardar');
          // Un aviso que no vale (400) no valdrá nunca: se sigue sin él. Cualquier otro fallo
          // (la base, un tropiezo) puede salir bien en el siguiente repaso: el cursor se queda
          // JUSTO ANTES de ese mensaje. Antes avanzaba igual y ese mensaje no volvía a pedirse
          // nunca: si además se había perdido su aviso, no llegaba al CRM.
          const idMensaje = Number(aviso?.mensaje?.id);
          if (err?.statusCode === 400 || !(idMensaje > desdeId)) {
            r.descartados += 1;
            continue;
          }
          atascado = { id: idMensaje, motivo: err.message };
          break;
        }
      }
      if (atascado) desdeId = atascado.id - 1;
      else if (Number(pagina?.hastaid) > desdeId) desdeId = Number(pagina.hastaid);
      // Hasta dónde se ha llegado, página a página: si algo corta, se sigue desde aquí.
      await query('UPDATE moodle_plugin_campus SET sincronizado_hasta_id = $2 WHERE project_id = $1', [projectId, desdeId || null]);
      if (!pagina?.mas) break;
    }
    if (atascado) {
      // Con error, el campus vuelve también a la lectura de cada 5 minutos (campusConPluginAlDia)
      // y el panel lo enseña. El siguiente repaso empieza por ese mensaje.
      const mensaje = `El mensaje ${atascado.id} del campus no se ha podido guardar (${atascado.motivo}); el próximo repaso lo vuelve a intentar.`;
      await query('UPDATE moodle_plugin_campus SET sincronizacion_error = $2, version_plugin = COALESCE($3, version_plugin) WHERE project_id = $1',
        [projectId, mensaje, r.version]);
      return { ...r, error: mensaje };
    }
    await avisarDisponibilidad([projectId], opciones);
    await query(
      `UPDATE moodle_plugin_campus SET sincronizado_at = NOW(), sincronizacion_error = NULL,
              version_plugin = COALESCE($2, version_plugin) WHERE project_id = $1`, [projectId, r.version]);
    return r;
  } catch (err) {
    // Un plugin anterior a la 1.8.0 no tiene la función: se dice qué hacer.
    // Por el código que pone el cliente de Moodle, no por las palabras del mensaje: el mensaje
    // ya viene traducido («El token no tiene permiso…») y no decía nunca «access».
    const viejo = ['PERMISO', 'SIN_FUNCION'].includes(err.codigo);
    const mensaje = viejo
      ? 'El plugin del campus es anterior a la 1.8.0: se actualizará solo esta noche (o actualízalo desde «Conectar con el CRM»).'
      : `No se ha podido repasar el campus: ${err.message}`;
    await query('UPDATE moodle_plugin_campus SET sincronizacion_error = $2 WHERE project_id = $1', [projectId, mensaje]);
    return { ...r, error: mensaje };
  }
}
