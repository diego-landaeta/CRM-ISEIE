import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { gestoresDelReparto } from '../leads/reparto.js';
import { activasEntre } from '../asignacion/asignacion.actividad.js';

// GET /api/projects/:id/ultimo-lead — que ha recibido cada gestora, de verdad
//
// Sustituye a `queue-state` como pantalla. Aquel anunciaba a quien le TOCA
// segun el round-robin del CRM, y ese round-robin no es quien reparte: los
// leads automaticos los asigna Make en el webhook y llegan con gestora puesta.
// Asi que acertaba en el caso raro —el alta a mano— y fallaba en el habitual,
// sin dar error y con un nombre que se lee como una certeza.
//
// Este mira lo ASIGNADO, no lo que se va a asignar, asi que es cierto venga el
// lead de donde venga.
//
// El dato que de verdad delata un reparto torcido no es el ultimo lead de cada
// una: es CUANTO LLEVA SIN RECIBIR UNO. Por eso va `horas_sin_recibir`.
export async function getUltimoLead(req, res, next) {
  try {
    // El id de la URL puede ser un proyecto, o `-1` cuando esta puesto «Todos
    // los proyectos», o venir acompañado de `issuerId` con una sociedad. Los
    // tres casos valen: la pantalla se mira desde arriba, y obligar a elegir un
    // campus para ver como reparte Make es pedir un dato que no hace falta.
    const crudo = parseInt(req.params.id);
    const issuerId = req.query.issuerId ? Number(req.query.issuerId) : null;

    let proyectos = null;                       // null = todos
    if (issuerId) {
      const { rows } = await query(
        `SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id`, [issuerId]);
      // Una sociedad sin campus NO puede acabar significando «todos».
      proyectos = rows.length ? rows.map((r) => r.id) : [-1];
    } else if (!isNaN(crudo) && crudo > 0) {
      proyectos = [crudo];
    }

    // La lista de quien entra en el reparto sale de `reparto.js`, la misma que
    // usa el alta: si aqui se hiciera una consulta propia, las dos se
    // desviarian y la pantalla contaria gente que no recibe.
    //
    // Con varios proyectos se pide para cada uno y se juntan sin repetir: una
    // gestora que trabaja en dos campus es una sola persona.
    const yaEsta = new Map();
    for (const p of (proyectos || (await query(
        `SELECT id FROM projects WHERE active`)).rows.map((r) => r.id))) {
      for (const g of await gestoresDelReparto(query, p)) {
        if (!yaEsta.has(g.id)) yaEsta.set(g.id, g);
      }
    }
    const gestores = [...yaEsta.values()];
    const projectId = proyectos && proyectos.length === 1 ? proyectos[0] : null;

    // Y ademas, quien HA RECIBIDO leads este mes aunque hoy no este en el
    // reparto — de vacaciones, o se fue. Sus numeros son historia y esconderlos
    // deja un hueco que parece un fallo.
    const { rows: filas } = await query(
      `WITH mios AS (
         SELECT l.id, l.nombre, l.responsable_id, l.producto_interes_id,
                COALESCE(l.fecha_solicitud, l.created_at) AS entro,
                l.landing_url, l.custom_fields,
                l.updated_at
           FROM leads l
          WHERE ($1::int[] IS NULL OR l.project_id = ANY($1::int[]))
            AND l.deleted_at IS NULL
            AND l.responsable_id IS NOT NULL
       ),
       ultimo AS (
         SELECT DISTINCT ON (responsable_id)
                responsable_id, id, nombre, entro, producto_interes_id,
                -- De donde entro. Es lo que Diego pide ver junto al nombre:
                -- no es lo mismo un lead de WhatsApp que uno de un anuncio.
                COALESCE(custom_fields->>'origen', custom_fields->>'canal',
                         CASE WHEN landing_url IS NOT NULL THEN 'Formulario web' END,
                         'Sin origen') AS canal
           FROM mios ORDER BY responsable_id, entro DESC
       )
       SELECT u.id, u.nombre AS gestora, u.avatar_url,
              ul.id   AS lead_id,
              ul.nombre AS lead_nombre,
              ul.entro  AS lead_entro,
              p.nombre  AS lead_producto,
              ROUND(EXTRACT(EPOCH FROM (NOW() - ul.entro)) / 3600)::int AS horas_sin_recibir,
              COUNT(*) FILTER (WHERE m.entro >= date_trunc('day',   NOW()))::int AS hoy,
              COUNT(*) FILTER (WHERE m.entro >= date_trunc('week',  NOW()))::int AS semana,
              COUNT(*) FILTER (WHERE m.entro >= date_trunc('month', NOW()))::int AS mes
         FROM users u
         LEFT JOIN ultimo ul ON ul.responsable_id = u.id
         LEFT JOIN mios   m  ON m.responsable_id  = u.id
         LEFT JOIN products p ON p.id = ul.producto_interes_id
        WHERE u.id = ANY($2::int[])
        GROUP BY u.id, u.nombre, u.avatar_url, ul.id, ul.nombre, ul.entro, p.nombre
        ORDER BY ul.entro DESC NULLS LAST`,
      [proyectos, gestores.map((g) => g.id)]
    );

    // Quien esta en el reparto y NO sale arriba es que nunca ha recibido: se
    // añade con todo a cero en vez de desaparecer. Una gestora que no recibe
    // nada es justo lo que hay que ver, y si no sale no se ve.
    const vistos = new Set(filas.map((f) => f.id));
    for (const g of gestores) {
      if (!vistos.has(g.id)) {
        filas.push({ id: g.id, gestora: g.nombre, avatar_url: g.avatar_url || null,
                     lead_id: null, lead_nombre: null, lead_entro: null,
                     lead_producto: null, horas_sin_recibir: null,
                     hoy: 0, semana: 0, mes: 0 });
      }
    }

    // QUIÉN ESTÁ ACTIVA AHORA (CRM#524, Carlos, 28/10: «para saber quién está
    // activa, que me haga un sombreado»). La misma regla que la asignación por
    // actividad —lo que cuenta como acción y lo que no— y la misma ventana que
    // tenga configurada el campus; con varios campus, la más corta.
    const { rows: [v] } = await query(
      `SELECT MIN(ventana_min)::int AS min FROM asignacion_destinos
        WHERE activo AND ($1::int[] IS NULL OR project_id = ANY($1::int[]))`, [proyectos]);
    const ventanaMin = v?.min || 5;
    const activas = await activasEntre(filas.map((f) => f.id), ventanaMin).catch(() => new Map());
    for (const f of filas) {
      const a = activas.get(Number(f.id));
      f.activa = a ? { hace_min: Math.max(0, Math.round((Date.now() - new Date(a.ultima).getTime()) / 60000)), que: a.que } : null;
    }

    const { rows: sueltos } = await query(
      `SELECT COUNT(*)::int AS n FROM leads
        WHERE ($1::int[] IS NULL OR project_id = ANY($1::int[]))
          AND responsable_id IS NULL AND deleted_at IS NULL`,
      [proyectos]
    );

    res.json({
      success: true,
      data: {
        gestoras: filas,
        sin_responsable: sueltos[0]?.n || 0,
        ventana_min: ventanaMin,
        // Se dice de donde viene el reparto para que nadie lea esta pantalla
        // como una prediccion. Es lo que paso, no lo que va a pasar.
        nota: `Sombreada, la que ha hecho algo en los últimos ${ventanaMin} min: con la asignación por actividad, el próximo formulario es para una de ellas (la que menos lleva hoy). Si no hay ninguna, reparte el turno de siempre.`,
      },
    });
  } catch (err) { next(err); }
}

// GET /api/projects/:id/queue-state — orden round-robin de gestores + siguiente
export async function getQueueState(req, res, next) {
  try {
    const projectId = parseInt(req.params.id);
    if (isNaN(projectId)) throw new AppError('ID invalido', 400, 'INVALID_ID');

    const { rows: gestores } = await query(
      `SELECT u.id, u.nombre, u.email, u.avatar_url, up.orden_cola, u.active
       FROM user_projects up
       JOIN users u ON u.id = up.user_id
       WHERE up.project_id = $1 AND up.active = true
         AND u.active = true
         AND u.role IN ('admin', 'gestor')
       ORDER BY up.orden_cola, u.id`,
      [projectId]
    );

    const { rows: state } = await query(
      `SELECT last_assigned_index, last_assigned_user_id, updated_at
       FROM project_queue_state WHERE project_id = $1`,
      [projectId]
    );

    const lastIndex = state[0]?.last_assigned_index ?? -1;
    const nextIndex = gestores.length > 0 ? (lastIndex + 1) % gestores.length : null;
    const nextGestor = nextIndex !== null ? gestores[nextIndex] : null;
    const lastGestor = state[0]?.last_assigned_user_id
      ? gestores.find(g => g.id === state[0].last_assigned_user_id) || null
      : null;

    res.json({
      success: true,
      data: {
        gestores,
        last_assigned_at: state[0]?.updated_at || null,
        last_gestor: lastGestor,
        next_gestor: nextGestor,
      },
    });
  } catch (err) { next(err); }
}

// Catálogo fijo de atajos disponibles del CRM hermano. Aquí se expone como
// referencia para el frontend; la persistencia (`projects.shortcuts` JSONB)
// vendrá en una migración posterior cuando se porte el módulo completo.
export const SHORTCUTS_CATALOG = [
  { id: 'new_lead',     label: 'Nuevo prospecto', icon: 'UserPlus',     route: '/leads?new=1' },
  { id: 'new_client',   label: 'Nuevo cliente',   icon: 'Building',     route: '/clientes?new=1' },
  { id: 'new_product',  label: 'Nuevo producto',  icon: 'Package',      route: '/products?new=1' },
  { id: 'new_form',     label: 'Nuevo formulario', icon: 'FileText',    route: '/formularios?new=1' },
  { id: 'new_webhook',  label: 'Nuevo webhook',   icon: 'Webhook',      route: '/webhooks?new=1' },
  { id: 'send_email',   label: 'Enviar email',    icon: 'Envelope',     action: 'open_email_dialog' },
  { id: 'reminder',     label: 'Crear recordatorio', icon: 'Bell',      action: 'open_reminder_dialog' },
  { id: 'note',         label: 'Nueva nota',      icon: 'NotePencil',   action: 'open_note_dialog' },
  { id: 'sync_wc',      label: 'Sincronizar WC',  icon: 'ArrowsClockwise', action: 'sync_woocommerce' },
  { id: 'reports',      label: 'Ver reportes',    icon: 'ChartBar',     route: '/reports' },
];

// GET /api/projects/shortcuts/catalog (todos los autenticados)
export async function getCatalog(req, res) {
  res.json({ success: true, data: SHORTCUTS_CATALOG });
}
