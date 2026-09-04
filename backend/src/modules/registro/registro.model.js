import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * El registro del sistema, con vista «general» y «todos» (#111).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AQUI NO SE APUNTA NADA. SE RECOGE.
 *
 * El ticket lo dice: «ya hay piezas que dejan rastro y hay que recogerlas, no
 * reinventarlas». Una tabla nueva a la que todo el CRM tuviera que escribir
 * seria un segundo sitio que mantener, y el dia que alguien añadiera una accion
 * y se olvidara de anotarla, el registro mentiria por omision — que es la peor
 * forma de mentir de un registro.
 *
 * Asi que esto es SOLO LECTURA sobre lo que ya se escribe:
 *
 *   lead_audit_log           (072) · quien cambio que campo de que ficha
 *   document_audit_log       (039) · quien genero, descargo o borro un documento
 *   user_activity_log        (001) · inicios de sesion, credenciales, WhatsApp
 *   status_errors            (037) · los errores que devolvio la API
 *   make_webhook_deliveries  (063) · cada entrega de webhook, con su resultado
 *   registro_tareas          (106) · cada vuelta de las tareas programadas
 *
 * De esos seis, cinco ya existian. El unico que hubo que añadir es el de las
 * tareas, porque su rastro vivia en memoria: servia para «¿esto va?» y no para
 * «¿que paso el martes?».
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * LAS DOS VISTAS
 *
 *   general → lo que hizo una PERSONA: las tres primeras.
 *   todos   → eso mas los sucesos del sistema: las tres ultimas.
 *
 * No es un filtro por comodidad. En «general» se busca a quien hizo algo, y con
 * los webhooks y las tareas mezclados —que son miles de filas al dia— lo que
 * hizo una persona no se encuentra.
 *
 * CADA FUENTE SE PIDE APARTE, Y NO ES UN DESCUIDO
 *
 * Un `UNION ALL` de seis tablas con un `ORDER BY` encima obliga a Postgres a
 * ordenar el total antes de quedarse con cien filas: `registro_tareas` sola
 * pasa del millon en un año. Pidiendo a cada una SU pagina —con su indice por
 * fecha— y mezclando aqui, cada consulta toca cien filas.
 *
 * El precio es que se piden mas filas de las que se devuelven. Es barato y es
 * correcto: para dar las 100 mas nuevas del conjunto basta con las 100 mas
 * nuevas de cada una.
 */

/** Las fuentes que puede haber. El orden es el de la pantalla. */
export const FUENTES = {
  ficha:      { titulo: 'Fichas',       tabla: 'lead_audit_log',          sistema: false },
  documento:  { titulo: 'Documentos',   tabla: 'document_audit_log',      sistema: false },
  usuario:    { titulo: 'Usuarios',     tabla: 'user_activity_log',       sistema: false },
  tarea:      { titulo: 'Tareas',       tabla: 'registro_tareas',         sistema: true },
  webhook:    { titulo: 'Webhooks',     tabla: 'make_webhook_deliveries', sistema: true },
  error:      { titulo: 'Errores',      tabla: 'status_errors',           sistema: true },
};

export const NOMBRES_FUENTE = Object.keys(FUENTES);

/** Las de la vista «general»: lo que hizo una persona. */
export const DE_PERSONAS = NOMBRES_FUENTE.filter((n) => !FUENTES[n].sistema);

/**
 * Que tablas existen de verdad.
 *
 * Ninguna de las seis esta garantizada: `registro_tareas` es de la 142, que
 * hoy no esta aplicada, y las de Make o las de estado pueden faltar en una
 * instalacion que no las use. Preguntar sale una vez y ahorra que la pantalla
 * entera se caiga con un 42P01 por una tabla que no esta.
 *
 * Se recuerda, pero se puede olvidar: al aplicar una migracion con el proceso
 * vivo, sin `olvidarTablas()` el registro seguiria sin enseñar la fuente nueva
 * hasta el siguiente reinicio.
 */
let existentes = null;

export async function tablasQueHay() {
  if (existentes) return existentes;
  const nombres = NOMBRES_FUENTE.map((n) => FUENTES[n].tabla);
  try {
    const { rows } = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [nombres]
    );
    const hay = new Set(rows.map((r) => r.table_name));
    existentes = new Set(NOMBRES_FUENTE.filter((n) => hay.has(FUENTES[n].tabla)));
    const faltan = NOMBRES_FUENTE.filter((n) => !existentes.has(n));
    if (faltan.length) {
      logger.warn({ faltan }, 'Registro: hay fuentes sin tabla, no se enseñan');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Registro: no se pudo mirar que tablas hay');
    existentes = new Set();
  }
  return existentes;
}

export const olvidarTablas = () => { existentes = null; };

/**
 * Las condiciones comunes: desde, hasta y usuario.
 *
 * Cada fuente llama a su columna de otra forma, asi que se le pasan los nombres
 * en vez de escribir seis veces lo mismo. `usuarioCol` puede ser null: en las
 * fuentes del sistema no hay usuario, y filtrar por uno tiene que dejarlas
 * FUERA en vez de traerlas todas — buscar «lo que hizo Laura» y que salgan los
 * webhooks es justo lo que hace inutil un filtro.
 */
function condiciones({ fechaCol, usuarioCol }, { desde, hasta, usuarioId }, params) {
  const trozos = [];
  if (desde)  { params.push(desde); trozos.push(`${fechaCol} >= $${params.length}`); }
  if (hasta)  { params.push(hasta); trozos.push(`${fechaCol} < ($${params.length}::date + 1)`); }
  if (usuarioId) {
    if (!usuarioCol) return null;                       // esta fuente no aplica
    params.push(usuarioId);
    trozos.push(`${usuarioCol} = $${params.length}`);
  }
  return trozos.length ? `WHERE ${trozos.join(' AND ')}` : '';
}

/** Cambios en la ficha de un prospecto. */
async function deFichas(filtros, limite) {
  const params = [];
  const donde = condiciones({ fechaCol: 'a.changed_at', usuarioCol: 'a.changed_by_user_id' }, filtros, params);
  if (donde === null) return [];
  params.push(limite);
  const { rows } = await query(
    `SELECT a.id, a.changed_at AS cuando, a.field_name AS campo,
            a.old_value AS antes, a.new_value AS despues,
            a.lead_id, l.nombre AS lead_nombre, l.project_id,
            a.changed_by_user_id AS usuario_id, u.nombre AS usuario
       FROM lead_audit_log a
       LEFT JOIN users u ON u.id = a.changed_by_user_id
       LEFT JOIN leads l ON l.id = a.lead_id
       ${donde}
      ORDER BY a.changed_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    fuente: 'ficha',
    id: `ficha-${r.id}`,
    cuando: r.cuando,
    usuario_id: r.usuario_id,
    usuario: r.usuario,
    project_id: r.project_id,
    accion: `cambio.${r.campo}`,
    // Lo que se lee en la fila. El «de X a Y» va aqui y no en el detalle porque
    // es lo unico que hace util un cambio de campo: sin los dos valores, «se
    // cambio el email» no dice nada.
    resumen: `Cambió ${r.campo}${r.antes ? ` de «${r.antes}»` : ''} a «${r.despues ?? '—'}»`,
    entidad: 'lead',
    entidad_id: r.lead_id,
    entidad_nombre: r.lead_nombre,
    enlace: r.lead_id ? `/crm/leads/${r.lead_id}` : null,
    ok: true,
    detalle: { campo: r.campo, antes: r.antes, despues: r.despues },
  }));
}

/** Lo que se hizo con un documento. */
async function deDocumentos(filtros, limite) {
  const params = [];
  const donde = condiciones({ fechaCol: 'd.created_at', usuarioCol: 'd.user_id' }, filtros, params);
  if (donde === null) return [];
  params.push(limite);
  const { rows } = await query(
    `SELECT d.id, d.created_at AS cuando, d.action, d.document_id,
            d.user_id AS usuario_id, u.nombre AS usuario, d.metadata
       FROM document_audit_log d
       LEFT JOIN users u ON u.id = d.user_id
       ${donde}
      ORDER BY d.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  const COMO_SE_DICE = {
    generated: 'Generó', downloaded: 'Descargó', regenerated: 'Regeneró',
    deleted: 'Borró', number_overridden: 'Cambió el número de', emailed: 'Envió por correo',
  };
  return rows.map((r) => ({
    fuente: 'documento',
    id: `doc-${r.id}`,
    cuando: r.cuando,
    usuario_id: r.usuario_id,
    usuario: r.usuario,
    project_id: null,
    accion: `documento.${r.action}`,
    resumen: `${COMO_SE_DICE[r.action] || r.action} el documento #${r.document_id}`,
    entidad: 'documento',
    entidad_id: r.document_id,
    entidad_nombre: null,
    enlace: null,
    ok: true,
    detalle: r.metadata || null,
  }));
}

/** Inicios de sesion, credenciales, WhatsApp: lo que ya escribe medio CRM. */
async function deUsuarios(filtros, limite) {
  const params = [];
  const donde = condiciones({ fechaCol: 'l.created_at', usuarioCol: 'l.user_id' }, filtros, params);
  if (donde === null) return [];
  params.push(limite);
  const { rows } = await query(
    `SELECT l.id, l.created_at AS cuando, l.action, l.details,
            l.ip_address, l.user_id AS usuario_id, u.nombre AS usuario
       FROM user_activity_log l
       LEFT JOIN users u ON u.id = l.user_id
       ${donde}
      ORDER BY l.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    fuente: 'usuario',
    id: `act-${r.id}`,
    cuando: r.cuando,
    usuario_id: r.usuario_id,
    usuario: r.usuario,
    project_id: r.details?.project_id ?? null,
    accion: r.action,
    resumen: enCristiano(r.action, r.details),
    entidad: null,
    entidad_id: null,
    entidad_nombre: null,
    enlace: null,
    ok: true,
    // La IP se queda FUERA del detalle a proposito: el registro lo mira gente
    // de dentro y una IP es un dato personal de un compañero. Si hace falta
    // para una investigacion, esta en `user_activity_log`, que es su sitio.
    detalle: r.details || null,
  }));
}

/**
 * Un `action` como `credencial.ver`, contado en cristiano.
 *
 * Se traduce lo que hay hoy y lo que no, se enseña tal cual — un `action` nuevo
 * que nadie tradujo tiene que APARECER, aunque sea feo. Esconderlo hasta que
 * alguien lo añada aqui es como se pierden sucesos en un registro.
 */
function enCristiano(action, details) {
  const d = details || {};
  const M = {
    login: 'Inició sesión',
    logout: 'Cerró sesión',
    login_failed: 'Intento de inicio de sesión fallido',
    'credencial.ver': `Vio la credencial de ${d.servicio || '—'}`,
    'credencial.crear': `Creó la credencial de ${d.servicio || '—'}`,
    'credencial.cambiar': `Cambió la credencial de ${d.servicio || '—'}`,
    'credencial.borrar': `Borró la credencial de ${d.servicio || '—'}`,
    'credencial.probar': `Probó la credencial de ${d.servicio || '—'}`,
  };
  return M[action] || action;
}

/** Cada vuelta de las tareas programadas. */
async function deTareas(filtros, limite) {
  const params = [];
  const donde = condiciones({ fechaCol: 't.termino', usuarioCol: null }, filtros, params);
  if (donde === null) return [];
  params.push(limite);
  const { rows } = await query(
    `SELECT t.id, t.termino AS cuando, t.nombre, t.titulo, t.duracion_ms, t.ok, t.mensaje, t.detalle
       FROM registro_tareas t
       ${donde}
      ORDER BY t.termino DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    fuente: 'tarea',
    id: `tarea-${r.id}`,
    cuando: r.cuando,
    usuario_id: null,
    usuario: null,
    project_id: null,
    accion: `tarea.${r.nombre}`,
    resumen: r.ok
      ? `${r.titulo || r.nombre} dio su vuelta${r.duracion_ms != null ? ` en ${r.duracion_ms} ms` : ''}`
      : `${r.titulo || r.nombre} falló: ${r.mensaje}`,
    entidad: 'tarea',
    entidad_id: null,
    entidad_nombre: r.titulo || r.nombre,
    enlace: null,
    ok: r.ok,
    detalle: r.detalle || null,
  }));
}

/** Cada entrega de webhook, con su resultado. */
async function deWebhooks(filtros, limite) {
  const params = [];
  const donde = condiciones({ fechaCol: 'd.received_at', usuarioCol: null }, filtros, params);
  if (donde === null) return [];
  params.push(limite);
  const { rows } = await query(
    `SELECT d.id, d.received_at AS cuando, d.result, d.lead_id, d.error_message,
            -- Es 'label', no 'nombre': asi se llama la columna en la tabla
            -- make_webhooks desde la 063, en los dos CRMs. Pedir 'nombre'
            -- tiraba la consulta entera y la fuente se quedaba sin filas.
            --
            -- (Sin comillas invertidas aqui dentro: esto va DENTRO de una
            --  plantilla de JavaScript y una comilla invertida la cierra.)
            w.label AS webhook, w.project_id
       FROM make_webhook_deliveries d
       LEFT JOIN make_webhooks w ON w.id = d.webhook_id
       ${donde}
      ORDER BY d.received_at DESC
      LIMIT $${params.length}`,
    params
  );
  const COMO_SE_DICE = { accepted: 'aceptada', rejected: 'rechazada', test_only: 'de prueba' };
  return rows.map((r) => ({
    fuente: 'webhook',
    id: `wh-${r.id}`,
    cuando: r.cuando,
    usuario_id: null,
    usuario: null,
    project_id: r.project_id,
    accion: `webhook.${r.result}`,
    resumen: `Entrada de «${r.webhook || 'webhook'}» ${COMO_SE_DICE[r.result] || r.result}`
      + (r.lead_id ? ` · ficha #${r.lead_id}` : '')
      + (r.error_message ? ` · ${r.error_message}` : ''),
    entidad: r.lead_id ? 'lead' : 'webhook',
    entidad_id: r.lead_id || null,
    entidad_nombre: r.webhook || null,
    enlace: r.lead_id ? `/crm/leads/${r.lead_id}` : null,
    ok: r.result !== 'rejected',
    // El `payload` NO viaja. Lleva datos del formulario —nombre, email,
    // telefono— y esto es una lista, no una ficha: si hace falta ver el cuerpo,
    // esta la pantalla del webhook.
    detalle: r.error_message ? { error: r.error_message } : null,
  }));
}

/** Los errores que devolvio la API. */
async function deErrores(filtros, limite) {
  const params = [];
  const donde = condiciones({ fechaCol: 'e.created_at', usuarioCol: null }, filtros, params);
  if (donde === null) return [];
  params.push(limite);
  const { rows } = await query(
    `SELECT e.id, e.created_at AS cuando, e.method, e.path, e.status_code,
            e.message, e.user_id AS usuario_id, u.nombre AS usuario
       FROM status_errors e
       LEFT JOIN users u ON u.id = e.user_id
       ${donde}
      ORDER BY e.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    fuente: 'error',
    id: `err-${r.id}`,
    cuando: r.cuando,
    usuario_id: r.usuario_id,
    usuario: r.usuario,
    project_id: null,
    accion: `error.${r.status_code}`,
    resumen: `${r.status_code} en ${r.method} ${r.path}${r.message ? ` · ${r.message}` : ''}`,
    entidad: null,
    entidad_id: null,
    entidad_nombre: null,
    enlace: null,
    ok: false,
    // La traza no viaja a la lista. Es de `status_errors`, y ahi esta entera.
    detalle: { metodo: r.method, ruta: r.path, codigo: r.status_code },
  }));
}

const LECTORES = {
  ficha: deFichas, documento: deDocumentos, usuario: deUsuarios,
  tarea: deTareas, webhook: deWebhooks, error: deErrores,
};

/**
 * Sin acentos y en minusculas, para buscar.
 *
 * Buscando «maria» tiene que salir «Maria Lopez» y tambien «María»: los nombres
 * entran al CRM de un formulario, de un Excel y de WhatsApp, y el mismo nombre
 * viene escrito de las dos formas.
 */
const sinAcentos = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lo maximo que se devuelve de una vez. Por encima, esto es una descarga. */
export const TOPE = 500;

/**
 * El registro.
 *
 * @param {'general'|'todos'} vista
 * @param {{desde?, hasta?, usuarioId?, fuentes?, busca?, limite?}} filtros
 */
export async function listar({ vista = 'general', ...filtros } = {}) {
  const limite = Math.min(Number(filtros.limite) || 100, TOPE);
  const hay = await tablasQueHay();

  // Que fuentes tocan: las de la vista, cruzadas con las que pidan y con las
  // que existen de verdad.
  const deLaVista = vista === 'todos' ? NOMBRES_FUENTE : DE_PERSONAS;
  const pedidas = Array.isArray(filtros.fuentes) && filtros.fuentes.length
    ? deLaVista.filter((f) => filtros.fuentes.includes(f))
    : deLaVista;
  const usables = pedidas.filter((f) => hay.has(f));

  // Se le pide `limite` a cada una: para dar las N mas nuevas del conjunto
  // basta con las N mas nuevas de cada fuente.
  // Las que revientan al leerse. Sin esto, una consulta rota se lee igual que
  // un dia tranquilo: la fuente aparece en la lista de filtros y devuelve cero.
  // Paso de verdad —se pedia `w.nombre` y la columna es `w.label`— y no lo vio
  // nadie, porque cero filas es exactamente lo que se espera ver a veces.
  const fallaron = [];

  const tandas = await Promise.all(usables.map(async (f) => {
    try {
      return await LECTORES[f](filtros, limite);
    } catch (err) {
      // Una fuente rota no puede llevarse la pantalla por delante: se queda sin
      // sus filas y se dice cual, que es mas util que una pagina en blanco.
      logger.error({ err: err.message, fuente: f }, 'Registro: fuente que no se pudo leer');
      fallaron.push(f);
      return [];
    }
  }));

  let filas = tandas.flat();

  // Buscar es sobre lo ya traido, y se dice por que: el texto de cada suceso se
  // arma AQUI —«Cambió email de X a Y»— y no existe en ninguna columna, asi que
  // no hay nada que buscar en la base. Con el tope de 500 por fuente es
  // suficiente para lo que es: afinar una lista que ya tienes delante.
  const texto = sinAcentos(filtros.busca || '').trim();
  if (texto) {
    filas = filas.filter((f) =>
      sinAcentos(`${f.resumen} ${f.usuario || ''} ${f.entidad_nombre || ''}`).includes(texto));
  }

  filas.sort((a, b) => new Date(b.cuando) - new Date(a.cuando));

  return {
    filas: filas.slice(0, limite),
    // Que fuentes se miraron de verdad. Sin esto, «no hay nada el martes» y «la
    // tabla de esa fuente no esta» se leen igual, y es la diferencia entre un
    // dia tranquilo y una migracion sin aplicar.
    fuentes: usables,
    // Que fuente no se pudo LEER, que es distinto de que no tenga tabla. Sin
    // decirlo, una consulta rota es indistinguible de un dia sin sucesos.
    fallaron,
    sinTabla: pedidas.filter((f) => !hay.has(f)),
  };
}
