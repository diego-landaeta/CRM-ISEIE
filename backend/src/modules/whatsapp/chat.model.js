import { query } from '../../shared/config/db.js';
import { seAceptanGrupos } from './politica.js';
// Las plazas se cuentan en UN solo sitio, el mismo que el catalogo y la cola
// del dia: si cada pantalla las calcula a su manera, se le acaba mandando al
// cliente el numero de la que la gestora tuviera mas a mano.
import { PLAZAS_JOIN, PLAZAS_COLS } from '../products/plazas.sql.js';
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

/**
 * Un nombre que de verdad es un nombre, o null.
 *
 * Un nombre de solo espacios NO es un nombre. Se guardaba tal cual, y como no
 * es una cadena vacia pasaba todos los `||` de la pantalla: la cabecera se
 * quedaba en blanco y el avatar caia a su interrogante. Y no vale con trim():
 * WhatsApp deja pasar nombres que son una marca invisible —U+200E, la de
 * direccion del texto— que trim() no toca. Uno de los grupos de la prueba se
 * llamaba exactamente asi.
 *
 * Vive aparte porque no lo necesita solo `conversacionDe`: tambien la agenda y
 * el autor de cada mensaje en un grupo. Con la limpieza metida en un sitio, los
 * otros dos guardaban invisibles.
 */
export function nombreLimpio(v) {
  return String(v || '')
    .replace(/[​-‏‪-‮﻿]/g, '')
    .trim() || null;
}

/** La conversacion de este numero, creandola si es la primera vez. */
export async function conversacionDe({ instancia, jid, nombrePush, avatarUrl, mensajeMio = false, cuando = null, otraLlave = null }) {
  nombrePush = nombreLimpio(nombrePush);

  // EL NOMBRE DE UN MENSAJE QUE MANDAS TU ERES TU.
  //
  // `pushName` es como se llama QUIEN ESCRIBE. En lo que sale de aqui ese eres
  // tu, asi que escribirlo le pone TU nombre al chat de la otra persona: mandas
  // un sticker a Dieguis y la conversacion pasa a llamarse «Angel».
  //
  // Reportado en pantalla, y ademas es escurridizo: el repaso de la agenda lo
  // corrige al cuarto de hora, asi que al ir a mirarlo ya esta bien y parece
  // que no paso nada.
  //
  // Va aqui, con la regla de los grupos, porque es la misma historia: el unico
  // sitio que escribe el nombre de una conversacion es este. En el chat de uno
  // consigo mismo ese nombre SI seria el bueno, pero tampoco hace falta —la
  // pantalla lo llama «Tu (mensajes contigo mismo)» comparando el numero.
  if (mensajeMio) nombrePush = null;

  // A UN GRUPO NO SE LE PONE EL NOMBRE DE UNA PERSONA. Nunca, venga de donde
  // venga.
  //
  // Es la regla que llevo dos dias arreglando por fuera, en cada sitio que
  // escribe: primero en el webhook, luego al traer historial, luego al abrir un
  // chat. Cada vez volvia por otro lado y los grupos amanecian llamandose
  // «Dieguis» o «Giorgio.» — el ultimo que hubiera hablado.
  //
  // Aqui ya no depende de que ningun sitio se acuerde. El nombre de un grupo es
  // su ASUNTO, y ese se pone por `datosDeGrupo`; lo que llegue por esta via
  // para un grupo se descarta. Un solo sitio, una sola regla.
  const esGrupo = String(jid).endsWith('@g.us');
  if (esGrupo) nombrePush = null;
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
    // LA FECHA ES LA DEL MENSAJE, NO LA DE AHORA.
    //
    // Iba `NOW()` en los dos sitios, y con mensajes en vivo daba casi igual: el
    // mensaje llega en el momento en que se manda. Con historial es otra cosa —
    // se importan de golpe conversaciones de hace tres semanas y todas quedaban
    // con la hora de la importacion.
    //
    // Se vio enlazando un numero de verdad: 52 de 54 chats con la misma hora, y
    // la lista ordenada por cuando se guardo en vez de por cuando se hablo. No
    // se parecia en nada a la del movil, que es con lo que se compara.
    //
    // `GREATEST` para que no retroceda: si llega una tanda vieja despues de un
    // mensaje de hoy, el chat no se va para atras en la lista.
    `INSERT INTO wa_conversaciones (instancia, jid, telefono, nombre_push, avatar_url, lead_id, project_id, ultimo_at, lid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9)
     ON CONFLICT (instancia, jid) DO UPDATE
       SET nombre_push = COALESCE(EXCLUDED.nombre_push, wa_conversaciones.nombre_push),
           -- La foto caduca, asi que la nueva manda; pero si viene vacia se
           -- conserva la que habia en vez de dejar el hueco.
           avatar_url  = COALESCE(EXCLUDED.avatar_url, wa_conversaciones.avatar_url),
           -- Si el lead aparece despues (se creo el prospecto mas tarde), se
           -- ata solo. Pero nunca se desata uno ya atado.
           lead_id     = COALESCE(wa_conversaciones.lead_id, EXCLUDED.lead_id),
           project_id  = COALESCE(wa_conversaciones.project_id, EXCLUDED.project_id),
           ultimo_at   = GREATEST(
                           COALESCE(wa_conversaciones.ultimo_at, COALESCE($8::timestamptz, NOW())),
                           COALESCE($8::timestamptz, NOW())),
           -- La OTRA llave de esta persona (migracion 159). Se aprende del
           -- primer mensaje que la traiga y no se pisa con un nulo despues.
           lid         = COALESCE($9, wa_conversaciones.lid)
     -- xmax = 0 distingue un alta de una actualizacion en un upsert. Hace falta
     -- para saber si esta conversacion ACABA de nacer y hay etiquetas
     -- esperandola (migracion 158). Preguntarlo aparte seria una consulta mas
     -- por cada mensaje que entra.
     -- (Sin comillas invertidas aqui: esto va en una plantilla de texto de
     --  JavaScript y cerrarian la cadena.)
     RETURNING *, (xmax = 0) AS recien_creada`,
    [instancia, jid, telefono, nombrePush || null, avatarUrl || null,
     lead?.id || null, lead?.project_id || null, cuando || null, otraLlave || null]
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
  // Quien escribio, solo en grupos y solo si la 134 esta aplicada.
  //
  // El nombre se limpia igual que el de la conversacion: en la agenda real hay
  // gente cuyo `pushName` es una marca invisible, y guardado asi la lista de
  // chats pinta «: Sticker» y el globo del grupo lleva encima una linea vacia
  // donde deberia decir quien hablo.
  participanteNombre = nombreLimpio(participanteNombre);
  const conQuien = participante && await puedeGuardarParticipante();
  const { rows } = await query(
    `INSERT INTO wa_mensajes
       (conversacion_id, wa_id, direccion, tipo, texto, media_url, media_mime, nombre_archivo, estado, enviado_por, ts${conCita ? ', responde_a' : ''}${conQuien ? ', participante, participante_nombre' : ''})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${conCita ? `, $${12}` : ''}${conQuien ? `, $${conCita ? 13 : 12}, $${conCita ? 14 : 13}` : ''})
     -- Por CONVERSACION y no solo por wa_id (migracion 135).
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
export async function listar({ instancia, projectId = null, limite = 50, busca = null, estado = null, etiquetaWa = null }) {
  const params = [instancia];
  let filtro = '';
  if (projectId) { params.push(projectId); filtro = `AND (c.project_id = $${params.length} OR c.project_id IS NULL)`; }

  // Si los grupos no entran, tampoco se ensenan los que ya estan guardados.
  //
  // Hace falta porque la base arrastra lo de antes: al apagar los grupos, los
  // que se colaron mientras `groupsIgnore` no se cumplia seguirian en la lista.
  // Filtrar solo la entrada dejaria la pantalla contradiciendo al ajuste (#74).
  if (!seAceptanGrupos()) filtro += " AND c.jid NOT LIKE '%@g.us'";

  // Filtrar por una etiqueta de WhatsApp (#128, #138).
  //
  // Va APARTE del filtro de estado y no lo sustituye: son dos cosas distintas y
  // el ticket lo dice —«se enseñan las dos, no se pisa ninguna»—. Se pueden usar
  // a la vez: «las de Presupuesto que ademas estan en seguimiento».
  if (etiquetaWa) {
    params.push(String(etiquetaWa));
    filtro += ` AND EXISTS (
      SELECT 1 FROM wa_conversacion_etiquetas ce
        JOIN wa_etiquetas e ON e.id = ce.etiqueta_id AND NOT e.borrada
       WHERE ce.conversacion_id = c.id
         AND e.instancia = c.instancia
         AND e.wa_id = $${params.length})`;
  }

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

  // Quien mando el ultimo mensaje. Con la misma guarda que el resto: sin la
  // migracion 134 se pide todo lo demas y no se dice el autor.
  const conQuien = await puedeGuardarParticipante();

  params.push(Math.min(200, limite));
  const { rows } = await query(
    `SELECT c.*, l.nombre AS lead_nombre, l.status AS lead_status,
            (SELECT p.nombre FROM projects p WHERE p.id = c.project_id) AS proyecto_nombre,
            (c.jid LIKE '%@g.us') AS es_grupo,
            -- El ultimo mensaje: su texto, su tipo y QUIEN lo mando.
            --
            -- El tipo, porque si fue una foto o un audio no hay texto que
            -- ensenar y la lista caia a pintar el telefono — o el identificador
            -- del grupo, que son 18 cifras sin ningun sentido.
            --
            -- El autor, porque en un grupo hablan varios: «Sticker» a secas no
            -- dice nada. WhatsApp pone «Dieguis: Sticker» y «Tu: Sticker», y
            -- sin eso la lista de un grupo no se puede leer de un vistazo.
            --
            -- Los tres del MISMO mensaje, por un lateral. Con tres subconsultas
            -- sueltas cada una elige su fila por su cuenta: basta un empate de
            -- la marca de tiempo —que los hay, WhatsApp da la hora en
            -- segundos— para acabar pegando el autor de un mensaje al texto de
            -- otro.
            u.texto AS ultimo_texto, u.tipo AS ultimo_tipo,
            u.direccion AS ultimo_direccion${conQuien ? ', u.participante_nombre AS ultimo_autor' : ''}
       FROM wa_conversaciones c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN LATERAL (
         SELECT m.texto, m.tipo, m.direccion${conQuien ? ', m.participante_nombre' : ''}
           FROM wa_mensajes m
          WHERE m.conversacion_id = c.id
          ORDER BY m.ts DESC, m.id DESC LIMIT 1
       ) u ON true
      WHERE c.instancia = $1 ${filtro}
      ORDER BY c.ultimo_at DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );
  return rows;
}


/**
 * El banco de mensajes: todo lo guardado, en tabla y sin depender de la sesion
 * (#101).
 *
 * Esto NO es el chat. El chat sirve para conversar y por eso arranca de una
 * conversacion viva; el banco sirve para buscar, auditar y llevarse una copia,
 * y tiene que funcionar aunque la instancia ya no exista en Evolution. Es el
 * caso de ISEIE: se recreo el contenedor, desaparecieron las sesiones de Maria
 * Gabriela y Diana, sus 27 mensajes seguian aqui y no habia forma de verlos.
 * Se acabaron borrando por inservibles.
 *
 * Por eso se lee de `wa_mensajes` y `wa_conversaciones` y de ningun sitio mas:
 * lo que hay en nuestra base esta, exista o no la sesion.
 *
 * `instancias` en null significa TODAS — solo para admin y superadmin. Una
 * gestora recibe aqui la suya y nada mas.
 */
export async function banco({
  instancias = null, texto = null, telefono = null,
  desde = null, hasta = null, direccion = null, tipo = null,
  pagina = 1, limite = 50,
} = {}) {
  const cond = [];
  const params = [];

  if (Array.isArray(instancias)) {
    // Lista vacia = ninguna, no todas. Devolver todo aqui seria abrir el banco
    // entero a quien no tiene sesion.
    if (!instancias.length) return { filas: [], total: 0 };
    params.push(instancias);
    cond.push(`c.instancia = ANY($${params.length})`);
  }
  if (texto) {
    params.push(`%${texto}%`);
    cond.push(`m.texto ILIKE $${params.length}`);
  }
  if (telefono) {
    // Solo cifras, como en el resto del modulo: «+34 612 34 56 78» contra un
    // «34612345678» guardado no casa por culpa del mas y los espacios.
    const cifras = String(telefono).replace(/\D/g, '');
    if (cifras) {
      params.push(`%${cifras}%`);
      cond.push(`regexp_replace(COALESCE(c.telefono, ''), '[^0-9]', '', 'g') LIKE $${params.length}`);
    }
  }
  if (desde) { params.push(desde); cond.push(`m.ts >= $${params.length}`); }
  // El «hasta» incluye su dia entero: quien pide «hasta el 2 de septiembre» no
  // quiere que se le queden fuera los mensajes de esa misma tarde.
  if (hasta) { params.push(hasta); cond.push(`m.ts < ($${params.length}::date + INTERVAL '1 day')`); }
  if (direccion) { params.push(direccion); cond.push(`m.direccion = $${params.length}`); }
  if (tipo) { params.push(tipo); cond.push(`m.tipo = $${params.length}`); }

  const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const { rows: cuenta } = await query(
    `SELECT count(*)::int AS total
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
      ${donde}`,
    params
  );
  const total = cuenta[0]?.total || 0;
  if (!total) return { filas: [], total: 0 };

  const desplazamiento = Math.max(0, (pagina - 1) * limite);
  params.push(limite, desplazamiento);

  const { rows: filas } = await query(
    `SELECT m.id, m.ts, m.direccion, m.tipo, m.texto, m.estado,
            m.nombre_archivo,
            -- Solo si tuvo adjunto, no la ruta: en una tabla que se exporta,
            -- una ruta interna no le dice nada a nadie y encima se lleva a un
            -- Excel algo que no deberia salir de aqui.
            (m.media_url IS NOT NULL) AS con_adjunto,
            m.participante_nombre,
            c.id   AS conversacion_id,
            c.telefono,
            c.instancia,
            (c.jid LIKE '%@g.us') AS es_grupo,
            COALESCE(l.nombre, c.nombre_push) AS quien,
            u.nombre AS enviado_por_nombre
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = m.enviado_por
      ${donde}
      ORDER BY m.ts DESC, m.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { filas, total };
}

/**
 * El mismo banco, resumido POR NUMERO. Es como lo pidio Diego: un numero, todo
 * lo suyo, aunque su conversacion ya no exista.
 *
 * Agrupa por telefono y no por conversacion: la misma persona puede tener una
 * conversacion en la sesion de cada gestora, y para auditar interesa el numero,
 * no en la bandeja de quien cayo.
 */
export async function bancoPorNumero({ instancias = null, texto = null, telefono = null } = {}) {
  const cond = [];
  const params = [];

  if (Array.isArray(instancias)) {
    if (!instancias.length) return [];
    params.push(instancias);
    cond.push(`c.instancia = ANY($${params.length})`);
  }
  if (texto) { params.push(`%${texto}%`); cond.push(`m.texto ILIKE $${params.length}`); }
  if (telefono) {
    const cifras = String(telefono).replace(/\D/g, '');
    if (cifras) {
      params.push(`%${cifras}%`);
      cond.push(`regexp_replace(COALESCE(c.telefono, ''), '[^0-9]', '', 'g') LIKE $${params.length}`);
    }
  }
  const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT c.telefono,
            (c.jid LIKE '%@g.us') AS es_grupo,
            MAX(COALESCE(l.nombre, c.nombre_push)) AS quien,
            count(*)::int AS mensajes,
            min(m.ts) AS primero,
            max(m.ts) AS ultimo,
            count(DISTINCT c.instancia)::int AS sesiones
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
       LEFT JOIN leads l ON l.id = c.lead_id
      ${donde}
      GROUP BY c.telefono, (c.jid LIKE '%@g.us')
      ORDER BY max(m.ts) DESC
      LIMIT 500`,
    params
  );
  return rows;
}

/**
 * La foto de perfil de un contacto, cuando Evolution la manda (#67 y compañia).
 *
 * SOLO actualiza lo que ya existe. Un `contacts.update` puede llegar de alguien
 * con quien no se ha hablado nunca —la agenda entera al enlazar, por ejemplo— y
 * crear una conversacion por cada uno llenaria la lista de gente con la que no
 * hay ni un mensaje.
 *
 * `COALESCE` al reves que en el resto: aqui la nueva manda, porque la direccion
 * que da WhatsApp caduca y la que acaba de llegar es la buena. Pero si viene
 * vacia se conserva la que habia, en vez de dejar el hueco.
 */
export async function actualizarAvatar(instancia, jid, url) {
  if (!instancia || !jid || !url) return 0;
  const { rowCount } = await query(
    `UPDATE wa_conversaciones SET avatar_url = $3
      WHERE instancia = $1 AND jid = $2 AND avatar_url IS DISTINCT FROM $3`,
    [instancia, jid, url]
  );
  return rowCount;
}

/**
 * El nombre y la foto de un grupo, cuando se han podido averiguar.
 *
 * Solo rellena lo que falte: `COALESCE` conserva lo que ya hubiera. Un grupo al
 * que alguien le puso nombre a mano no se pisa con el que venga de WhatsApp.
 */
export async function datosDeGrupo(instancia, jid, asunto, foto) {
  asunto = nombreLimpio(asunto);
  if (!instancia || !jid || (!asunto && !foto)) return 0;
  const { rowCount } = await query(
    `UPDATE wa_conversaciones
        -- El asunto MANDA, no se conserva lo que hubiera.
        --
        -- Antes iba con COALESCE y era demasiado prudente: si un grupo se habia
        -- quedado con un nombre malo —el de quien escribio el ultimo, que es lo
        -- que pasaba antes de arreglar esto— se quedaba con el PARA SIEMPRE.
        -- Nada lo volvia a tocar y el chat seguia llamandose «Dieguis».
        --
        -- El asunto de un grupo es un hecho de WhatsApp, no una preferencia
        -- nuestra: si lo sabemos, es el bueno. Asi ademas se cura solo lo que
        -- quedo mal, sin tener que ir a la base a mano.
        SET nombre_push = COALESCE($3, wa_conversaciones.nombre_push),
            avatar_url  = COALESCE($4, wa_conversaciones.avatar_url)
      WHERE instancia = $1 AND jid = $2`,
    [instancia, jid, asunto || null, foto || null]
  );
  return rowCount;
}

/**
 * Marca un mensaje como eliminado.
 *
 * NO se borra la fila. WhatsApp tampoco lo hace: deja «Se eliminó este mensaje»
 * en su hueco, y aqui ademas son conversaciones con clientes — que una fila
 * desaparezca de un historial sin dejar rastro es justo lo que no puede pasar
 * en algo que sirve para auditar.
 *
 * Se guarda como tipo `eliminado` y sin texto. `tipo` no tiene lista cerrada de
 * valores en la base, asi que esto no necesita migracion.
 */
export async function marcarEliminado(waId, conversacionId = null) {
  if (!waId) return 0;
  const cond = conversacionId ? 'AND conversacion_id = $2' : '';
  const params = conversacionId ? [waId, conversacionId] : [waId];
  const { rowCount } = await query(
    `UPDATE wa_mensajes
        SET tipo = 'eliminado', texto = NULL, media_url = NULL
      WHERE wa_id = $1 ${cond} AND tipo <> 'eliminado'`,
    params
  );
  return rowCount;
}

/**
 * Quienes han escrito en este grupo, para la cabecera.
 *
 * WhatsApp pone la lista de miembros debajo del nombre del grupo. Nosotros no
 * la tenemos: Evolution devuelve los participantes con su NUMERO y sin nombre
 * —los nombres salen de la agenda del movil, que no es nuestra—.
 *
 * Asi que se usa lo que si sabemos: como se llama quien ha escrito. Es menos
 * que la lista completa, pero es cierto y sirve para lo mismo — saber con quien
 * estas hablando sin abrir la ficha del grupo.
 */
export async function quienesEscriben(conversacionId, limite = 8) {
  if (!(await puedeGuardarParticipante())) return [];
  const { rows } = await query(
    `SELECT participante_nombre AS nombre, count(*)::int AS cuantos
       FROM wa_mensajes
      WHERE conversacion_id = $1
        AND participante_nombre IS NOT NULL
        AND participante_nombre <> ''
      GROUP BY participante_nombre
      -- Por quien mas habla: en un grupo movido, los primeros son los que
      -- interesan y el resto sobra.
      ORDER BY count(*) DESC
      LIMIT $2`,
    [conversacionId, limite]
  );
  return rows.map((r) => r.nombre);
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
              LIMIT 1) AS citado_direccion,
            -- A QUIEN se cita, en un grupo.
            --
            -- La pantalla ponia el nombre de la CONVERSACION, que en un grupo es
            -- el del grupo: se leia «Fantasy: buenas» citando a alguien que no
            -- era el grupo. En un grupo hay que decir a quien se cita.
            (SELECT q.participante_nombre FROM wa_mensajes q
              WHERE q.wa_id = m.responde_a AND q.conversacion_id = m.conversacion_id
              LIMIT 1) AS citado_autor` : '';

  // Quien escribio cada mensaje, en grupos (#74). Misma guarda que la cita: si
  // la 134 no esta aplicada se pide igual el resto y no se enseña autor.
  const columnasQuien = (await puedeGuardarParticipante())
    ? `, m.participante, m.participante_nombre,
       -- La foto de quien escribio, SIN tabla nueva.
       --
       -- Si esa persona tiene su propio chat con nosotros, su foto ya esta
       -- guardada ahi: se busca por telefono. Es el mismo dato, no hay que
       -- pedirlo otra vez ni inventarse donde guardarlo.
       --
       -- El campo participante puede ser un «@lid» —el direccionamiento nuevo,
       -- que no es un telefono— asi que se compara solo con las cifras, contra el
       -- telefono, que es lo que si casa.
       (SELECT p.avatar_url FROM wa_conversaciones p
         WHERE p.instancia = (SELECT c2.instancia FROM wa_conversaciones c2 WHERE c2.id = m.conversacion_id)
           AND regexp_replace(COALESCE(p.telefono, ''), '[^0-9]', '', 'g')
               = regexp_replace(COALESCE(split_part(m.participante, '@', 1), ''), '[^0-9]', '', 'g')
           AND p.avatar_url IS NOT NULL
         LIMIT 1) AS participante_foto`
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
  // Los alias cambian: `products` pasa a ser `p` y `projects` a `pj`.
  //
  // No es capricho. `PLAZAS_JOIN` y `PLAZAS_COLS` estan escritos contra el alias
  // `p` de products, y son los MISMOS que usan el catalogo y la cola del dia. El
  // documento comercial es tajante con esto: «el n.º de plazas disponibles va en
  // todas las plantillas y se comprueba antes de cada envio». Si aqui se contara
  // a mano, el numero que se le manda al cliente seria el de la pantalla que la
  // gestora tuviera mas a mano.
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.notas,
            l.fecha_solicitud, l.created_at, l.reincidente, l.lead_duplicado_de,
            pj.nombre AS proyecto,
            u.nombre  AS responsable,
            p.nombre  AS producto,
            -- Lo que hace falta para rellenar una plantilla sin salir del chat
            -- (#129). fecha_inicio_texto llego de WordPress como «marzo 2026» y
            -- se manda tal cual: es lo que dice la web.
            -- (Sin comillas invertidas aqui dentro: esto va en una plantilla de
            --  texto de JavaScript y cerrarian la cadena.)
            p.fecha_inicio_texto,
            p.fecha_cierre_convocatoria,
            ${PLAZAS_COLS}
       FROM wa_conversaciones c
       JOIN leads l          ON l.id = c.lead_id AND l.deleted_at IS NULL
       LEFT JOIN projects pj ON pj.id = l.project_id
       LEFT JOIN users u     ON u.id = l.responsable_id
       LEFT JOIN products p  ON p.id = l.producto_interes_id
       ${PLAZAS_JOIN}
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
  //
  // Y el prospecto, por lo mismo. La lista SI lo traia y esto no, asi que la
  // misma conversacion se llamaba «Maria Lopez · Nuevo» en la lista y «Dieguis ·
  // sin estado» en la cabecera al abrirla. El nombre de la ficha manda sobre el
  // que se ponga en WhatsApp: es como la tienes tu apuntada.
  (await query(
    `SELECT c.*, (c.jid LIKE '%@g.us') AS es_grupo,
            l.nombre AS lead_nombre, l.status AS lead_status
       FROM wa_conversaciones c
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1`, [id]
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
 * Pone al dia los nombres de las PERSONAS desde la agenda de WhatsApp.
 *
 * La agenda es la fuente buena para una persona: es como la tienes apuntada tu,
 * no como se anuncia ella. Lo guardado puede estar mal y eso no se arregla
 * solo, porque al guardar se conserva lo viejo cuando lo nuevo llega vacio.
 *
 * De los GRUPOS no dice nada bueno, y esta era la segunda puerta por la que se
 * les colaba el nombre de una persona. Comprobado contra Evolution v2.3.7 sobre
 * la agenda real: `findContacts` devuelve 106 jids de grupo y en TODOS el campo
 * `name` viene vacio, asi que se cae al `pushName` —que ahi es el de quien
 * hablo—. Un grupo salia llamandose «Dieguis» y otro, literalmente, una marca
 * invisible.
 *
 * Se arreglo primero en `conversacionDe`, que es por donde entran los mensajes.
 * Los nombres volvieron a romperse esa misma tarde: entraban por aqui. Asi que
 * la regla se dice tambien aqui, y en el SQL —no en quien llama— porque asi no
 * depende de que nadie se acuerde. El nombre de un grupo es su ASUNTO y entra
 * solo por `datosDeGrupo`.
 *
 * Solo toca lo que NO coincide, asi que casi siempre no escribe nada.
 */
export async function refrescarNombres(instancia, pares) {
  // Los invisibles no son nombres: uno de la agenda real era U+200E a secas, y
  // guardado deja la fila con la cabecera en blanco.
  const limpios = (pares || [])
    .map((p) => ({ jid: p?.jid, nombre: nombreLimpio(p?.nombre) }))
    .filter((p) => p.jid && p.nombre);
  if (!limpios.length) return 0;
  const jids = limpios.map((p) => p.jid);
  const nombres = limpios.map((p) => p.nombre);
  const { rowCount } = await query(
    `UPDATE wa_conversaciones c
        SET nombre_push = n.nombre
       FROM (SELECT unnest($2::text[]) AS jid, unnest($3::text[]) AS nombre) n
      WHERE c.instancia = $1
        AND c.jid = n.jid
        -- Los grupos, ni tocarlos: lo que la agenda trae para ellos es el
        -- nombre de quien hablo el ultimo.
        AND c.jid NOT LIKE '%@g.us'
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
 * ¿Esta aplicada la migracion 134?
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

// ── Las etiquetas de WhatsApp (#128, #138) ───────────────────────────────────
//
// Son las de la gestora, las que ella ya usa en su movil. NO son las del chat
// del CRM (#72), que son el estado del prospecto: esas viajan con la persona y
// las decide el CRM. Se enseñan las dos y ninguna pisa a la otra.
//
// Todo esto aguanta que la migracion 157 no este aplicada —la aprueba Diego—:
// sin ella no hay etiquetas y no pasa nada mas. Un aviso de WhatsApp no puede
// contestar 500 por una tabla que todavia no esta; Evolution reintentaria en
// bucle, que es como se paro la cola una manana entera.

const SIN_TABLA = '42P01';
let avisadoSinEtiquetas = false;

function noHayEtiquetas(err) {
  if (err?.code !== SIN_TABLA) return false;
  if (!avisadoSinEtiquetas) {
    avisadoSinEtiquetas = true;
    logger.warn('WhatsApp: falta la migracion 157, las etiquetas no se guardan todavia');
  }
  return true;
}

/**
 * Crea o actualiza una etiqueta. Devuelve su id, o null si no se pudo.
 *
 * El nombre viene del aviso y por eso llega entero, con sus acentos y sus
 * emojis. Ver `evolution.client.js · etiquetas()`.
 */
export async function guardarEtiqueta({ instancia, waId, nombre, color }) {
  try {
    // El nombre se limpia igual que el de una conversacion.
    //
    // Salio enlazando un numero de verdad: las tres etiquetas que trae WhatsApp
    // de fabrica llegan como «‎Favoritos», «‎Grupos» y «‎No
    // leidos», con una marca de direccion de texto invisible delante. No se ve,
    // pero se cuela en la lista de chats y rompe cualquier comparacion por
    // nombre — «Favoritos» no es igual a «‎Favoritos».
    //
    // Evolution no tiene este problema porque pela el nombre entero al
    // guardarlo, y de paso se lleva los acentos y los emojis. Aqui se quita solo
    // lo invisible.
    nombre = nombreLimpio(nombre) || `Etiqueta ${waId}`;
    const { rows } = await query(
      `INSERT INTO wa_etiquetas (instancia, wa_id, nombre, color)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (instancia, wa_id) DO UPDATE
          SET nombre = EXCLUDED.nombre,
              color  = COALESCE(EXCLUDED.color, wa_etiquetas.color),
              -- Volver a verla es que existe: si estaba dada por borrada y
              -- reaparece, vuelve.
              borrada = FALSE,
              updated_at = NOW()
      RETURNING id`,
      [instancia, String(waId), String(nombre || '').slice(0, 160), color ?? null]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    if (noHayEtiquetas(err)) return null;
    throw err;
  }
}

/**
 * La etiqueta se borro en el movil.
 *
 * Se MARCA, no se borra: quitarla de la tabla se llevaria por delante en que
 * conversaciones estuvo puesta, y eso es historial de como trabajo la gestora.
 */
export async function marcarEtiquetaBorrada(instancia, waId) {
  try {
    await query(
      `UPDATE wa_etiquetas SET borrada = TRUE, updated_at = NOW()
        WHERE instancia = $1 AND wa_id = $2`,
      [instancia, String(waId)]
    );
    return true;
  } catch (err) {
    if (noHayEtiquetas(err)) return false;
    throw err;
  }
}

/**
 * Pone o quita una etiqueta en una conversacion.
 *
 * Si la etiqueta todavia no se conoce se crea sin nombre: el aviso de
 * asociacion solo trae el id, y el de la etiqueta pudo llegar antes de que
 * existiera esta tabla o perderse. Mejor una etiqueta sin nombre —que se
 * completa en cuanto llegue su aviso— que perder que esta puesta.
 */
export async function asociarEtiqueta({ instancia, jid, waIdEtiqueta, poner }) {
  try {
    // Por las DOS llaves (migracion 159).
    //
    // El aviso llega con el jid que WhatsApp tenga a mano, y esa persona puede
    // estar guardada con el otro: en el caso real llego «16699034202151@lid»
    // mientras el chat estaba como «584242439474@s.whatsapp.net». Buscando solo
    // por uno, la etiqueta se queda fuera — y encima el resultado cambiaria
    // entre local y produccion, porque el puente traduce el @lid y Evolution no.
    const { rows: conv } = await query(
      `SELECT id FROM wa_conversaciones
        WHERE instancia = $1 AND (jid = $2 OR lid = $2)`,
      [instancia, jid]
    );
    // Sin conversacion todavia no hay donde ponerla — PERO NO SE TIRA.
    //
    // Al enlazar, las etiquetas llegan antes que el historial: cuando entra «la
    // etiqueta 12 va en el chat de Marta», ese chat aun no existe aqui. El
    // aviso no se repite y Evolution no deja preguntar por las asociaciones, asi
    // que descartarlo perdia la clasificacion entera de la gestora, en silencio.
    // Se guarda y se aplica cuando su conversacion aparezca. Migracion 158.
    if (!conv[0]) return guardarEtiquetaPendiente({ instancia, jid, waIdEtiqueta, poner });

    // Al QUITARLA no se crea nada: si esa etiqueta no se conoce, es que no
    // estaba puesta y no hay nada que quitar. Creandola igual quedaria una
    // etiqueta fantasma, con nombre de relleno y sin un solo chat detras.
    if (!poner) {
      const { rows } = await query(
        `DELETE FROM wa_conversacion_etiquetas ce
          USING wa_etiquetas e
          WHERE ce.etiqueta_id = e.id
            AND ce.conversacion_id = $1
            AND e.instancia = $2 AND e.wa_id = $3
       RETURNING ce.conversacion_id`,
        [conv[0].id, instancia, String(waIdEtiqueta)]
      );
      return { conversacionId: conv[0].id, puesta: false, quitada: rows.length > 0 };
    }

    const { rows: etiq } = await query(
      `INSERT INTO wa_etiquetas (instancia, wa_id, nombre)
            VALUES ($1, $2, $3)
       ON CONFLICT (instancia, wa_id) DO UPDATE SET updated_at = NOW()
      RETURNING id`,
      [instancia, String(waIdEtiqueta), `Etiqueta ${waIdEtiqueta}`]
    );

    await query(
      `INSERT INTO wa_conversacion_etiquetas (conversacion_id, etiqueta_id)
            VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conv[0].id, etiq[0].id]
    );
    return { conversacionId: conv[0].id, puesta: true };
  } catch (err) {
    if (noHayEtiquetas(err)) return { ignorado: 'falta la migracion 157' };
    throw err;
  }
}

/** Las etiquetas de esta sesion, para ofrecerlas y para filtrar. */
export async function etiquetasDe(instancia) {
  try {
    const { rows } = await query(
      `SELECT e.id, e.wa_id, e.nombre, e.color,
              COUNT(ce.conversacion_id)::int AS conversaciones
         FROM wa_etiquetas e
         LEFT JOIN wa_conversacion_etiquetas ce ON ce.etiqueta_id = e.id
        WHERE e.instancia = $1 AND NOT e.borrada
        GROUP BY e.id
        ORDER BY e.nombre`,
      [instancia]
    );
    return rows;
  } catch (err) {
    if (noHayEtiquetas(err)) return [];
    throw err;
  }
}

/**
 * Las etiquetas de varias conversaciones de golpe.
 *
 * De golpe y no de una en una: la lista pinta 50 conversaciones y preguntar por
 * cada una son 50 consultas por cada vuelta de una pantalla que se refresca
 * sola cada cinco segundos.
 */
export async function etiquetasDeConversaciones(ids) {
  if (!Array.isArray(ids) || !ids.length) return new Map();
  try {
    const { rows } = await query(
      `SELECT ce.conversacion_id, e.nombre, e.color, e.wa_id
         FROM wa_conversacion_etiquetas ce
         JOIN wa_etiquetas e ON e.id = ce.etiqueta_id AND NOT e.borrada
        WHERE ce.conversacion_id = ANY($1::int[])
        ORDER BY e.nombre`,
      [ids]
    );
    const porConv = new Map();
    for (const r of rows) {
      if (!porConv.has(r.conversacion_id)) porConv.set(r.conversacion_id, []);
      porConv.get(r.conversacion_id).push({ nombre: r.nombre, color: r.color, waId: r.wa_id });
    }
    return porConv;
  } catch (err) {
    if (noHayEtiquetas(err)) return new Map();
    throw err;
  }
}

/**
 * Las etiquetas de WhatsApp que tiene un PROSPECTO (#138).
 *
 * El ticket pide esto con todas las letras: «quien mira la ficha del prospecto
 * no ve lo que la gestora ya sabe». Las etiquetas viven en la conversacion, y
 * la ficha no sabe de conversaciones — asi que se cruzan aqui.
 *
 * Una misma persona puede tener conversacion con VARIAS gestoras, y las
 * etiquetas de cada una son suyas. Por eso se acota:
 *
 *   · `instancias = null` — sin limite. Es lo de quien manda, que ya puede
 *     leer esas conversaciones enteras.
 *   · una lista — solo esas sesiones. Una gestora ve lo que ella puso, no lo
 *     que otra piense de esa persona.
 *
 * Se devuelve de quien es cada una: en la ficha, «Presupuesto» puesto por otra
 * gestora sin decir quien es una etiqueta sin dueño, y no se sabe a quien
 * preguntarle.
 */
export async function etiquetasDeLead(leadId, { instancias = null } = {}) {
  try {
    const params = [leadId];
    let filtro = '';
    if (Array.isArray(instancias)) {
      params.push(instancias);
      filtro = `AND c.instancia = ANY($${params.length}::text[])`;
    }
    const { rows } = await query(
      `SELECT DISTINCT e.wa_id, e.nombre, e.color, c.instancia
         FROM wa_conversacion_etiquetas ce
         JOIN wa_etiquetas e ON e.id = ce.etiqueta_id AND NOT e.borrada
         JOIN wa_conversaciones c ON c.id = ce.conversacion_id
        WHERE c.lead_id = $1 ${filtro}
        ORDER BY e.nombre`,
      params
    );
    return rows.map((r) => ({ waId: r.wa_id, nombre: r.nombre, color: r.color, instancia: r.instancia }));
  } catch (err) {
    if (noHayEtiquetas(err)) return [];
    throw err;
  }
}

/**
 * Una etiqueta que llego ANTES que su conversacion (migracion 158).
 *
 * No es un caso raro: al enlazar, WhatsApp manda la sincronizacion del estado
 * —donde van las etiquetas y donde esta puesta cada una— ANTES del historial,
 * que es lo que crea las conversaciones aqui. Con una cuenta de Business eso
 * significa que TODA la clasificacion de la gestora llega antes de que exista un
 * solo chat.
 *
 * Y no hay segunda oportunidad: el aviso no se repite, y Evolution 2.3.7 guarda
 * las etiquetas de cada chat en su base pero no las devuelve por ningun
 * endpoint. Si se tira, se pierde.
 */
async function guardarEtiquetaPendiente({ instancia, jid, waIdEtiqueta, poner }) {
  await query(
    `INSERT INTO wa_etiquetas_pendientes (instancia, jid, wa_id, poner)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (instancia, jid, wa_id) DO UPDATE
        SET poner = EXCLUDED.poner, creada_at = NOW()`,
    [instancia, jid, String(waIdEtiqueta), Boolean(poner)]
  );
  return { pendiente: true, jid, waIdEtiqueta: String(waIdEtiqueta) };
}

/**
 * Aplica lo que estaba esperando a esta conversacion, y lo borra.
 *
 * Se llama SOLO cuando la conversacion acaba de nacer —`recien_creada`—, no en
 * cada mensaje: esta pantalla mueve miles de mensajes al enlazar y una consulta
 * de mas por cada uno se nota.
 *
 * Devuelve cuantas se aplicaron, para poder decirlo en el registro: una gestora
 * que enlaza y ve sus etiquetas puestas solas no tiene por que entender por que,
 * pero quien mire el log el dia que falten, si.
 */
export async function aplicarEtiquetasPendientes({ instancia, jid }) {
  try {
    const { rows } = await query(
      `DELETE FROM wa_etiquetas_pendientes
        WHERE instancia = $1 AND jid = $2
    RETURNING wa_id, poner`,
      [instancia, jid]
    );
    if (!rows.length) return 0;
    for (const r of rows) {
      await asociarEtiqueta({ instancia, jid, waIdEtiqueta: r.wa_id, poner: r.poner });
    }
    logger.info({ instancia, jid, cuantas: rows.length },
      'WhatsApp: etiquetas que esperaban a esta conversacion, aplicadas');
    return rows.length;
  } catch (err) {
    if (noHayEtiquetas(err)) return 0;
    throw err;
  }
}
