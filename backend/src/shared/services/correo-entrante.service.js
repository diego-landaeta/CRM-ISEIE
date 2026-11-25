import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from '../utils/logger.js';
import { query } from '../config/db.js';
import net from 'node:net';
import { encrypt, decrypt } from '../utils/crypto.js';
import { destinoSeguro, modoPruebasLocal } from './correo-destino.js';

/**
 * Leer los buzones de correo y guardar lo que ha llegado (CRM-ISEIE#701).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ
 *
 * Gemela de la Bandeja del 360 (CRM#146) y de sus buzones (CRM#1032). Diego,
 * 23/11: «poder conectar varios correos de Hostinger como hicimos en CEDIA», y
 * lo mismo en ISEIE. Aquí solo se LEE: el envío sigue por Brevo con su
 * plantilla (Diego, en CRM#1058), así que no hay SMTP ni copia en «Enviados».
 *
 * POR QUÉ IMAP Y NO BREVO INBOUND
 *
 * Brevo Inbound obliga a apuntar un subdominio entero a Brevo, y solo ve lo que
 * llegue por ahí: el correo normal del buzón —el que se quiere mirar— se queda
 * fuera. IMAP lee el buzón de verdad.
 *
 * LO QUE NO HACE
 *
 * No borra, no marca como leído y no mueve nada. Se abre el buzón en modo
 * SOLO LECTURA a propósito: quien lo tenga abierto en el webmail no puede
 * encontrarse con que el CRM le ha tocado sus correos. Que el CRM lea no puede
 * cambiar lo que ve una persona.
 *
 * Y NO se le pide el buzón entero cada vez: se pregunta por lo que hay desde el
 * último que se guardó. Aun así, releerlo no duplica —ver `clave`—, que es lo
 * que permite recuperarse de un corte sin llevar la cuenta por dónde iba.
 *
 * VARIOS BUZONES
 *
 * Los buzones se conectan desde el panel y viven en `correo_buzones`, con
 * servidor, puerto, usuario y contraseña cifrados (AES-256-GCM, la misma
 * `ENCRYPTION_KEY` que `api_credentials`).
 *
 * El del `.env` (`IMAP_*`) se lee SOLO si no hay ninguno activo en la base
 * (Diego, CRM#1058: «mandan los de la base»). En ISEIE no hay `SMTP_*`, así
 * que no se mira: sin `IMAP_USER` e `IMAP_PASSWORD` no hay buzón del servidor.
 */

/** Cuántos se traen de una tacada. Un buzón con años detrás no cabe en memoria. */
const TOPE = 200;

/**
 * El buzón del `.env`, o `null`. Se lee del entorno al llamar, no al cargar el
 * módulo, para que las pruebas puedan poner y quitar variables.
 */
export function buzonDelEnv() {
  const usuario = process.env.IMAP_USER || '';
  const clave = process.env.IMAP_PASSWORD || '';
  if (!usuario || !clave) return null;
  return {
    id: null,
    nombre: 'Buzón del servidor',
    direccion: usuario.toLowerCase(),
    project_id: null,
    host: process.env.IMAP_HOST || 'imap.hostinger.com',
    puerto: Number(process.env.IMAP_PORT || 993),
    usuario,
    clave,
  };
}

/** ¿Hay buzón en el `.env`? Los de la base van aparte. */
export function hayBuzonQueLeer() {
  return Boolean(buzonDelEnv());
}

/** Cifra la conexión de un buzón para guardarla. Es lo único que se escribe de ella en la base. */
export function cifrarConexion({ host, puerto, usuario, clave }) {
  const { encrypted, iv, authTag } = encrypt(JSON.stringify({ host, puerto, usuario, clave }));
  return { cifrado: encrypted, iv, auth_tag: authTag };
}

/** La conexión de una fila de `correo_buzones`, descifrada. Solo para hablar con el servidor. */
export function descifrarConexion(fila) {
  const c = JSON.parse(decrypt(fila.cifrado, fila.iv, fila.auth_tag));
  return { host: c.host, puerto: Number(c.puerto) || 993, usuario: c.usuario, clave: c.clave };
}

/**
 * Los buzones que hay que leer: los activos de la base o, si no hay ninguno, el
 * del `.env`. Con `buzonId`, solo ese (y si no está, ninguno).
 *
 * Uno que no se pueda descifrar —cambió la `ENCRYPTION_KEY`— se salta con un
 * aviso: no puede impedir que se lean los demás.
 */
export async function buzonesQueLeer({ buzonId = null } = {}) {
  const { rows } = await query(
    `SELECT id, nombre, direccion, project_id, cifrado, iv, auth_tag
       FROM correo_buzones
      WHERE activo AND ($1::int IS NULL OR id = $1::int)
      ORDER BY id`, [buzonId]);
  if (!rows.length) {
    if (buzonId) return [];
    const env = buzonDelEnv();
    return env ? [env] : [];
  }
  const lista = [];
  for (const f of rows) {
    try {
      lista.push({
        id: f.id, nombre: f.nombre, direccion: f.direccion, project_id: f.project_id,
        ...descifrarConexion(f),
      });
    } catch (err) {
      logger.warn({ buzon: f.id, err: err.message }, 'Correo entrante: no se pudo descifrar un buzón');
    }
  }
  return lista;
}

/**
 * Las opciones de ImapFlow para un buzón. El 993 es TLS directo (Hostinger);
 * cualquier otro puerto, STARTTLS obligatorio: la contraseña no viaja en claro.
 * Solo fuera de producción y con `CORREO_IMAP_SIN_TLS=1` se admite sin cifrar,
 * para un servidor de pruebas local.
 */
export function opcionesImap({ host, puerto, usuario, clave }, extra = {}) {
  const port = Number(puerto) || 993;
  const tlsDirecto = port === 993;
  const sinTls = !tlsDirecto && modoPruebasLocal();
  const opciones = {
    host, port, secure: tlsDirecto,
    auth: { user: usuario, pass: clave },
    logger: false,
    ...extra,
  };
  if (!tlsDirecto) opciones.doSTARTTLS = !sinTls;
  return opciones;
}

/**
 * La clave de idempotencia de un correo que entra.
 *
 * Es el `Message-ID`, que lo pone quien manda y no cambia nunca. Con el índice
 * único que ya tiene la columna, leer el buzón dos veces no duplica nada.
 *
 * Si un correo llegara sin Message-ID —raro, pero los hay— se compone uno con
 * lo que sí tiene. Dos correos distintos del mismo remitente, en el mismo
 * segundo y con el mismo asunto son, a todos los efectos, el mismo.
 *
 * Con `buzon` (la dirección de un buzón de la base, CRM#1032) la clave lleva la
 * dirección delante: un correo con copia a dos buzones conectados tiene que
 * salir en los dos. Sin ella —el buzón del `.env`— es la de siempre.
 */
export function claveDeEntrada({ messageId, de, asunto, fecha }, buzon = null) {
  const prefijo = buzon ? `entrada:${String(buzon).toLowerCase()}:` : 'entrada:';
  if (messageId) return `${prefijo}${messageId}`.slice(0, 500);
  const cuando = fecha instanceof Date ? fecha.toISOString() : String(fecha || '');
  return `${prefijo}sin-id:${de || '?'}:${cuando}:${asunto || ''}`.slice(0, 500);
}

/** La dirección de un `from` de mailparser, que llega como objeto. */
function direccionDe(campo) {
  const uno = campo?.value?.[0];
  return uno?.address || campo?.text || null;
}

/** Los destinatarios, en la cadena que usa el resto de la tabla. */
function destinatariosDe(mensaje, buzon) {
  const de = (c) => (c?.value || []).map((v) => v.address).filter(Boolean);
  const todos = [...de(mensaje.to), ...de(mensaje.cc)];
  // Si un correo no dice a quién va —copia oculta— el destinatario somos
  // nosotros, que para eso ha llegado a este buzón.
  return todos.length ? todos.join(',') : buzon.usuario;
}

/**
 * Guarda uno. Devuelve `true` si era nuevo.
 *
 * `ON CONFLICT DO NOTHING` sobre la clave: releer el buzón no duplica y no hay
 * que consultar antes si ya estaba.
 *
 * Un buzón de la base que ya se leía por el `.env` (el de facturación de CEDIA,
 * al pasarlo al panel) encontraría sus correos guardados con la clave de
 * antes: se ADOPTAN —se les pone el buzón y la clave nueva— en vez de
 * guardarlos otra vez.
 */
export async function guardar(mensaje, buzon) {
  const de = direccionDe(mensaje.from);
  const datos = { messageId: mensaje.messageId, de, asunto: mensaje.subject, fecha: mensaje.date };
  const clave = claveDeEntrada(datos, buzon.id ? buzon.direccion : null);

  if (buzon.id) {
    const antigua = claveDeEntrada(datos);
    const { rowCount: adoptados } = await query(
      `UPDATE email_envios SET buzon_id = $1, clave = $2,
              project_id = COALESCE(project_id, $4::int)
        WHERE clave = $3 AND direccion = 'entrada' AND buzon_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM email_envios WHERE clave = $2)`,
      [buzon.id, clave, antigua, buzon.project_id ?? null]);
    if (adoptados > 0) return false;
  }

  const { rowCount } = await query(
    `INSERT INTO email_envios
       (clave, direccion, remitente, destinatarios, asunto, cuerpo_html,
        estado, intentos, created_at, buzon_id, project_id)
     VALUES ($1, 'entrada', $2, $3, $4, $5, 'recibido', 1, $6, $7, $8)
     -- El WHERE no sobra: el indice unico de clave es PARCIAL —solo cuando no
     -- es nula, porque casi ningun envio lleva clave— y Postgres no lo reconoce
     -- si no se le repite aqui la misma condicion.
     ON CONFLICT (clave) WHERE clave IS NOT NULL DO NOTHING`,
    [
      clave,
      de,
      destinatariosDe(mensaje, buzon),
      mensaje.subject || '(sin asunto)',
      // El HTML si lo trae; si no, el texto plano envuelto, que es lo que hay.
      // `textAsHtml` lo da ya escapado, así que un correo no puede meter
      // etiquetas en la pantalla por venir en texto.
      mensaje.html || mensaje.textAsHtml || '',
      mensaje.date || new Date(),
      buzon.id || null,
      // El campus del buzón, para que cada admin vea los de los suyos.
      buzon.project_id ?? null,
    ],
  );
  return rowCount > 0;
}

/** Anota en el buzón de la base cómo fue la última lectura. El del `.env` no tiene fila. */
async function anotarResultado(buzon, ok, error = null) {
  if (!buzon.id) return;
  try {
    await query(
      `UPDATE correo_buzones
          SET ultima_lectura_at = NOW(), ultimo_resultado = $2, ultimo_error = $3
        WHERE id = $1`,
      [buzon.id, ok ? 'ok' : 'error', error]);
  } catch (err) {
    logger.warn({ err: err.message, buzon: buzon.id }, 'Correo entrante: no se pudo anotar el resultado');
  }
}

/**
 * Por qué no se pudo conectar, en palabras de la pantalla. El mensaje crudo del
 * servidor va al registro del servidor, no aquí.
 */
export function motivoDeFallo(err) {
  if (err?.authenticationFailed) return 'El usuario o la contraseña no son correctos.';
  const code = err?.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'No se encuentra ese servidor.';
  if (code === 'ECONNREFUSED') return 'El servidor no acepta conexiones en ese puerto.';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(err?.message || '')) {
    return 'El servidor no contesta.';
  }
  if (/certificate|self.signed|tls|ssl/i.test(err?.message || '')) {
    return 'Falla la conexión segura (TLS) con el servidor.';
  }
  return 'No se pudo conectar con el buzón.';
}

/**
 * Un cliente IMAP que no tumba la API si se corta la red.
 *
 * Se conecta a `ip`, la ya comprobada por `destinoSeguro`, y no al nombre:
 * resolverlo otra vez al conectar dejaría pasar un DNS que cambia de respuesta
 * entre la comprobación y la conexión. El nombre va como `servername` para
 * que el certificado TLS se compruebe contra él.
 */
function nuevoCliente(buzon, ip, extra = {}) {
  const servername = net.isIP(buzon.host) ? undefined : buzon.host;
  const cliente = new ImapFlow(opcionesImap(
    { ...buzon, host: ip },
    { ...(servername ? { servername } : {}), ...extra },
  ));

  // UN CORTE DE RED NO ES UN FALLO DE PROGRAMACION.
  //
  // ImapFlow avisa de los cortes por el evento 'error', no rechazando la
  // promesa que se esta esperando. Sin nadie escuchandolo, Node lo trata como
  // excepcion sin capturar y el manejador de app.js cierra el proceso a
  // proposito: un ECONNRESET del servidor de correo tumbaba la API entera, y
  // el try/catch de aqui abajo no lo veia pasar.
  //
  // Va ANTES de connect() a proposito. Puesto despues, un corte durante el
  // propio connect vuelve a tumbarlo — y esa ventana es justo la que falla
  // cuando el servidor de correo va mal.
  //
  // Anotar basta: el fallo real lo sigue recogiendo el catch de siempre
  // cuando la operacion en curso se rompe.
  cliente.on('error', (err) => {
    logger.warn({ err: err?.message, host: buzon.host }, 'Correo entrante: la conexion IMAP se corto');
  });
  return cliente;
}

/**
 * «Probar conexión» (CRM#1032): entra, abre la bandeja en solo lectura y sale. No
 * guarda nada ni lee correos. NUNCA lanza.
 */
export async function probarConexion(buzon) {
  // Puerto e IP, antes de abrir nada (ver `correo-destino.js`).
  const destino = await destinoSeguro(buzon);
  if (!destino.ok) return { ok: false, motivo: destino.motivo };
  let cliente;
  try {
    cliente = nuevoCliente(buzon, destino.ip, { connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000 });
    await cliente.connect();
    const caja = await cliente.mailboxOpen('INBOX', { readOnly: true });
    await cliente.logout();
    cliente = null;
    return { ok: true, mensajes: Number(caja?.exists ?? 0) };
  } catch (err) {
    logger.warn({ err: err.message, host: buzon.host }, 'Correo entrante: la prueba de conexion fallo');
    return { ok: false, motivo: motivoDeFallo(err) };
  } finally {
    try { await cliente?.logout(); } catch { /* da igual */ }
  }
}

/**
 * Lee UN buzón y guarda lo nuevo. Devuelve `{ leidos, nuevos }` o, si falla,
 * `{ leidos: 0, nuevos: 0, motivo: 'ERROR', detalle }`. NUNCA lanza.
 */
export async function leerUnBuzon(buzon, { desde = null } = {}) {
  // Lo mismo al leer que al probar: un buzón guardado antes de la regla, o con
  // un nombre que ahora apunta dentro, no se lee.
  const destino = await destinoSeguro(buzon);
  if (!destino.ok) {
    logger.warn({ buzon: buzon.id, motivo: destino.motivo }, 'Correo entrante: destino no permitido');
    await anotarResultado(buzon, false, destino.motivo);
    return { leidos: 0, nuevos: 0, motivo: 'ERROR', detalle: destino.motivo };
  }
  let cliente;
  try {
    cliente = nuevoCliente(buzon, destino.ip);
    await cliente.connect();

    // SOLO LECTURA. Sin esto, abrir el buzón marca correos como vistos y a
    // quien lo tenga abierto en el webmail le desaparecen los no leídos.
    await cliente.mailboxOpen('INBOX', { readOnly: true });

    // Desde el último que se guardó DE ESTE BUZÓN, no desde el principio. Se
    // resta un día de margen: `SINCE` va por días y el reloj del servidor no es
    // el nuestro.
    const corte = desde || await ultimaEntrada(buzon.id);
    const criterio = corte
      ? { since: new Date(corte.getTime() - 24 * 60 * 60 * 1000) }
      : { all: true };

    const uids = await cliente.search(criterio, { uid: true });
    if (!uids || !uids.length) {
      await anotarResultado(buzon, true);
      return { leidos: 0, nuevos: 0 };
    }

    // Los más recientes. Un buzón de años no cabe de una vez, y lo que interesa
    // es lo último.
    const aLeer = uids.slice(-TOPE);

    // Se recoge TODO antes de tocar la base: imapflow no admite otro comando
    // mientras el `fetch` sigue abierto y se queda colgado sin decir nada.
    const crudos = [];
    for await (const m of cliente.fetch(aLeer, { source: true }, { uid: true })) {
      if (m.source) crudos.push(m.source);
    }
    await cliente.logout();
    cliente = null;

    let nuevos = 0;
    for (const crudo of crudos) {
      try {
        if (await guardar(await simpleParser(crudo), buzon)) nuevos += 1;
      } catch (err) {
        // Un correo raro —un adjunto roto, una codificación imposible— no puede
        // impedir que se guarden los otros doscientos.
        logger.warn({ err: err.message }, 'Correo entrante: uno no se pudo leer');
      }
    }

    await anotarResultado(buzon, true);
    logger.info({ buzon: buzon.id, leidos: crudos.length, nuevos }, 'Correo entrante: buzón leído');
    return { leidos: crudos.length, nuevos };
  } catch (err) {
    logger.warn({ err: err.message, host: buzon.host, buzon: buzon.id }, 'Correo entrante: no se pudo leer el buzón');
    const detalle = motivoDeFallo(err);
    await anotarResultado(buzon, false, detalle);
    return { leidos: 0, nuevos: 0, motivo: 'ERROR', detalle };
  } finally {
    try { await cliente?.logout(); } catch { /* da igual */ }
  }
}

/**
 * Lee los buzones y guarda lo nuevo. Devuelve `{ leidos, nuevos, buzones }`,
 * con el resultado de cada uno en `buzones`. Con `buzonId`, solo ese.
 *
 * NUNCA lanza: esto lo llama un cron y una pantalla, y que un buzón esté caído
 * no puede tumbar ninguno de los dos — ni impedir que se lean los demás.
 */
export async function leerBuzon({ desde = null, buzonId = null } = {}) {
  let lista;
  try {
    lista = await buzonesQueLeer({ buzonId });
  } catch (err) {
    // Sin la tabla (migración sin aplicar) o sin base: el buzón del `.env`,
    // como antes de la CRM#1032.
    logger.warn({ err: err.message }, 'Correo entrante: no se pudieron leer los buzones de la base');
    const env = buzonId ? null : buzonDelEnv();
    lista = env ? [env] : [];
  }
  if (!lista.length) return { leidos: 0, nuevos: 0, motivo: 'SIN_BUZON', buzones: [] };

  const buzones = [];
  let leidos = 0;
  let nuevos = 0;
  for (const b of lista) {
    const r = await leerUnBuzon(b, { desde });
    leidos += r.leidos;
    nuevos += r.nuevos;
    buzones.push({ id: b.id, nombre: b.nombre, direccion: b.direccion, ...r });
  }
  const res = { leidos, nuevos, buzones };
  // Si fallaron TODOS, se dice como antes; si falló alguno, va en `buzones`.
  if (buzones.every((b) => b.motivo === 'ERROR')) {
    res.motivo = 'ERROR';
    res.detalle = buzones[0].detalle;
  }
  return res;
}

/** La fecha del último correo entrante guardado de un buzón (`null`: el del `.env`). */
async function ultimaEntrada(buzonId = null) {
  const { rows } = await query(
    `SELECT MAX(created_at) AS ultima FROM email_envios
      WHERE direccion = 'entrada' AND buzon_id IS NOT DISTINCT FROM $1::int`, [buzonId]);
  return rows[0]?.ultima || null;
}
