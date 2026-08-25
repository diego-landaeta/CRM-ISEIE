import { query } from '../../shared/config/db.js';
import { normalizePhone, phoneCanonical } from '../../shared/utils/normalizePhone.js';
import { logger } from '../../shared/utils/logger.js';

// Las conversaciones de WhatsApp. Antes esto no existia: se veian en el
// navegador remoto y se perdian. Ahora viven aqui, y por eso se pueden buscar,
// ver en la ficha del lead y contar.

/** De 5511999999999@s.whatsapp.net saca el numero. */
export const jidATelefono = (jid) => normalizePhone(String(jid || '').split('@')[0]);

/**
 * Busca el lead que tenga ese telefono. Compara con phoneCanonical, que es lo
 * que ya usa el CRM para deduplicar: asi un +5215512345678 y un +525512345678
 * —el mismo movil mexicano con y sin el 1— se reconocen como la misma persona.
 */
export async function leadPorTelefono(telefono, projectId = null) {
  const canonico = phoneCanonical(telefono);
  if (!canonico) return null;

  // Se comparan los ULTIMOS 9 digitos, no el numero entero. Los leads
  // importados de Excel vienen muchas veces sin prefijo de pais («600123456»)
  // mientras que WhatsApp siempre lo manda («+34600123456»): comparar completo
  // no casaria ninguno de esos, que son justo los 1.664 de Psiko.
  //
  // Nueve digitos es la parte nacional en España, Mexico, Colombia, Argentina y
  // Venezuela. Con menos habria falsos positivos.
  const cola = canonico.replace(/[^0-9]/g, '').slice(-9);
  if (cola.length < 9) return null;

  const params = [cola];
  let filtro = '';
  if (projectId) { params.push(projectId); filtro = `AND l.project_id = $2`; }

  const { rows } = await query(
    `SELECT l.id, l.project_id, l.nombre
       FROM leads l
      WHERE l.deleted_at IS NULL
        AND COALESCE(l.telefono, '') <> ''
        AND right(regexp_replace(l.telefono, '[^0-9]', '', 'g'), 9) = $1
        ${filtro}
      ORDER BY l.created_at DESC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/** La conversacion de este numero, creandola si es la primera vez. */
export async function conversacionDe({ instancia, jid, nombrePush, avatarUrl }) {
  const esGrupo = String(jid).endsWith('@g.us');
  // Un `@lid` no es un telefono: es un identificador de WhatsApp. Buscar un
  // prospecto con ese numero no encontraria nada y ademas podria cruzarse con
  // el telefono de otra persona por casualidad.
  const esIdentificador = String(jid).endsWith('@lid');
  // En un grupo el identificador no es un telefono, asi que no se normaliza ni
  // se busca prospecto: no hay una persona detras a la que atarlo.
  const telefono = (esGrupo || esIdentificador)
    ? String(jid).split('@')[0]
    : (jidATelefono(jid) || jid);
  const lead = (esGrupo || esIdentificador) ? null : await leadPorTelefono(telefono);

  const { rows } = await query(
    `INSERT INTO wa_conversaciones (instancia, jid, telefono, nombre_push, avatar_url, lead_id, project_id, ultimo_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (instancia, jid) DO UPDATE
       SET nombre_push = COALESCE(EXCLUDED.nombre_push, wa_conversaciones.nombre_push),
           -- La foto caduca, asi que la nueva manda; pero si viene vacia se
           -- conserva la que habia en vez de dejar el hueco.
           avatar_url  = COALESCE(EXCLUDED.avatar_url, wa_conversaciones.avatar_url),
           -- Si el lead aparece despues (se creo el prospecto mas tarde), se
           -- ata solo. Pero nunca se desata uno ya atado.
           lead_id     = COALESCE(wa_conversaciones.lead_id, EXCLUDED.lead_id),
           project_id  = COALESCE(wa_conversaciones.project_id, EXCLUDED.project_id),
           ultimo_at   = NOW()
     RETURNING *`,
    [instancia, jid, telefono, nombrePush || null, avatarUrl || null,
     lead?.id || null, lead?.project_id || null]
  );
  return rows[0];
}

/**
 * Guarda un mensaje. Si ya estaba (mismo wa_id) no hace nada y devuelve null:
 * Evolution reintenta el webhook cuando el CRM tarda en contestar, y sin esto
 * el mismo mensaje saldria dos veces en el chat.
 */
export async function guardarMensaje({ conversacionId, waId, direccion, tipo, texto, mediaUrl, mediaMime, nombreArchivo, estado, enviadoPor, ts, respondeA }) {
  // La columna de la cita solo entra si la migracion 130 esta aplicada. Si no,
  // el mensaje se guarda igual y lo unico que se pierde es saber a que
  // contestaba — perderlo entero seria mucho peor.
  const conCita = respondeA && await puedeGuardarCita();
  const { rows } = await query(
    `INSERT INTO wa_mensajes
       (conversacion_id, wa_id, direccion, tipo, texto, media_url, media_mime, nombre_archivo, estado, enviado_por, ts${conCita ? ', responde_a' : ''})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${conCita ? ', $12' : ''})
     ON CONFLICT (wa_id) WHERE wa_id IS NOT NULL DO UPDATE SET
       -- Se COMPLETA la fila, no se pisa.
       --
       -- Un mensaje que sale llega por dos sitios casi a la vez: lo guarda el
       -- propio envio y lo guarda el aviso que devuelve WhatsApp. Ganaba el
       -- aviso por unas decimas y el envio se quedaba sin fila —«DO NOTHING»—,
       -- asi que la pantalla no recibia fila y el mensaje recien mandado
       -- no aparecia hasta la siguiente vuelta.
       --
       -- Y lo que traia el envio no lo sabe el aviso: QUIEN lo mando, la copia
       -- del adjunto y a que mensaje contestaba. Con COALESCE se rellena lo que
       -- falte sin tocar lo que ya tenga valor, venga por donde venga.
       enviado_por    = COALESCE(wa_mensajes.enviado_por, EXCLUDED.enviado_por),
       media_url      = COALESCE(wa_mensajes.media_url, EXCLUDED.media_url),
       media_mime     = COALESCE(wa_mensajes.media_mime, EXCLUDED.media_mime),
       nombre_archivo = COALESCE(wa_mensajes.nombre_archivo, EXCLUDED.nombre_archivo),
       texto          = COALESCE(wa_mensajes.texto, EXCLUDED.texto),
       -- El estado si avanza: «enviado» pisa a un hueco, y los acuses posteriores
       -- lo mueven a entregado o leido por su propio camino.
       estado         = COALESCE(EXCLUDED.estado, wa_mensajes.estado)
     RETURNING *`,
    [conversacionId, waId || null, direccion, tipo || 'texto', texto || null,
     mediaUrl || null, mediaMime || null, nombreArchivo || null, estado || null,
     enviadoPor || null, ts || new Date(), ...(conCita ? [respondeA] : [])]
  );
  const fila = rows[0] || null;
  if (fila) {
    await query(
      // Solo cuenta como «sin leer» lo que llega DE VERDAD ahora, no el
      // historial. Al emparejar entran miles de mensajes viejos y salian
      // contadores de 1.320 sin leer en conversaciones que ya habias leido
      // hace meses en el movil.
      `UPDATE wa_conversaciones
          SET ultimo_at = GREATEST(COALESCE(ultimo_at, $2), $2),
              no_leidos = CASE
                WHEN $3 = 'entrante' AND $2 > NOW() - INTERVAL '2 minutes'
                THEN no_leidos + 1 ELSE no_leidos END
        WHERE id = $1`,
      [conversacionId, fila.ts, direccion]
    );
  }
  return fila;
}

export async function listar({ instancia, projectId = null, limite = 50 }) {
  const params = [instancia];
  let filtro = '';
  if (projectId) { params.push(projectId); filtro = `AND (c.project_id = $${params.length} OR c.project_id IS NULL)`; }
  params.push(Math.min(200, limite));
  const { rows } = await query(
    `SELECT c.*, l.nombre AS lead_nombre, l.status AS lead_status,
            (SELECT p.nombre FROM projects p WHERE p.id = c.project_id) AS proyecto_nombre,
            (c.jid LIKE '%@g.us') AS es_grupo,
            -- El ultimo mensaje, con su tipo: si fue una foto o un audio no hay
            -- texto que ensenar, y la lista caia a pintar el telefono — o el
            -- identificador del grupo, que son 18 cifras sin ningun sentido.
            (SELECT m.texto FROM wa_mensajes m
              WHERE m.conversacion_id = c.id ORDER BY m.ts DESC, m.id DESC LIMIT 1) AS ultimo_texto,
            (SELECT m.tipo FROM wa_mensajes m
              WHERE m.conversacion_id = c.id ORDER BY m.ts DESC, m.id DESC LIMIT 1) AS ultimo_tipo
       FROM wa_conversaciones c
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.instancia = $1 ${filtro}
      ORDER BY c.ultimo_at DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function mensajes(conversacionId, limite = 100) {
  // La cita se resuelve aqui: se busca el mensaje citado por su wa_id DENTRO de
  // la misma conversacion. Puede no estar —alguien responde a algo de antes de
  // enlazar— y entonces se pinta sin cita, que es mejor que no pintar nada.
  //
  // Las columnas de la cita solo se piden si la migracion 130 esta aplicada;
  // pedirlas sin estarlo tumbaria el hilo entero.
  const conCita = await puedeGuardarCita();
  const columnasCita = conCita ? `,
            m.responde_a,
            (SELECT q.texto FROM wa_mensajes q
              WHERE q.wa_id = m.responde_a AND q.conversacion_id = m.conversacion_id
              LIMIT 1) AS citado_texto,
            (SELECT q.tipo FROM wa_mensajes q
              WHERE q.wa_id = m.responde_a AND q.conversacion_id = m.conversacion_id
              LIMIT 1) AS citado_tipo,
            (SELECT q.direccion FROM wa_mensajes q
              WHERE q.wa_id = m.responde_a AND q.conversacion_id = m.conversacion_id
              LIMIT 1) AS citado_direccion` : '';

  const { rows } = await query(
    `SELECT m.id, m.wa_id, m.direccion, m.tipo, m.texto, m.media_url, m.media_mime,
            m.nombre_archivo, m.estado, m.enviado_por, m.ts${columnasCita}
       FROM wa_mensajes m
      WHERE m.conversacion_id = $1
      -- Se desempata por id porque WhatsApp da la hora en SEGUNDOS: tres
      -- mensajes seguidos comparten marca y sin esto salen en cualquier orden.
      ORDER BY m.ts DESC, m.id DESC LIMIT $2`,
    [conversacionId, Math.min(500, limite)]
  );
  return rows.reverse();
}

export const porId = async (id) =>
  // es_grupo hace falta AQUI tambien, no solo en la lista: la cabecera del chat
  // lo usa para decidir que ensena debajo del nombre, y sin el pintaba el
  // identificador del grupo —un numero de 18 cifras— como si fuera un telefono.
  (await query(
    `SELECT c.*, (c.jid LIKE '%@g.us') AS es_grupo
       FROM wa_conversaciones c WHERE c.id = $1`, [id]
  )).rows[0] || null;

export const marcarLeida = (id) =>
  query('UPDATE wa_conversaciones SET no_leidos = 0 WHERE id = $1', [id]);

/** «No me escribas mas». A partir de aqui el CRM se niega a enviar. */
export const noEscribir = (id, motivo) =>
  query('UPDATE wa_conversaciones SET no_escribir = TRUE, motivo_no_escribir = $2 WHERE id = $1', [id, motivo || null]);

/** Cuantos mensajes se han mandado desde esta instancia en los ultimos N minutos. */
export async function salientesRecientes(instancia, minutos) {
  const { rows } = await query(
    `SELECT COUNT(*)::int n
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
      WHERE c.instancia = $1 AND m.direccion = 'saliente'
        -- Solo lo que ha mandado el CRM. Y esto no es un detalle: al enlazar,
        -- todo lo que esa persona escribio desde su MOVIL entra como saliente,
        -- y el freno lo contaba como si lo hubiera disparado el CRM. Con 341
        -- mensajes de su propio historial ya saltaba «llevas 341 hoy, se retoma
        -- manana» sin haber enviado ni uno. Lo enviado desde aqui lleva firma:
        -- enviado_por.
        AND m.enviado_por IS NOT NULL
        AND m.ts > NOW() - ($2 || ' minutes')::interval`,
    [instancia, String(minutos)]
  );
  return rows[0].n;
}

/**
 * El acuse de WhatsApp. Solo avanza: si ya esta «leido» no vuelve a «entregado»
 * porque los acuses pueden llegar desordenados.
 */
export async function actualizarEstado(waId, estado) {
  const orden = { enviado: 1, entregado: 2, leido: 3, fallido: 9 };
  await query(
    `UPDATE wa_mensajes SET estado = $2
      WHERE wa_id = $1
        AND direccion = 'saliente'
        AND COALESCE(CASE estado WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2
                                 WHEN 'leido' THEN 3 WHEN 'fallido' THEN 9 ELSE 0 END, 0) < $3`,
    [waId, estado, orden[estado] || 0]
  );
}

/** El ultimo entrante, para decirle a WhatsApp que ya se leyo. */
export async function ultimoEntranteSinLeer(conversacionId) {
  const { rows } = await query(
    `SELECT wa_id FROM wa_mensajes
      WHERE conversacion_id = $1 AND direccion = 'entrante' AND wa_id IS NOT NULL
      ORDER BY ts DESC LIMIT 1`,
    [conversacionId]
  );
  return rows[0] || null;
}

/** Un mensaje con su conversacion, para servir el adjunto comprobando permisos. */
export async function mensajeConAdjunto(id) {
  const { rows } = await query(
    `SELECT m.id, m.media_url, m.media_mime, m.nombre_archivo, c.project_id, c.instancia
       FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id
      WHERE m.id = $1 AND m.media_url IS NOT NULL`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Deja escrito que se acepto enlazar un numero.
 *
 * `userId` es de quien es la linea; `aceptadoPor`, quien pulso. Casi siempre el
 * mismo — pero un administrador puede enlazar el numero de una gestora que
 * tiene al lado, y entonces ella NO leyo el aviso. Esa diferencia es justo lo
 * que hay que poder ver despues.
 *
 * No revienta si la tabla no existe todavia: la migracion 129 la aplica Diego, y
 * hasta entonces el aviso con casilla ya funciona. Lo que falta es el registro,
 * no la advertencia — y dejar WhatsApp inservible por eso seria peor.
 */
export async function apuntarConsentimiento({ userId, aceptadoPor, instancia, versionAviso = 1, ip, navegador }) {
  try {
    await query(
      `INSERT INTO wa_consentimientos
         (user_id, aceptado_por, instancia, version_aviso, ip, navegador)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, aceptadoPor, instancia, versionAviso, ip || null, navegador || null]
    );
    return true;
  } catch (err) {
    if (err.code === '42P01') return false;   // la tabla aun no esta
    throw err;
  }
}

/** ¿Cuando acepto esta persona por ultima vez, y quien pulso? */
export async function ultimoConsentimiento(userId) {
  try {
    const { rows } = await query(
      `SELECT c.aceptado_at, c.version_aviso, c.aceptado_por, u.nombre AS acepto_nombre
         FROM wa_consentimientos c
         LEFT JOIN users u ON u.id = c.aceptado_por
        WHERE c.user_id = $1
        ORDER BY c.aceptado_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

/**
 * Quita de las conversaciones el nombre del duenno de la sesion.
 *
 * `pushName` es el nombre de QUIEN ESCRIBE, y en un mensaje que mandas tu ese
 * eres tu: a cualquier contacto que no estuviera en tu agenda se le ponia tu
 * propio nombre en cuanto le escribias. Ya no se guarda asi, pero lo que quedo
 * mal no se arregla solo — el nombre se conserva cuando el nuevo llega vacio,
 * que es justo lo que pasa ahora.
 *
 * Se respeta el chat de uno consigo mismo, donde ese nombre SI es el correcto.
 */
export async function limpiarNombrePropio(instancia, miNombre, miNumero) {
  if (!miNombre) return 0;
  const { rowCount } = await query(
    `UPDATE wa_conversaciones
        SET nombre_push = NULL
      WHERE instancia = $1
        AND lower(btrim(nombre_push)) = lower(btrim($2))
        AND jid NOT LIKE $3`,
    [instancia, miNombre, `${String(miNumero || '').replace(/[^0-9]/g, '')}@%`]
  );
  return rowCount || 0;
}

/**
 * Pone al dia los nombres desde la agenda de WhatsApp.
 *
 * La agenda es la fuente buena: son tus contactos y los nombres reales de los
 * grupos. Lo guardado puede estar mal —un grupo con el nombre del ultimo que
 * escribio, por ejemplo— y eso no se arregla solo, porque al guardar se
 * conserva lo viejo cuando lo nuevo llega vacio.
 *
 * Solo toca lo que NO coincide, asi que casi siempre no escribe nada.
 */
export async function refrescarNombres(instancia, pares) {
  if (!pares?.length) return 0;
  const jids = pares.map((p) => p.jid);
  const nombres = pares.map((p) => p.nombre);
  const { rowCount } = await query(
    `UPDATE wa_conversaciones c
        SET nombre_push = n.nombre
       FROM (SELECT unnest($2::text[]) AS jid, unnest($3::text[]) AS nombre) n
      WHERE c.instancia = $1
        AND c.jid = n.jid
        AND n.nombre <> ''
        AND c.nombre_push IS DISTINCT FROM n.nombre`,
    [instancia, jids, nombres]
  );
  return rowCount || 0;
}

/**
 * ¿Esta aplicada la migracion 130?
 *
 * Se pregunta UNA vez y se recuerda. Meter la columna en el INSERT sin
 * comprobarlo reventaria el guardado de TODOS los mensajes mientras la
 * migracion no este aplicada — y esa la aprueba Diego, no yo. Vale mas perder
 * la cita que perder los mensajes.
 */
let hayColumnaResponde = null;
export async function puedeGuardarCita() {
  if (hayColumnaResponde !== null) return hayColumnaResponde;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'wa_mensajes' AND column_name = 'responde_a'`
    );
    hayColumnaResponde = rows.length > 0;
  } catch {
    hayColumnaResponde = false;
  }
  return hayColumnaResponde;
}

/**
 * Borra las conversaciones guardadas de una sesion.
 *
 * Desvincular solo cerraba la sesion en WhatsApp; lo que el CRM ya tenia se
 * quedaba. Asi que enlazar de nuevo con «empezar de cero» devolvia los chats
 * de siempre, y quien lo hacia esperando empezar limpio no entendia nada:
 * «cero» era cero para WhatsApp, no para el CRM.
 *
 * Devuelve las rutas de los adjuntos para poder borrarlos tambien del disco:
 * si se dejan, quedan ficheros de conversaciones que ya no existen.
 */
export async function borrarConversaciones(instancia) {
  const { rows: archivos } = await query(
    `SELECT m.media_url FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
      WHERE c.instancia = $1 AND m.media_url IS NOT NULL`,
    [instancia]
  );
  // Los mensajes se van con la conversacion: la clave ajena es ON DELETE CASCADE.
  const { rowCount } = await query('DELETE FROM wa_conversaciones WHERE instancia = $1', [instancia]);
  return { conversaciones: rowCount || 0, archivos: archivos.map((a) => a.media_url) };
}

/** Apunta el archivo que se acaba de bajar para un mensaje. */
export async function guardarAdjunto(id, { ruta, mime, nombreArchivo }) {
  await query(
    `UPDATE wa_mensajes
        SET media_url = $2, media_mime = COALESCE($3, media_mime),
            nombre_archivo = COALESCE(nombre_archivo, $4)
      WHERE id = $1`,
    [id, ruta, mime, nombreArchivo]
  );
}

/**
 * Deja escrito que alguien entro a mirar el WhatsApp de otra persona.
 *
 * Un administrador puede abrir la sesion de una gestora — hace falta para
 * ayudarla y para supervisar. Pero son sus conversaciones con clientes, y
 * algunas seran personales: que se pueda mirar sin dejar rastro es lo que
 * convierte una herramienta de trabajo en una de vigilancia.
 *
 * Va a `user_activity_log`, que ya existe y ya usa auth. No hace falta tabla
 * nueva ni migracion — o sea que esto funciona esté como esté la base.
 *
 * SE LIMITA A UNA CADA MEDIA HORA por pareja (quien mira, a quien mira). La
 * pantalla del chat pregunta cada pocos segundos: sin el freno, una tarde
 * mirando dejaria miles de filas y el registro no serviria para leerlo, que es
 * justo para lo que esta.
 */
const MIRADAS_TTL_MS = 1800000;
const miradas = new Map();   // "quien>aquien" -> milisegundos de la ultima apuntada

export async function apuntarMirada({ quienMira, aQuien, ip }) {
  if (!quienMira || !aQuien || quienMira === aQuien) return false;
  const clave = `${quienMira}>${aQuien}`;
  const ultima = miradas.get(clave);
  if (ultima && Date.now() - ultima < MIRADAS_TTL_MS) return false;
  miradas.set(clave, Date.now());
  try {
    await query(
      `INSERT INTO user_activity_log (user_id, action, details, ip_address)
       VALUES ($1, 'whatsapp.mirar_sesion', $2, $3)`,
      [quienMira, JSON.stringify({ gestora: aQuien }), ip || null]
    );
    return true;
  } catch (err) {
    // Que no se pueda apuntar no puede dejar sin trabajar a quien esta
    // ayudando a una gestora. Se avisa al registro del servidor y se sigue.
    logger.warn({ quienMira, aQuien, err: err.message }, 'WhatsApp: no se pudo apuntar quien miro la sesion');
    return false;
  }
}

/**
 * Apunta la llamada en la ficha del prospecto.
 *
 * El chat guarda la conversacion; la ficha guarda el HISTORIAL DE CONTACTO, y
 * son cosas distintas. Quien abre a un prospecto para ver por donde va no entra
 * en WhatsApp: mira su lista de contactos, y hasta ahora las llamadas no
 * estaban ahi — ni las que entraban ni las que salian.
 *
 * `created_by` es NOT NULL y en una llamada entrante no hay ningun usuario del
 * CRM detras. Se apunta a nombre de la gestora cuya linea la recibio, que es
 * quien de verdad tuvo el contacto.
 *
 * SQL directo y no un import del modulo de leads: este modulo ya consulta la
 * tabla de leads por su cuenta (ver leadPorTelefono) y atarlos crearia una
 * dependencia entre modulos que hoy no existe.
 */
export async function apuntarInteraccion({ leadId, nota, userId, fecha }) {
  if (!leadId || !userId) return null;
  const { rows } = await query(
    `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
     VALUES ($1, 'llamada', $2, $3, COALESCE($4::timestamptz, NOW()))
     RETURNING id`,
    [leadId, nota, userId, fecha || null]
  );
  return rows[0] || null;
}

/**
 * ¿Esta sesion ha llegado a enlazarse alguna vez?
 *
 * `EXISTS` y no `COUNT`: para saber si hay alguna, Postgres para en la primera
 * que encuentra en vez de recorrerlas todas. Con sesiones de 380.000 mensajes
 * la diferencia no es teorica.
 */
export async function hayConversaciones(instancia) {
  const { rows } = await query(
    'SELECT EXISTS (SELECT 1 FROM wa_conversaciones WHERE instancia = $1) AS hay',
    [instancia]
  );
  return Boolean(rows[0]?.hay);
}

/**
 * Un mensaje por su identificador de WhatsApp.
 *
 * Hace falta al responder citando: Evolution quiere saber si el mensaje citado
 * era nuestro y que decia, no solo su identificador.
 */
export async function mensajePorWaId(waId) {
  const { rows } = await query(
    `SELECT id, wa_id, direccion, tipo, texto FROM wa_mensajes WHERE wa_id = $1 LIMIT 1`,
    [waId]
  );
  return rows[0] || null;
}

/** Un mensaje con lo justo para volver a pedirle el adjunto a WhatsApp. */
export async function mensajePorId(id) {
  const { rows } = await query(
    `SELECT m.id, m.wa_id, m.direccion, m.tipo, m.media_url, c.jid, c.instancia
       FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id
      WHERE m.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export const leadPorId = async (id) =>
  (await query('SELECT id, nombre, telefono, project_id FROM leads WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0] || null;

/** Cuanto hay y cuando entro lo ultimo, para saber si sigue sincronizando. */
export async function actividad(instancia) {
  // Se cuenta SOLO lo de esta sesion. Contando todo, a quien acababa de enlazar
  // le salian los miles de mensajes de sus companeros como si fueran suyos.
  const { rows } = await query(
    `SELECT (SELECT COUNT(*)::int FROM wa_conversaciones WHERE instancia = $1) AS conversaciones,
            (SELECT COUNT(*)::int FROM wa_mensajes m
               JOIN wa_conversaciones c ON c.id = m.conversacion_id
              WHERE c.instancia = $1) AS mensajes,
            (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(m.created_at)))::int
               FROM wa_mensajes m
               JOIN wa_conversaciones c ON c.id = m.conversacion_id
              WHERE c.instancia = $1) AS hace_segundos`,
    [instancia]
  );
  return rows[0];
}
