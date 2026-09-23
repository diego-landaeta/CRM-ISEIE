import { query } from '../../shared/config/db.js';
import { comoLista } from '../../shared/utils/ambito.js';
/*
  LAS PLAZAS NO SE CUENTAN AQUI, y antes si.

  Diego, 11/09/2026: «eso lo hacen ellas desde otro sistema, no en el CRM, pero
  si es un paso a poner... que el CRM no lo recuerde, solamente sea que toca
  mandar ese mensaje y como un disclaimer de verificar cuantas plazas quedan».

  Tenia razon y el calculo se ha quitado: de dos contabilidades de las mismas
  plazas solo una puede tener razon, y es la de admisiones. Un numero nuestro
  que no cuadre con el suyo es PEOR que no dar numero, porque ese numero acaba
  dentro de un mensaje que ya salio al cliente.

  Lo que queda es `s.avisa_plazas`: el paso dice que su mensaje habla de
  plazas, y la pantalla pone el aviso de ir a mirarlas. El calculo sigue vivo
  en el catalogo (`products/plazas.sql.js`) para quien quiera llevarlo ahi.
*/

// Los pasos del proceso comercial (#87).
//
// Se leen y se escriben SIEMPRE dentro de un proyecto: cada uno puede llevar su
// propio proceso, y mezclarlos seria dar a una gestora la cola de otra marca.

const COLS = `id, project_id, clave, nombre, orden, cuando,
              dia_desde, dia_hasta, canales, es_seguimiento, nota, activo,
              avisa_plazas, created_at, updated_at`;

export async function listByProject(projectId, { includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLS} FROM commercial_steps
      WHERE project_id = $1 ${includeInactive ? '' : 'AND activo = true'}
      ORDER BY orden, id`,
    [projectId]
  );
  return rows;
}

/**
 * Los pasos de VARIOS campus, que es como se mira una empresa entera.
 *
 * Los siete campus de CEDIA llevan el mismo proceso, asi que se devuelve UNA
 * lista --la del primer campus que tenga cada paso-- y, en cada paso,
 * `en_campus`: en cuantos de los campus del ambito existe. Cuando ese numero
 * no es el total, alguno se ha separado y la pantalla lo dice en vez de
 * enseñar una media que no es de nadie.
 */
export async function listByProjects(projectIds, { includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT DISTINCT ON (s.clave) ${COLS.split(',').map((c) => 's.' + c.trim()).join(', ')},
            (SELECT count(*)::int FROM commercial_steps x
              WHERE x.project_id = ANY($1::int[]) AND x.clave = s.clave
                ${includeInactive ? '' : 'AND x.activo = true'}) AS en_campus
       FROM commercial_steps s
      WHERE s.project_id = ANY($1::int[]) ${includeInactive ? '' : 'AND s.activo = true'}
      ORDER BY s.clave, s.project_id`,
    [projectIds]
  );
  // El DISTINCT ON obliga a ordenar por clave; el orden que importa es el del
  // proceso, y ese se pone aqui.
  return rows.sort((a, b) => a.orden - b.orden || a.id - b.id);
}

/** El mismo paso en los demas campus de la empresa: los hermanos de clave. */
export async function hermanosDeClave(clave, projectIds) {
  const { rows } = await query(
    `SELECT id, project_id FROM commercial_steps
      WHERE clave = $1 AND project_id = ANY($2::int[]) ORDER BY project_id`,
    [clave, projectIds]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM commercial_steps WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function findByClave(projectId, clave) {
  const { rows } = await query(
    `SELECT ${COLS} FROM commercial_steps WHERE project_id = $1 AND clave = $2`,
    [projectId, clave]
  );
  return rows[0] || null;
}

export async function create(projectId, data) {
  // Al final de la lista salvo que digan otra cosa: un paso nuevo que aparece
  // en medio descoloca la cola de todo el mundo sin avisar.
  const { rows } = await query(
    `INSERT INTO commercial_steps
       (project_id, clave, nombre, orden, cuando, dia_desde, dia_hasta,
        canales, es_seguimiento, nota)
     VALUES ($1, $2, $3,
             COALESCE($4::integer, (SELECT COALESCE(MAX(orden), 0) + 1 FROM commercial_steps WHERE project_id = $1)),
             $5, $6, $7,
             -- El casteo NO es adorno: sin el, Postgres infiere el '{}' como
             -- texto suelto y el COALESCE entero pasa a ser text, que no cabe
             -- en una columna text[]. (Y ojo: aqui dentro NO caben comillas
             -- invertidas, que esto es una plantilla de JS y la cortarian.)
             COALESCE($8::text[], '{}'::text[]), COALESCE($9::boolean, false), $10)
     RETURNING ${COLS}`,
    [projectId, data.clave, data.nombre, data.orden ?? null, data.cuando ?? null,
     data.dia_desde ?? null, data.dia_hasta ?? null, data.canales ?? null,
     data.es_seguimiento ?? null, data.nota ?? null]
  );
  return rows[0];
}

export async function update(id, data) {
  // `clave` NO esta en la lista a proposito: es por donde entra el codigo, y
  // dejar que se renombre desde la pantalla es exactamente como se rompe.
  const permitidos = ['nombre', 'orden', 'cuando', 'dia_desde', 'dia_hasta',
                      'canales', 'es_seguimiento', 'nota', 'activo', 'avisa_plazas'];
  const campos = [];
  const valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (data[k] !== undefined) { campos.push(`${k} = $${i++}`); valores.push(data[k]); }
  }
  if (campos.length === 0) return findById(id);
  campos.push('updated_at = NOW()');
  valores.push(id);
  const { rows } = await query(
    `UPDATE commercial_steps SET ${campos.join(', ')} WHERE id = $${i} RETURNING ${COLS}`,
    valores
  );
  return rows[0];
}

// Reordenar de una vez y en una transaccion: si se hiciera paso a paso y algo
// fallara por medio, la lista quedaria a medio ordenar y nadie lo sabria.
export async function reorder(projectId, idsEnOrden) {
  const { rows } = await query(
    `UPDATE commercial_steps s
        SET orden = nuevo.pos, updated_at = NOW()
       FROM (SELECT id::int, ordinality::int AS pos
               FROM unnest($2::int[]) WITH ORDINALITY AS t(id, ordinality)) AS nuevo
      WHERE s.id = nuevo.id AND s.project_id = $1
      RETURNING s.id`,
    [projectId, idsEnOrden]
  );
  return rows.length;
}

// Se desactiva, no se borra. Un paso borrado se lleva por delante la lectura de
// lo que ya paso: las interacciones viejas apuntaban a el.
export async function deactivate(id) {
  const { rows } = await query(
    `UPDATE commercial_steps SET activo = false, updated_at = NOW()
      WHERE id = $1 RETURNING ${COLS}`,
    [id]
  );
  return rows[0];
}

// ── LA AGENDA DE CADA PROSPECTO (#89 · #90) ─────────────────────────────────
//
// `commercial_steps` dice el proceso en general; esto dice a QUIEN le toca QUE
// y CUANDO. Se escribe al entrar la persona, no se calcula al vuelo: calcularlo
// vale para leer, pero no para trabajar —no deja ver la agenda por delante ni
// mover la fecha de alguien concreto—.
//
// SI UN PASO ESTA HECHO NO SE GUARDA: se deduce de los contactos reales. El
// contacto n.º N cierra el paso n.º N, que es la misma regla del embudo de
// Reportes, asi que los dos sitios cuentan igual. Un plan que hay que mantener
// a mano acaba mintiendo.

// La fecha de entrada manda, y es `fecha_solicitud`: dos tercios de los
// prospectos cargados tienen la solicitud anterior al alta.
const ENTRADA = `COALESCE(l.fecha_solicitud, l.created_at)`;

// Cuantas veces se ha contactado DE VERDAD con esta persona. Una nota interna
// no es contactar con nadie.
const CONTACTOS = `(SELECT count(*) FROM lead_interactions li
                     WHERE li.lead_id = l.id AND li.tipo <> 'nota')`;

/**
 * Escribe la agenda de un prospecto: un apunte por cada paso del proceso de su
 * proyecto, con la fecha contada desde que entro.
 *
 * Es idempotente —`ON CONFLICT DO NOTHING` sobre (lead_id, clave)—, asi que se
 * puede llamar dos veces sin duplicar, y volver a llamarla despues de anadir un
 * paso nuevo rellena solo lo que falta.
 *
 * El seguimiento mensual NO entra: no es del recorrido de una persona sino de
 * toda la base a fin de mes, y meterlo aqui llenaria la cola del dia con la
 * base entera.
 */
export async function planificarPasosDeLead(leadId) {
  const { rows } = await query(
    `INSERT INTO lead_steps (lead_id, project_id, step_id, clave, orden, fecha_prevista)
     SELECT l.id, l.project_id, s.id, s.clave, s.orden,
            (${ENTRADA}::date + COALESCE(s.dia_desde, 0))
       FROM leads l
       JOIN commercial_steps s ON s.project_id = l.project_id
      WHERE l.id = $1
        AND l.deleted_at IS NULL
        AND s.activo = true
        AND s.es_seguimiento = false
     ON CONFLICT (lead_id, clave) DO NOTHING
     RETURNING id`,
    [leadId]
  );
  return rows.length;
}

/**
 * La agenda de una persona, para su ficha (#89).
 *
 * Devuelve TODOS sus pasos en orden, cada uno con si esta hecho, si se salto y
 * cuantos dias lleva de retraso. El «siguiente» es el primero que no esta ni
 * hecho ni saltado.
 */
export async function pasosDeLead(leadId) {
  const { rows } = await query(
    `SELECT ls.id, ls.clave, ls.orden, ls.fecha_prevista, ls.estado, ls.nota,
            s.nombre, s.cuando, s.canales, s.nota AS nota_del_paso,
            COALESCE(s.avisa_plazas, false) AS avisa_plazas,
            (${CONTACTOS}) >= ls.orden AS hecho,
            (CURRENT_DATE - ls.fecha_prevista) AS dias_de_retraso
       FROM lead_steps ls
       JOIN leads l ON l.id = ls.lead_id
       LEFT JOIN commercial_steps s ON s.id = ls.step_id
      WHERE ls.lead_id = $1
      ORDER BY ls.orden, ls.id`,
    [leadId]
  );
  return rows.map((r) => ({
    ...r,
    dias_de_retraso: Number(r.dias_de_retraso),
    // Un paso vence solo si no esta hecho ni saltado. Uno hecho tarde ya no
    // urge: urge el siguiente.
    vencido: !r.hecho && r.estado === 'pendiente' && Number(r.dias_de_retraso) > 0,
  }));
}

/**
 * La cola del dia (#90): a quien le toca hoy, y quien viene arrastrado.
 *
 * Devuelve UNA fila por persona —su paso mas urgente—, no una por paso: la
 * gestora abre una ficha por persona, no una por apunte. Si alguien lleva tres
 * pasos sin hacer, lo que necesita es que le llamen, no salir tres veces.
 */
export async function colaDelDia({ projectIds, asesoraId, hasta = null, limite = 200 }) {
  const par = [];
  let i = 1;
  // Sin proyecto elegido, la cola es la del equipo: los de pruebas no
  // entran. Elegido a dedo si, que para eso es su cola.
  const pProj = Array.isArray(projectIds) && projectIds.length
    ? `AND ls.project_id = ANY($${i++}::int[])`
    : 'AND ls.project_id NOT IN (SELECT id FROM projects WHERE es_prueba)';
  // `if (pProj)` era SIEMPRE cierto —es una cadena no vacia en las dos ramas—
  // asi que con la lista vacia se empujaba un parametro de mas y la consulta
  // reventaba con «bind message supplies 2 parameters, but requires 1». No
  // salto antes porque el controlador siempre manda una lista con algo.
  if (Array.isArray(projectIds) && projectIds.length) par.push(projectIds.map(Number));
  const pAses = asesoraId ? `AND l.responsable_id = $${i++}` : '';
  if (asesoraId) par.push(asesoraId);
  const pHasta = hasta ? `$${i++}::date` : 'CURRENT_DATE';
  if (hasta) par.push(hasta);
  const pLimite = `$${i++}`;
  par.push(Number(limite) || 200);

  const { rows } = await query(
    `WITH pendientes AS (
       SELECT ls.*, l.responsable_id, l.nombre AS lead_nombre, l.status AS lead_estado,
              l.producto_interes_id,
              -- Para rellenar los huecos del mensaje sin salir de la cola
              -- (#88). Son los mismos datos con los que se rellena en el chat:
              -- si aqui se dejaran fuera, el mismo mensaje saldria a medias
              -- segun desde donde se copie.
              l.email AS lead_email, l.telefono AS lead_telefono,
              ${CONTACTOS} AS contactos,
              ROW_NUMBER() OVER (PARTITION BY ls.lead_id ORDER BY ls.orden) AS pos
         FROM lead_steps ls
         JOIN leads l ON l.id = ls.lead_id
        WHERE l.deleted_at IS NULL
          AND ls.estado = 'pendiente'
          AND ls.fecha_prevista <= ${pHasta}
          -- Quien ya compro o dijo que no, sale de la cola: seguir el proceso
          -- con alguien que ya cerro es hacerle perder el tiempo a las dos.
          AND l.status NOT IN ('convertido', 'no_interesado')
          -- El paso ya hecho no se pide otra vez.
          AND ${CONTACTOS} < ls.orden
          ${pProj} ${pAses}
     )
     SELECT q.lead_id, q.lead_nombre, q.lead_estado, q.responsable_id,
            q.lead_email, q.lead_telefono,
            q.clave, q.orden, q.fecha_prevista, q.contactos,
            -- De que campus es cada fila. Con una EMPRESA elegida la cola
            -- junta los siete de CEDIA, y sin esto no se sabe a quien se
            -- llama de parte de quien. Lo pidio Carlos el 11/09.
            q.project_id, pr.nombre AS proyecto,
            s.nombre AS paso_nombre, s.canales, s.nota AS paso_nota,
            u.nombre AS gestora,
            (CURRENT_DATE - q.fecha_prevista) AS dias_de_retraso,
            -- La formacion, para saber de que se habla sin salirse de la cola.
            -- Las plazas NO: solo la marca de que este paso las menciona y hay
            -- que ir a comprobarlas fuera.
            p.nombre AS producto, p.precio AS producto_precio,
            -- Cuando empieza y cuando cierra la convocatoria: son huecos de
            -- las plantillas y salen del catalogo, que es donde se mantienen.
            -- Las PLAZAS no, y no es un olvido: ver la cabecera del fichero.
            p.fecha_inicio_texto, p.fecha_cierre_convocatoria,
            COALESCE(s.avisa_plazas, false) AS avisa_plazas
       FROM pendientes q
       LEFT JOIN commercial_steps s ON s.id = q.step_id
       LEFT JOIN projects pr ON pr.id = q.project_id
       LEFT JOIN users u ON u.id = q.responsable_id
       LEFT JOIN products p ON p.id = q.producto_interes_id
      WHERE q.pos = 1
      ORDER BY q.fecha_prevista, q.orden, q.lead_id
      LIMIT ${pLimite}`,
    par
  );
  return rows.map((r) => ({
    ...r,
    dias_de_retraso: Number(r.dias_de_retraso),
  }));
}

/**
 * Cuantos hay atrasados, para hoy, para manana y para la semana. Para la
 * campana y el resumen: no hace falta traerse la lista entera para dar un
 * numero.
 */
export async function resumenDeLaCola({ projectIds, asesoraId }) {
  const par = [];
  let i = 1;
  // Sin proyecto elegido, la cola es la del equipo: los de pruebas no
  // entran. Elegido a dedo si, que para eso es su cola.
  const pProj = Array.isArray(projectIds) && projectIds.length
    ? `AND ls.project_id = ANY($${i++}::int[])`
    : 'AND ls.project_id NOT IN (SELECT id FROM projects WHERE es_prueba)';
  // `if (pProj)` era SIEMPRE cierto —es una cadena no vacia en las dos ramas—
  // asi que con la lista vacia se empujaba un parametro de mas y la consulta
  // reventaba con «bind message supplies 2 parameters, but requires 1». No
  // salto antes porque el controlador siempre manda una lista con algo.
  if (Array.isArray(projectIds) && projectIds.length) par.push(projectIds.map(Number));
  const pAses = asesoraId ? `AND l.responsable_id = $${i++}` : '';
  if (asesoraId) par.push(asesoraId);

  const { rows } = await query(
    `WITH pendientes AS (
       SELECT ls.lead_id, ls.fecha_prevista,
              ROW_NUMBER() OVER (PARTITION BY ls.lead_id ORDER BY ls.orden) AS pos
         FROM lead_steps ls
         JOIN leads l ON l.id = ls.lead_id
        WHERE l.deleted_at IS NULL AND ls.estado = 'pendiente'
          AND l.status NOT IN ('convertido', 'no_interesado')
          AND ${CONTACTOS} < ls.orden
          ${pProj} ${pAses}
     )
     SELECT count(*) FILTER (WHERE fecha_prevista < CURRENT_DATE)::int      AS atrasados,
            count(*) FILTER (WHERE fecha_prevista = CURRENT_DATE)::int      AS hoy,
            count(*) FILTER (WHERE fecha_prevista = CURRENT_DATE + 1)::int  AS manana,
            count(*) FILTER (WHERE fecha_prevista <= CURRENT_DATE + 7)::int AS esta_semana
       FROM pendientes WHERE pos = 1`,
    par
  );
  return rows[0];
}

/** Saltarse un paso o moverlo de fecha, a mano y con su porque. */
export async function ajustarPaso(id, { estado, fecha_prevista, nota }) {
  const { rows } = await query(
    `UPDATE lead_steps
        SET estado = COALESCE($2, estado),
            fecha_prevista = COALESCE($3::date, fecha_prevista),
            nota = COALESCE($4, nota),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, lead_id, clave, orden, fecha_prevista, estado, nota`,
    [id, estado || null, fecha_prevista || null, nota || null]
  );
  return rows[0] || null;
}

/**
 * EL SEGUIMIENTO DE FIN DE MES (#90): toda la base que no compro.
 *
 * Es el quinto paso del documento y NO es la cola del dia: la cola es el
 * recorrido de una persona --dia 1, dia 2, dia 4-- y esto es la lista entera de
 * quien entro hace tiempo, no compro y no dijo que no. Por eso se deja fuera de
 * `lead_steps` (`es_seguimiento = false` al planificar) y por eso tiene
 * pantalla propia: meterlo en la cola la llenaria con media base todos los dias.
 *
 * QUIEN ENTRA:
 *   · No ha comprado ni ha dicho que no.
 *   · Entro hace mas de `desdeDias` (15 por defecto): ya paso su dia 4, asi que
 *     el recorrido normal se acabo sin cerrar.
 *   · NO se le ha tocado en los ultimos `descansoDias` (30 por defecto). Sin
 *     esto, quien se repasa hoy vuelve a salir mañana y la lista deja de
 *     significar «pendientes de reactivar» para significar «todos».
 *
 * EL ORDEN es por quien lleva mas tiempo sin noticias, y los que nunca se
 * tocaron primero: son los que de verdad se perdieron por el camino.
 */
/**
 * La base del repaso de fin de mes.
 *
 * FILTRA Y PAGINA EN EL SERVIDOR, no en la pantalla. Diego, 23/09: «aun faltan
 * los filtros aqui y la paginacion». Filtrar sobre lo ya cargado habria sido
 * mas rapido de escribir y habria mentido: la base son miles y la pantalla solo
 * tenia las primeras 500, asi que buscar «Gabriela» habria dicho «no hay
 * ninguna» cuando la hay en la pagina cuatro.
 *
 * Devuelve `{ filas, total }`: el total es el de TODO lo que cumple el filtro,
 * no el de la pagina, que es lo que hace falta para poder paginar y para que el
 * rotulo de arriba no se contradiga con la lista.
 */
export async function baseDeSeguimiento({
  projectIds, projectId = null, asesoraId = null,
  desdeDias = 15, descansoDias = 30, limite = 500, desplazamiento = 0,
  busca = null, productoId = null, antiguedad = null, sinContactar = false,
} = {}) {
  const par = [];
  let i = 1;
  const ids = comoLista(projectId, projectIds);
  const pProj = ids
    ? `AND l.project_id = ANY($${i++}::int[])`
    : `AND l.project_id NOT IN (SELECT id FROM projects WHERE es_prueba)`;
  if (ids) par.push(ids);
  const pAses = asesoraId ? `AND l.responsable_id = $${i++}` : '';
  if (asesoraId) par.push(asesoraId);
  const ULTIMO_SQL = `(SELECT max(li.fecha) FROM lead_interactions li
                    WHERE li.lead_id = l.id AND li.tipo <> 'nota')`;
  const ULTIMO = ULTIMO_SQL;

  const pDesde = `$${i++}`; par.push(Number(desdeDias) || 15);
  const pDescanso = `$${i++}`; par.push(Number(descansoDias) || 30);

  // ── Los filtros de la pantalla ────────────────────────────────────────────
  // Buscar por nombre, correo o telefono, como en Prospectos. Sin tildes no:
  // se busca tal cual, que es lo que hace el listado de al lado y cambiarlo
  // aqui solo haria que las dos pantallas encontraran cosas distintas.
  let pBusca = '';
  if (busca && String(busca).trim()) {
    const q = `%${String(busca).trim()}%`;
    pBusca = `AND (l.nombre ILIKE $${i} OR l.email ILIKE $${i} OR l.telefono ILIKE $${i})`;
    i += 1;
    par.push(q);
  }
  const pProd = productoId ? `AND l.producto_interes_id = $${i++}` : '';
  if (productoId) par.push(Number(productoId));

  // Quien no ha sido contactado NUNCA. Es distinto de «lleva mucho»: a este no
  // le ha escrito nadie desde que entro, y es el que mas urge.
  const pNunca = sinContactar ? `AND ${ULTIMO_SQL} IS NULL` : '';

  // El bloque de antiguedad se traduce a dias AQUI y no en la pantalla, con los
  // mismos cortes que `bloqueDeAntiguedad`: si cada sitio pusiera los suyos, el
  // contador de arriba y la lista dirian cosas distintas.
  const CORTES = {
    este_mes: [0, 30], uno_a_tres: [30, 90], tres_a_seis: [90, 180], mas_de_seis: [180, null],
  };
  let pAntig = '';
  if (antiguedad && CORTES[antiguedad]) {
    const [desde, hasta] = CORTES[antiguedad];
    pAntig = `AND (CURRENT_DATE - ${ENTRADA}::date) >= ${desde}`;
    if (hasta != null) pAntig += ` AND (CURRENT_DATE - ${ENTRADA}::date) < ${hasta}`;
  }

  const DONDE = `WHERE l.deleted_at IS NULL
        AND l.status NOT IN ('convertido', 'no_interesado')
        AND ${ENTRADA}::date <= CURRENT_DATE - ${pDesde}::int
        AND (${ULTIMO_SQL} IS NULL OR ${ULTIMO_SQL}::date <= CURRENT_DATE - ${pDescanso}::int)
        ${pProj} ${pAses} ${pBusca} ${pProd} ${pNunca} ${pAntig}`;

  // Cuantos hay en total con este filtro. Va antes del LIMIT y con los mismos
  // parametros: sin esto no se puede paginar sin inventarse el numero.
  const { rows: cuenta } = await query(
    `SELECT count(*)::int AS total FROM leads l ${DONDE}`, par);
  const total = cuenta[0]?.total || 0;

  const pLimite = `$${i++}`; par.push(Number(limite) || 500);
  const pSalto = `$${i++}`; par.push(Number(desplazamiento) || 0);

  const { rows } = await query(
    `SELECT l.id AS lead_id, l.nombre AS lead_nombre, l.status AS lead_estado,
            l.responsable_id, l.email AS lead_email, l.telefono AS lead_telefono,
            l.project_id, pr.nombre AS proyecto,
            u.nombre AS gestora,
            p.nombre AS producto, p.precio AS producto_precio,
            p.fecha_inicio_texto, p.fecha_cierre_convocatoria,
            ${ENTRADA}::date AS fecha_entrada,
            (CURRENT_DATE - ${ENTRADA}::date) AS dias_desde_entrada,
            ${ULTIMO} AS ultimo_contacto,
            (CURRENT_DATE - ${ULTIMO}::date) AS dias_sin_contacto,
            ${CONTACTOS} AS contactos,
            -- El paso de fin de mes de SU proyecto: de ahi salen los canales,
            -- la chuleta y --lo que importa-- la clave con la que la pantalla
            -- encuentra sus plantillas.
            s.clave, s.orden, s.nombre AS paso_nombre, s.canales, s.nota AS paso_nota,
            COALESCE(s.avisa_plazas, false) AS avisa_plazas
       FROM leads l
       LEFT JOIN projects pr ON pr.id = l.project_id
       LEFT JOIN users u ON u.id = l.responsable_id
       LEFT JOIN products p ON p.id = l.producto_interes_id
       LEFT JOIN commercial_steps s
              ON s.project_id = l.project_id AND s.es_seguimiento = true AND s.activo = true
      ${DONDE}
      ORDER BY ${ULTIMO} ASC NULLS FIRST, ${ENTRADA} ASC
      LIMIT ${pLimite} OFFSET ${pSalto}`,
    par
  );

  const filas = rows.map((r) => ({
    ...r,
    dias_desde_entrada: Number(r.dias_desde_entrada),
    dias_sin_contacto: r.dias_sin_contacto == null ? null : Number(r.dias_sin_contacto),
    contactos: Number(r.contactos),
    // Cuanto hace que entro, en bloques. Se decide aqui y no en la pantalla
    // para que el recuento de arriba y las filas no puedan discrepar.
    antiguedad: bloqueDeAntiguedad(Number(r.dias_desde_entrada)),
  }));
  return { filas, total };
}

/** En que bloque cae alguien segun cuanto hace que entro. */
function bloqueDeAntiguedad(dias) {
  if (dias < 30) return 'este_mes';
  if (dias < 90) return 'uno_a_tres';
  if (dias < 180) return 'tres_a_seis';
  return 'mas_de_seis';
}

/**
 * Cuantos hay en el repaso de fin de mes, por antiguedad.
 *
 * Va aparte de la lista porque la lista tiene tope --500-- y con la base entera
 * de una empresa se llega siempre. Un «500» de cabecera no seria un dato, seria
 * el limite disfrazado de dato.
 */
export async function resumenDeSeguimiento({
  projectIds, projectId = null, asesoraId = null, desdeDias = 15, descansoDias = 30,
} = {}) {
  const par = [];
  let i = 1;
  const ids = comoLista(projectId, projectIds);
  const pProj = ids
    ? `AND l.project_id = ANY($${i++}::int[])`
    : `AND l.project_id NOT IN (SELECT id FROM projects WHERE es_prueba)`;
  if (ids) par.push(ids);
  const pAses = asesoraId ? `AND l.responsable_id = $${i++}` : '';
  if (asesoraId) par.push(asesoraId);
  const pDesde = `$${i++}`; par.push(Number(desdeDias) || 15);
  const pDescanso = `$${i++}`; par.push(Number(descansoDias) || 30);

  const ULTIMO = `(SELECT max(li.fecha) FROM lead_interactions li
                    WHERE li.lead_id = l.id AND li.tipo <> 'nota')`;
  const DIAS = `(CURRENT_DATE - ${ENTRADA}::date)`;

  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ${DIAS} < 30)::int                      AS este_mes,
            count(*) FILTER (WHERE ${DIAS} >= 30 AND ${DIAS} < 90)::int    AS uno_a_tres,
            count(*) FILTER (WHERE ${DIAS} >= 90 AND ${DIAS} < 180)::int   AS tres_a_seis,
            count(*) FILTER (WHERE ${DIAS} >= 180)::int                    AS mas_de_seis,
            count(*) FILTER (WHERE ${ULTIMO} IS NULL)::int                 AS nunca_contactados
       FROM leads l
      WHERE l.deleted_at IS NULL
        AND l.status NOT IN ('convertido', 'no_interesado')
        AND ${ENTRADA}::date <= CURRENT_DATE - ${pDesde}::int
        AND (${ULTIMO} IS NULL OR ${ULTIMO}::date <= CURRENT_DATE - ${pDescanso}::int)
        ${pProj} ${pAses}`,
    par
  );
  return rows[0];
}
