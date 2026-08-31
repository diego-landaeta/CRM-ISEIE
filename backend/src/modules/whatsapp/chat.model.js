import { query } from '../../shared/config/db.js';
import { seAceptanGrupos } from './politica.js';
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
export async function guardarMensaje({ conversacionId, waId, direccion, tipo, texto, mediaUrl, mediaMime, nombreArchivo, estado, enviadoPor, ts, respondeA, participante, participanteNombre }) {
  // La columna de la cita solo entra si la migracion 130 esta aplicada. Si no,
  // el mensaje se guarda igual y lo unico que se pierde es saber a que
  // contestaba — perderlo entero seria mucho peor.
  const conCita = respondeA && await puedeGuardarCita();
  // Quien escribio, solo en grupos y solo si la 133 esta aplicada.
  const conQuien = participante && await puedeGuardarParticipante();
  const { rows } = await query(
    `INSERT INTO wa_mensajes
       (conversacion_id, wa_id, direccion, tipo, texto, media_url, media_mime, nombre_archivo, estado, enviado_por, ts${conCita ? ', responde_a' : ''}${conQuien ? ', participante, participante_nombre' : ''})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${conCita ? `, $${12}` : ''}${conQuien ? `, $${conCita ? 13 : 12}, $${conCita ? 14 : 13}` : ''})
     -- Por CONVERSACION y no solo por wa_id (migracion 134).
     --
     -- Con el conflicto global, el mismo mensaje visto por dos sesiones —dos
     -- gestoras en el mismo grupo— se guardaba en UNA sola: en la pantalla de
     -- la otra ese mensaje no existia. Aqui hay que nombrar las mismas columnas
     -- que el indice, o Postgres no encuentra a que conflicto se refiere.
     ON CONFLICT (conversacion_id, wa_id) WHERE wa_id IS NOT NULL DO UPDATE SET
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
       estado         = COALESCE(EXCLUDED.estado, wa_mensajes.estado)${conQuien ? `,
       participante        = COALESCE(wa_mensajes.participante, EXCLUDED.participante),
       participante_nombre = COALESCE(wa_mensajes.participante_nombre, EXCLUDED.participante_nombre)` : ''}
     RETURNING *`,
    [conversacionId, waId || null, direccion, tipo || 'texto', texto || null,
     mediaUrl || null, mediaMime || null, nombreArchivo || null, estado || null,
     enviadoPor || null, ts || new Date(), ...(conCita ? [respondeA] : []),
     ...(conQuien ? [participante, participanteNombre || null] : [])]
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

/**
 * Las conversaciones, y —si se busca— buscando en TODAS, no en las 50 primeras.
 *
 * Reportado por una gestora: «no aparecen los números de los seguimientos de
 * tiempo atrás a pesar de buscar con nombre y número; una vez se envía el
 * mensaje desde la app, aparece el chat».
 *
 * No era la búsqueda: era el tope. La lista traía las 50 más recientes y el
 * filtro se aplicaba en el navegador sobre esas 50. Un seguimiento de hace
 * semanas es la número 80, así que no estaba cargado y buscarlo no encontraba
 * nada. Al mandarle un mensaje, `ultimo_at` sube al presente, entra en las 50 y
 * aparece — que es exactamente lo que ella describía. Al grupo callado le
 * pasaba lo mismo.
 *
 * Con `busca`, el tope deja de importar: filtra Postgres sobre la tabla entera.
 */
export async function listar({ instancia, projectId = null, limite = 50, busca = null, estado = null }) {
  const params = [instancia];
  let filtro = '';
  if (projectId) { params.push(projectId); filtro = `AND (c.project_id = $${params.length} OR c.project_id IS NULL)`; }

  // Si los grupos no entran, tampoco se ensenan los que ya estan guardados.
  //
  // Hace falta porque la base arrastra lo de antes: al apagar los grupos, los
  // que se colaron mientras `groupsIgnore` no se cumplia seguirian en la lista.
  // Filtrar solo la entrada dejaria la pantalla contradiciendo al ajuste (#74).
  if (!seAceptanGrupos()) filtro += " AND c.jid NOT LIKE '%@g.us'";

  // Filtrar por el estado del prospecto (#72, «poner etiquetas a los chats»).
  //
  // El ticket sugeria reutilizar «el sistema de etiquetas para prospectos»,
  // pero ese sistema NO existe: en las migraciones solo hay etiquetas del menu
  // lateral y tags de cifrado. Lo que si existe —y encaja con lo que ella pide
  // literalmente, «pendiente de contestar / ya vendido / no interesado»— es el
  // estado del prospecto, que ademas ya viajaba en esta misma consulta como
  // `lead_status` sin que nadie lo usara.
  //
  // Y viaja con la PERSONA, no con el chat, que es lo que el propio ticket
  // dice que probablemente se quiere. Sin tabla nueva y sin migracion, que hoy
  // ademas estan bloqueadas (#71).
  if (estado === 'grupos') {
    // «Grupos» es una etiqueta mas, y hace falta que exista.
    //
    // Las otras filtran por el estado del PROSPECTO, y un grupo no tiene: con
    // el LEFT JOIN, `l.status` es NULL y la comparacion lo tira. Asi que al
    // pulsar cualquier etiqueta DESAPARECIAN todos los grupos, sin decir por
    // que — parece que se han perdido. Y no habia forma de pedir «enseñame solo
    // los grupos», que con la lista llena es justo lo que hace falta.
    filtro += " AND c.jid LIKE '%@g.us'";
  } else if (estado) {
    params.push(estado);
    // Los grupos no se esconden al filtrar por estado, pero tampoco se cuelan:
    // se quedan fuera porque no son un prospecto, y para verlos esta su propia
    // etiqueta. Se dice aqui para que no parezca un descuido.
    filtro += ` AND l.status = $${params.length}`;
  }

  const texto = String(busca ?? '').trim();
  if (texto) {
    params.push(`%${texto}%`);
    const like = `$${params.length}`;
    const condiciones = [
      `c.nombre_push ILIKE ${like}`,
      `l.nombre    ILIKE ${like}`,
      `l.email     ILIKE ${like}`,
    ];

    // El telefono se compara SOLO con cifras. Buscar «+34 612 34 56 78» contra
    // un «34612345678» guardado no casaba por culpa del mas y los espacios: es
    // el mismo fallo que el de los duplicados por telefono de #65.
    //
    // Y solo si quedan cifras. Buscando «psiko» el resultado seria la cadena
    // vacia, y un LIKE '%%' casa con TODAS las conversaciones — una busqueda
    // que devuelve la lista entera parece que funciona y es lo contrario.
    const cifras = texto.replace(/\D/g, '');
    if (cifras) {
      params.push(`%${cifras}%`);
      const soloCifras = `$${params.length}`;
      condiciones.push(
        `regexp_replace(COALESCE(c.telefono, ''), '[^0-9]', '', 'g') LIKE ${soloCifras}`,
        `regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g') LIKE ${soloCifras}`,
      );
    }
    filtro += `\n      AND (${condiciones.join('\n        OR ')})`;
  }

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

  // Quien escribio cada mensaje, en grupos (#74). Misma guarda que la cita: si
  // la 133 no esta aplicada se pide igual el resto y no se enseña autor.
  const columnasQuien = (await puedeGuardarParticipante())
    ? ', m.participante, m.participante_nombre'
    : '';

  const { rows } = await query(
    `SELECT m.id, m.wa_id, m.direccion, m.tipo, m.texto, m.media_url, m.media_mime,
            m.nombre_archivo, m.estado, m.enviado_por, m.ts${columnasCita}${columnasQuien}
       FROM wa_mensajes m
      WHERE m.conversacion_id = $1
      -- Se desempata por id porque WhatsApp da la hora en SEGUNDOS: tres
      -- mensajes seguidos comparten marca y sin esto salen en cualquier orden.
      ORDER BY m.ts DESC, m.id DESC LIMIT $2`,
    [conversacionId, Math.min(500, limite)]
  );
  return rows.reverse();
}

/**
 * La ficha del prospecto de una conversacion, resumida.
 *
 * Es para el popup del chat: lo justo para no tener que irse a Prospectos y
 * volver — porque volver recarga el chat entero y con el la sesion de WhatsApp.
 *
 * Devuelve null si esa conversacion no tiene prospecto, que pasa mucho: gente
 * que escribe y todavia no esta en el CRM. Quien llama distingue ese caso del
 * de una conversacion que no existe.
 */
export async function fichaDeConversacion(conversacionId) {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.notas,
            l.fecha_solicitud, l.created_at, l.reincidente, l.lead_duplicado_de,
            p.nombre  AS proyecto,
            u.nombre  AS responsable,
            pr.nombre AS producto
       FROM wa_conversaciones c
       JOIN leads l          ON l.id = c.lead_id AND l.deleted_at IS NULL
       LEFT JOIN projects p  ON p.id = l.project_id
       LEFT JOIN users u     ON u.id = l.responsable_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
      WHERE c.id = $1`,
    [conversacionId]
  );
  return rows[0] || null;
}

/**
 * Las ultimas anotaciones del prospecto, para el mismo popup.
 *
 * Cinco y no mas: esto es un vistazo, no el historial. Quien quiera el resto
 * abre la ficha completa, que para eso esta el enlace.
 */
export async function ultimasInteracciones(leadId, cuantas = 5) {
  const { rows } = await query(
    `SELECT i.id, i.tipo, i.nota, i.fecha, u.nombre AS quien
       FROM lead_interactions i
       LEFT JOIN users u ON u.id = i.created_by
      WHERE i.lead_id = $1
      ORDER BY i.fecha DESC NULLS LAST, i.id DESC
      LIMIT $2`,
    [leadId, cuantas]
  );
  return rows;
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
  // En un grupo hace falta el PARTICIPANTE, no solo el wa_id.
  //
  // WhatsApp identifica un mensaje de grupo por la terna (remoteJid,
  // participant, id): sin el participante no sabe cual marcar y el doble tic
  // azul no llega nunca. En un chat de una persona sobra, y por eso el fallo no
  // se veia hasta que entro el primer grupo (#74).
  const conParticipante = await puedeGuardarParticipante();
  const { rows } = await query(
    `SELECT wa_id${conParticipante ? ', participante' : ''} FROM wa_mensajes
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
let hayColumnaParticipante = null;

/**
 * ¿Esta aplicada la migracion 133?
 *
 * Mismo patron que la cita: pedir una columna que no existe tumba el INSERT
 * entero, y perder el mensaje por no poder guardar QUIEN lo escribio seria un
 * mal cambio. Sin la migracion se guarda igual, solo que sin autor.
 */
export async function puedeGuardarParticipante() {
  if (hayColumnaParticipante !== null) return hayColumnaParticipante;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'wa_mensajes' AND column_name = 'participante'`
    );
    hayColumnaParticipante = rows.length > 0;
  } catch {
    hayColumnaParticipante = false;
  }
  return hayColumnaParticipante;
}

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
    // `conversacion_id`, `texto` y `ts` hacen falta para corregir un mensaje
    // (#75): comprobar que es de ESTA conversacion, y si esta dentro de los 15
    // minutos que deja WhatsApp. Sin la primera, la comparacion era contra
    // `undefined` y el endpoint contestaba «Mensaje no encontrado» SIEMPRE.
    `SELECT m.id, m.conversacion_id, m.wa_id, m.direccion, m.tipo, m.texto,
            m.media_url, m.ts, c.jid, c.instancia
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

/**
 * Lo que ha entrado y nadie ha leido todavia.
 *
 * Para avisar de un mensaje nuevo desde cualquier pantalla del CRM. Hasta ahora
 * no se avisaba de NADA: cuando entraba un WhatsApp el CRM no hacia ni un
 * sonido, ni un aviso, ni cambiaba el titulo de la pestaña. La gestora solo se
 * enteraba si tenia el chat abierto y miraba.
 *
 * Se apoya en `no_leidos`, que ya solo cuenta lo que llega DE VERDAD ahora
 * —el propio UPDATE se lo salta si el mensaje es de hace mas de dos minutos—,
 * asi que al emparejar un numero y entrar miles de mensajes viejos esto no
 * dispara mil avisos.
 *
 * Barata a proposito: la pregunta se repite cada pocos segundos desde todas las
 * pantallas del CRM.
 */
export async function sinLeer(instancia) {
  // Los GRUPOS no cuentan para el aviso del sistema.
  //
  // Este numero dispara la notificacion del navegador y el contador de la
  // pestaña. Contando grupos, un movil con 105 —los que tiene el numero de
  // pruebas— avisa por cada cosa que diga cualquiera en cualquiera de ellos, y
  // en dos dias la gestora apaga los avisos. Ahi se pierden tambien los de los
  // prospectos, que son los que importan.
  //
  // No se ESCONDEN: la lista sigue enseñando su contador de no leidos, porque
  // saber que hay mensajes nuevos en un grupo si es util. Lo que no hace es
  // interrumpir.
  const { rows } = await query(
    `SELECT COALESCE(SUM(c.no_leidos), 0)::int AS total,
            COUNT(*) FILTER (WHERE c.no_leidos > 0)::int AS conversaciones
       FROM wa_conversaciones c
      WHERE c.instancia = $1 AND c.no_leidos > 0
        AND c.jid NOT LIKE '%@g.us'`,
    [instancia]
  );
  const resumen = rows[0] || { total: 0, conversaciones: 0 };
  if (!resumen.total) return { ...resumen, ultimo: null };

  // El ultimo entrante, para poder decir de quien es sin abrir nada.
  const { rows: ult } = await query(
    `SELECT m.id, m.texto, m.tipo, m.ts,
            c.id AS conversacion_id,
            (c.jid LIKE '%@g.us') AS es_grupo,
            COALESCE(l.nombre, c.nombre_push, c.telefono) AS quien
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.instancia = $1 AND m.direccion = 'entrante' AND c.no_leidos > 0
        AND c.jid NOT LIKE '%@g.us'
      ORDER BY m.ts DESC, m.id DESC
      LIMIT 1`,
    [instancia]
  );
  const u = ult[0];
  return {
    ...resumen,
    ultimo: u ? {
      id: u.id,
      conversacionId: u.conversacion_id,
      quien: u.quien,
      esGrupo: Boolean(u.es_grupo),
      tipo: u.tipo,
      // Recortado: esto va a un aviso del sistema, no a la pantalla del chat.
      texto: u.texto ? String(u.texto).slice(0, 140) : null,
      ts: u.ts,
    } : null,
  };
}


/** Cambia el texto de un mensaje ya enviado, tras corregirlo en WhatsApp (#75). */
export async function corregirTexto(id, texto) {
  const { rows } = await query(
    `UPDATE wa_mensajes SET texto = $2 WHERE id = $1 RETURNING *`,
    [id, texto]
  );
  return rows[0] || null;
}
