import { query } from '../../shared/config/db.js';

/**
 * Lo que hace falta de una persona para escribirle: a quién, de qué marca y por
 * qué formación preguntó. La marca sale del CAMPUS (logo y color), que es lo que
 * la persona reconoce: preguntó en la web de ISEIH, no en «el CRM».
 */
export async function datosDelLead(leadId) {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.status, l.project_id, l.responsable_id, l.deleted_at,
            p.nombre AS proyecto, p.logo_url, p.theme_color, COALESCE(p.es_prueba, false) AS es_prueba,
            -- Por to_jsonb: si la migracion 168 no esta aplicada, sale null en vez
            -- de reventar, y el correo firma con el remitente del CRM.
            to_jsonb(p) ->> 'remitente_no_contestar' AS remitente_no_contestar,
            to_jsonb(p) ->> 'color_cabecera' AS color_cabecera,
            pr.nombre AS producto
       FROM leads l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
      WHERE l.id = $1`,
    [leadId]);
  return rows[0] || null;
}

/**
 * La fila del envío. Si la persona ya tiene una, NO entra otra: lo impide la
 * base (UNIQUE lead_id) y aquí se devuelve null para que quien llama lo sepa.
 */
export async function crearEnvio({ leadId, projectId, gestoraId, disparador, estado, token, email, pedidoPor }) {
  const { rows } = await query(
    `INSERT INTO feedback_envios (lead_id, project_id, gestora_id, disparador, estado, token, email, pedido_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (lead_id) DO NOTHING
     RETURNING *`,
    [leadId, projectId, gestoraId, disparador, estado, token, email, pedidoPor]);
  return rows[0] || null;
}

/**
 * Cómo quedó el envío. `intento`: si de verdad se le pidió a Brevo (salió,
 * falló o lo paró el freno), cuenta para el tope de reintentos (#593).
 */
export async function marcarEnvio(id, { estado, enviado = false, nota = null, intento = false }) {
  const { rows } = await query(
    `UPDATE feedback_envios
        SET estado = $2,
            enviado_at = CASE WHEN $3 THEN NOW() ELSE enviado_at END,
            nota_envio = $4,
            intentos = intentos + CASE WHEN $5 THEN 1 ELSE 0 END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, estado, enviado, nota, intento]);
  return rows[0] || null;
}

export async function porLead(leadId) {
  const { rows } = await query('SELECT * FROM feedback_envios WHERE lead_id = $1', [leadId]);
  return rows[0] || null;
}

/** La encuesta, desde el enlace del correo: con la marca para pintarla. */
export async function porToken(token) {
  const { rows } = await query(
    `SELECT f.*, l.nombre AS lead_nombre, l.responsable_id AS responsable_actual,
            p.nombre AS proyecto, p.logo_url, p.theme_color,
            to_jsonb(p) ->> 'color_cabecera' AS color_cabecera,
            pr.nombre AS producto, u.nombre AS gestora_nombre,
            -- El nombre con el que la conocen los clientes: el mismo que enseña el
            -- widget de WhatsApp (widget.model). Sin él, su primer nombre.
            COALESCE(NULLIF(TRIM(u.whatsapp_display_name), ''), split_part(u.nombre, ' ', 1)) AS asesor_publico
       FROM feedback_envios f
       JOIN leads l ON l.id = f.lead_id
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
       LEFT JOIN users u ON u.id = f.gestora_id
      WHERE f.token = $1`,
    [token]);
  return rows[0] || null;
}

/**
 * La respuesta. Solo entra la PRIMERA: quien abre el enlace dos veces y contesta
 * otra cosa no reescribe lo que dijo, que es lo que ya vio su gestora.
 */
export async function guardarRespuesta(id, { motivo, comentario, respuestas = {} }) {
  const { rows } = await query(
    `UPDATE feedback_envios
        SET motivo = $2, comentario = $3, respuestas = $4::jsonb, respondido_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND respondido_at IS NULL AND estado = 'enviado'
      RETURNING *`,
    [id, motivo, comentario, JSON.stringify(respuestas)]);
  return rows[0] || null;
}

/**
 * «Que me contacte más adelante»: un recordatorio en la agenda de SU gestora
 * para el día que eligió. Es el recordatorio de siempre (`lead_reminders`):
 * le sale en «Hoy» y en la ficha, y ese día le llega el aviso.
 *
 * De la gestora que lleva AHORA al prospecto (`responsable_id`): el panel «Hoy»
 * enseña a cada una los que firmó ella, y el aviso del día va al responsable.
 * Si no tiene, a la que tenía cuando se le mandó el correo. Sin ninguna, no se
 * agenda (devuelve null) y el servicio lo deja dicho en el historial.
 *
 * Y que esté para atenderlo (#593): si la responsable está de baja o ya no
 * está (`active` / `is_available`), va a la del envío si esa sí está. Si
 * ninguna está, se le pone igual a la responsable —que no se pierda— y
 * `disponible` sale false para que el historial lo diga.
 */
export async function agendarVuelta(leadId, { dias, nota, gestoraDelEnvio = null }) {
  const { rows } = await query(
    `WITH quien AS (
       SELECT l.id AS lead_id, elegida.id AS gestora, elegida.disponible
         FROM leads l
         CROSS JOIN LATERAL (
           SELECT u.id, (u.active AND u.is_available) AS disponible
             FROM (VALUES (1, l.responsable_id), (2, $4::int)) AS c(orden, id)
             JOIN users u ON u.id = c.id
            ORDER BY (u.active AND u.is_available) DESC, c.orden
            LIMIT 1
         ) elegida
        WHERE l.id = $1
     )
     INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, created_by)
     SELECT q.lead_id, (NOW() AT TIME ZONE 'Europe/Madrid')::date + $2::int, $3, q.gestora
       FROM quien q
     RETURNING id, to_char(fecha_recordatorio, 'DD/MM/YYYY') AS dia, created_by,
               (SELECT disponible FROM quien) AS disponible`,
    [leadId, dias, nota, gestoraDelEnvio]);
  return rows[0] || null;
}

/**
 * A quién le toca el correo del 7.º día.
 *
 * Diego, 28/09: «el de 7 días se cuenta desde el PRIMER CONTACTO». No desde que
 * entró: quien entró y nadie llamó no ha tenido proceso del que opinar. El
 * primer contacto es la primera interacción que no es una nota interna —la
 * misma regla que el proceso comercial (`CONTACTOS` en proceso.model)—.
 *
 * Entra quien tuvo el primer contacto hace entre 7 y `maxDias` días (30 por
 * defecto): con margen para ir saliendo en tandas sin perder a nadie, pero sin
 * escribir de golpe a toda la base antigua al encenderlo. Los que más llevan
 * esperando, primero. No ha comprado, no ha dicho que no, tiene correo y nunca
 * se le preguntó. Los campus de pruebas no entran.
 */
/**
 * `inicio` (AAAA-MM-DD): solo quien tuvo su primer contacto ese día o después.
 * Diego, 29/09, al subirlo a producción: «se cuenta desde hoy, no antes». Sin
 * él, la ventana de siempre (7 a `maxDias` días).
 */
export async function candidatosDelDia7({ tope = 25, maxDias = 30, inicio = null } = {}) {
  // 7 DÍAS SIN NINGUNA INTERACCIÓN (Diego, 09/10: «a veces el proceso dura más
  // de una semana y lo manda»). Antes contaba 7 días desde el PRIMER contacto,
  // y le llegaba a gente con la que se seguía hablando. Ahora cuenta desde la
  // ÚLTIMA interacción de cualquier tipo —también una nota: es que alguien la
  // está trabajando—. Sigue haciendo falta un primer contacto (sin proceso no
  // hay nada que opinar), y `inicio` sigue mirando ese primer contacto.
  //
  // Y es por PERSONA, no por ficha (#169: «una vez por persona»; #593). La
  // persona es su correo: la misma con dos fichas —otro campus, un duplicado,
  // que se detectan por correo— es una sola. Por eso:
  //   · la última interacción es la de CUALQUIERA de sus fichas, y cuenta
  //     también WhatsApp (`wa_mensajes`): quien chatea no ha desistido;
  //   · quien compró con cualquiera de sus fichas no la recibe;
  //   · quien ya la recibió por otra ficha, tampoco;
  //   · y en una misma vuelta sale una sola, la de la ficha que más espera.
  const { rows } = await query(
    `SELECT id FROM (
       SELECT DISTINCT ON (lower(trim(l.email))) l.id, act.ultima
         FROM leads l
         JOIN projects p ON p.id = l.project_id AND NOT COALESCE(p.es_prueba, false)
         JOIN LATERAL (
           SELECT (MIN(li.fecha) FILTER (WHERE li.tipo <> 'nota'))::date AS primer_contacto
             FROM lead_interactions li
            WHERE li.lead_id = l.id
         ) pc ON pc.primer_contacto IS NOT NULL
         CROSS JOIN LATERAL (
           SELECT GREATEST(
                    (SELECT MAX(li.fecha) FROM lead_interactions li
                       JOIN leads o ON o.id = li.lead_id
                      WHERE lower(trim(o.email)) = lower(trim(l.email))),
                    (SELECT MAX(m.ts) FROM wa_conversaciones wc
                       JOIN leads o ON o.id = wc.lead_id
                       JOIN wa_mensajes m ON m.conversacion_id = wc.id
                      WHERE lower(trim(o.email)) = lower(trim(l.email)))
                  )::date AS ultima
         ) act
        WHERE l.deleted_at IS NULL
          AND l.status NOT IN ('convertido', 'no_interesado')
          AND NULLIF(TRIM(l.email), '') IS NOT NULL
          AND act.ultima BETWEEN CURRENT_DATE - $2::int AND CURRENT_DATE - 7
          AND ($3::date IS NULL OR pc.primer_contacto >= $3::date)
          AND NOT EXISTS (SELECT 1 FROM feedback_envios f WHERE f.lead_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM feedback_envios f
                           WHERE f.email IS NOT NULL AND lower(trim(f.email)) = lower(trim(l.email)))
          AND NOT EXISTS (SELECT 1 FROM leads o
                           WHERE lower(trim(o.email)) = lower(trim(l.email))
                             AND (o.status = 'convertido'
                                  OR EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = o.id)))
        ORDER BY lower(trim(l.email)), act.ultima, l.id
     ) persona
     ORDER BY ultima, id
     LIMIT $1`,
    [tope, maxDias, inicio]);
  return rows.map((r) => r.id);
}

/**
 * ¿Sigue tocándole? Lo mismo que mira el día 7, para una ficha concreta y sin
 * contar los días: antes de reintentar un correo que falló, la persona puede
 * haber comprado o haberla recibido ya por otra ficha (#593).
 */
export async function sigueTocandole(leadId) {
  const { rows } = await query(
    `SELECT 1
       FROM leads l
      WHERE l.id = $1
        AND l.deleted_at IS NULL
        AND l.status NOT IN ('convertido', 'no_interesado')
        AND NULLIF(TRIM(l.email), '') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM feedback_envios f
                         WHERE f.lead_id <> l.id AND f.estado = 'enviado'
                           AND f.email IS NOT NULL AND lower(trim(f.email)) = lower(trim(l.email)))
        AND NOT EXISTS (SELECT 1 FROM leads o
                         WHERE lower(trim(o.email)) = lower(trim(l.email))
                           AND (o.status = 'convertido'
                                OR EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = o.id)))`,
    [leadId]);
  return rows.length > 0;
}

/**
 * Los correos de feedback que no salieron y se pueden volver a intentar (#593):
 *   · `fallido`: Brevo no lo aceptó. Se espera unas horas por si era una caída.
 *   · `pendiente` de hace más de una hora: el proceso se cortó a mitad (un
 *     despliegue durante una tanda) y la fila se quedó sin terminar.
 * Como mucho tres intentos: un correo que no sale a la tercera está mal, y
 * reintentarlo para siempre solo gasta cupo.
 */
export async function reintentables({ tope = 25, maxIntentos = 3 } = {}) {
  const { rows } = await query(
    `SELECT f.*
       FROM feedback_envios f
      WHERE f.intentos < $2
        AND ((f.estado = 'fallido' AND f.updated_at < NOW() - INTERVAL '6 hours')
          OR (f.estado = 'pendiente' AND f.updated_at < NOW() - INTERVAL '1 hour'))
      ORDER BY f.updated_at, f.id
      LIMIT $1`,
    [tope, maxIntentos]);
  return rows;
}

/**
 * Cuántos correos de feedback han salido hoy, de los dos disparadores: el tope
 * de 200 al día es de correos, no de «días 7» (Diego, 28/09). Cuenta lo que
 * salió o lo intentó —en pruebas, lo que paró el freno también, para que el
 * ritmo se vea igual que en producción—; lo que espera revisión, no tenía
 * correo o se canceló no ha gastado nada.
 */
export async function correosDeHoy() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM feedback_envios
      WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid'
        AND estado NOT IN ('sin_correo', 'cancelado', 'revision')`);
  return rows[0].n;
}

/**
 * El recorte del panel y de su lista, en un solo sitio: si los números y la
 * lista de detrás se filtraran distinto, el «12» de arriba abriría 14 nombres.
 *
 *   · campus    : los que lleguen (un campus o los de una empresa); sin ninguno,
 *                 todos menos los de pruebas.
 *   · gestora   : una gestora solo ve lo suyo; un admin puede elegir una.
 *   · deUsuario : un admin que no es superadmin, solo sus campus.
 *   · fechas    : por el día en que SALIÓ el correo.
 */
function recorte({ projectIds, gestoraId, deUsuario, desde, hasta }, par) {
  const trozos = [];
  if (Array.isArray(projectIds) && projectIds.length) {
    par.push(projectIds.map(Number));
    trozos.push(`AND f.project_id = ANY($${par.length}::int[])`);
  } else {
    trozos.push('AND f.project_id NOT IN (SELECT id FROM projects WHERE COALESCE(es_prueba, false))');
  }
  // «sin»: la fila «Sin gestora» del desglose. Antes no mandaba nada y su
  // lista traía los envíos de todas (#593). Solo llega aquí para quien ve a
  // todas las gestoras (lo decide `recorteDe`).
  if (gestoraId === 'sin') {
    trozos.push('AND f.gestora_id IS NULL');
  } else if (gestoraId) {
    // Una o varias (el equipo de una administradora, 09/11/2026).
    par.push([].concat(gestoraId).map(Number));
    trozos.push(`AND f.gestora_id = ANY($${par.length}::int[])`);
  }
  if (deUsuario) {
    par.push(Number(deUsuario));
    trozos.push(`AND EXISTS (SELECT 1 FROM user_projects up
                              WHERE up.user_id = $${par.length} AND up.project_id = f.project_id AND up.active)`);
  }
  if (desde) {
    par.push(desde);
    trozos.push(`AND COALESCE(f.enviado_at, f.created_at)::date >= $${par.length}::date`);
  }
  if (hasta) {
    par.push(hasta);
    trozos.push(`AND COALESCE(f.enviado_at, f.created_at)::date <= $${par.length}::date`);
  }
  return trozos.join('\n        ');
}

/**
 * Las cifras del panel: enviados, respondidos y todo su desglose.
 *
 * «Enviados» son los que SALIERON (estado enviado). Los parados por el freno,
 * los que esperan revisión y los que no tenían correo se cuentan aparte: si
 * sumaran como enviados, el porcentaje de respuesta mentiría a la baja.
 */
export async function panel(filtros) {
  const par = [];
  const DONDE = recorte(filtros, par);
  const base = `FROM feedback_envios f
       LEFT JOIN users u ON u.id = f.gestora_id
       LEFT JOIN projects p ON p.id = f.project_id
      WHERE true
        ${DONDE}`;

  const [totales, porMotivo, porDisparador, porCampus, porGestora, porMes, porEmpresa] = await Promise.all([
    query(
      `SELECT count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos,
              count(*) FILTER (WHERE f.estado = 'revision')::int AS en_revision,
              count(*) FILTER (WHERE f.estado = 'bloqueado')::int AS bloqueados,
              count(*) FILTER (WHERE f.estado = 'sin_correo')::int AS sin_correo,
              count(*) FILTER (WHERE f.estado = 'fallido')::int AS fallidos
         ${base}`, par),
    // Los motivos, las notas y lo que se resume pregunta a pregunta cuentan lo
    // mismo que «Respondidos»: lo contestado de un correo que SALIÓ. Si no, las
    // barras podían sumar más que «Respondidos» y su lista salía con menos (#593).
    query(
      `SELECT f.motivo AS clave, count(*)::int AS n
         ${base}
          AND f.estado = 'enviado'
          AND f.respondido_at IS NOT NULL
        GROUP BY f.motivo
        ORDER BY n DESC`, par),
    query(
      `SELECT f.disparador AS clave,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos
         ${base}
        GROUP BY f.disparador
        ORDER BY enviados DESC`, par),
    query(
      `SELECT f.project_id, p.nombre,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos
         ${base}
        GROUP BY f.project_id, p.nombre
        ORDER BY enviados DESC, p.nombre`, par),
    query(
      `SELECT f.gestora_id, COALESCE(u.nombre, 'Sin gestora') AS nombre,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos,
              -- El único motivo que depende de nosotros, a la vista junto a su nombre.
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.motivo = 'sin_respuesta')::int AS no_le_contestaron,
              -- La nota que le ponen a su atencion (1 a 5), y de cuantas respuestas sale.
              round(avg((f.respuestas ->> 'nota_atencion')::numeric) FILTER (WHERE f.estado = 'enviado'), 1) AS nota_atencion,
              count(f.respuestas ->> 'nota_atencion') FILTER (WHERE f.estado = 'enviado')::int AS notas
         ${base}
        GROUP BY f.gestora_id, u.nombre
        ORDER BY enviados DESC, nombre`, par),
    query(
      `SELECT to_char(date_trunc('month', f.enviado_at), 'YYYY-MM') AS mes,
              count(*)::int AS enviados,
              count(*) FILTER (WHERE f.respondido_at IS NOT NULL)::int AS respondidos
         ${base}
          AND f.estado = 'enviado'
        GROUP BY 1
        ORDER BY 1`, par),
    // Por EMPRESA (Diego, 28/09: «tengo que verlo por empresa, no por proyecto
    // únicamente»): los campus agrupados por su sociedad. Un campus sin
    // sociedad va solo, con su nombre.
    query(
      `SELECT s.id AS issuer_id, CASE WHEN s.id IS NULL THEN f.project_id END AS project_id,
              COALESCE(s.razon_social, p.nombre) AS nombre,
              count(DISTINCT f.project_id)::int AS campus,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos,
              round(avg((f.respuestas ->> 'nota_atencion')::numeric) FILTER (WHERE f.estado = 'enviado'), 1) AS nota_atencion
         FROM feedback_envios f
         LEFT JOIN projects p ON p.id = f.project_id
         LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
        WHERE true
          ${DONDE}
        GROUP BY s.id, CASE WHEN s.id IS NULL THEN f.project_id END, COALESCE(s.razon_social, p.nombre)
        ORDER BY enviados DESC, nombre`, par),
  ]);

  // Todo lo contestado, para resumir pregunta a pregunta. Son decenas o
  // cientos: se resume en el servicio, que es quien sabe de que tipo es cada una.
  const { rows: contestadas } = await query(
    `SELECT f.respuestas, f.respondido_at, l.nombre AS lead_nombre, f.lead_id, u.nombre AS gestora
       FROM feedback_envios f
       JOIN leads l ON l.id = f.lead_id
       LEFT JOIN users u ON u.id = f.gestora_id
       LEFT JOIN projects p ON p.id = f.project_id
      WHERE f.respondido_at IS NOT NULL
        AND f.estado = 'enviado'
        ${DONDE}
      ORDER BY f.respondido_at DESC`, par);

  return {
    contestadas,
    totales: totales.rows[0],
    porMotivo: porMotivo.rows,
    porDisparador: porDisparador.rows,
    porCampus: porCampus.rows,
    porEmpresa: porEmpresa.rows,
    porGestora: porGestora.rows,
    porMes: porMes.rows,
  };
}

/**
 * Las personas que hay detrás de un número del panel.
 *
 *   que: enviados | respondidos | revision | bloqueados | sin_correo | fallidos
 *   y, si se abre desde un desglose: motivo, disparador, campus o gestora.
 */
export async function lista(filtros, { que = 'enviados', motivo = null, disparador = null, limite = 500 } = {}) {
  const par = [];
  const DONDE = recorte(filtros, par);
  const QUE = {
    enviados: `AND f.estado = 'enviado'`,
    respondidos: `AND f.estado = 'enviado' AND f.respondido_at IS NOT NULL`,
    revision: `AND f.estado = 'revision'`,
    bloqueados: `AND f.estado = 'bloqueado'`,
    sin_correo: `AND f.estado = 'sin_correo'`,
    fallidos: `AND f.estado = 'fallido'`,
  }[que] || `AND f.estado = 'enviado'`;
  let extra = '';
  if (motivo) { par.push(motivo); extra += ` AND f.motivo = $${par.length}`; }
  if (disparador) { par.push(disparador); extra += ` AND f.disparador = $${par.length}`; }
  // Hasta 5000: el CSV de respuestas las pide todas. La pantalla dice cuántas
  // enseña frente al total, en vez de cortar sin avisar (#593).
  par.push(Math.min(Number(limite) || 500, 5000));
  const { rows } = await query(
    `SELECT f.id, f.lead_id, l.nombre AS lead_nombre, f.email, f.project_id, p.nombre AS proyecto,
            u.nombre AS gestora, f.disparador, f.estado, f.enviado_at, f.respondido_at,
            f.motivo, f.comentario, f.nota_envio, f.created_at, f.respuestas
       FROM feedback_envios f
       JOIN leads l ON l.id = f.lead_id
       LEFT JOIN users u ON u.id = f.gestora_id
       LEFT JOIN projects p ON p.id = f.project_id
      WHERE true
        ${DONDE}
        ${QUE} ${extra}
      ORDER BY COALESCE(f.respondido_at, f.enviado_at, f.created_at) DESC
      LIMIT $${par.length}`, par);
  return rows;
}
