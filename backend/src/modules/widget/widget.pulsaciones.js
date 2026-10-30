import { query } from '../../shared/config/db.js';
import { ALTA_POR_WHATSAPP } from '../../shared/utils/origenDelLead.js';
import { SIN_PRUEBAS } from '../../shared/utils/ambito.js';

/*
  LAS PULSACIONES DEL BOTÓN DE WHATSAPP DE LAS WEBS (Diego, 29/10).

  «WhatsApp es que toquen el widget, y tocan y ellas cargan»: la persona pulsa
  el botón, se abre el WhatsApp de una gestora y la gestora da de alta el lead a
  mano. «Yo haría la 1, así medimos cuáles pulsan y cuántos pasan a la
  conversación.» Y luego: «hay que ir montando el segundo también».

  1. El código pegado en la web avisa al CRM de cada pulsación: a qué gestora
     mandó, desde qué página y cuándo (`apuntarPulsacion`).
  2. Cuando una gestora da de alta un lead con origen WhatsApp, se le cruza su
     última pulsación sin cruzar de las 24 h anteriores, y si el lead no tiene
     página de entrada se le pone la de la pulsación (`cruzarConPulsacion`).
  3. La pantalla del botón enseña, por gestora, pulsaciones, altas por WhatsApp
     y cuántas de esas altas tienen pulsación (`resumenDePulsaciones`).

  El cruce es por gestora y tiempo, no por persona: el botón no sabe quién es
  quien pulsa. Por eso se dice «con pulsación» y no «vino del botón».
*/

/** Cuánto puede tardar una gestora en dar de alta a quien le escribió por el botón. */
export const HORAS_PARA_CRUZAR = 24;
/** Dos pulsaciones de la misma visita a la misma gestora en este tiempo son una. */
export const SEGUNDOS_ENTRE_PULSACIONES = 30;

const recientes = new Map();

/** La página, sin lo que no sirve para saber el curso, y con un tope. */
export function limpiarPagina(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return null;
  try {
    const url = new URL(u);
    url.hash = '';
    // Los parámetros de seguimiento se quedan (dicen de qué anuncio vino); el resto, fuera.
    for (const k of [...url.searchParams.keys()]) {
      if (!/^(utm_|gclid$|fbclid$)/i.test(k)) url.searchParams.delete(k);
    }
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Apunta una pulsación. Solo si la gestora es una de las del botón de ese campus,
 * para que nadie llene la tabla con ids inventados. Devuelve si se apuntó.
 */
export async function apuntarPulsacion({ projectId, userId, pagina, idioma, quien, ahora = Date.now() }) {
  const pid = Number(projectId);
  const uid = Number(userId);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(uid) || uid <= 0) return false;

  const llave = `${quien || '?'}:${pid}:${uid}`;
  const antes = recientes.get(llave);
  if (antes && ahora - antes < SEGUNDOS_ENTRE_PULSACIONES * 1000) return false;
  recientes.set(llave, ahora);
  if (recientes.size > 5000) recientes.delete(recientes.keys().next().value);

  const { rowCount } = await query(
    `INSERT INTO widget_pulsaciones (project_id, user_id, pagina, idioma)
     SELECT $1, $2, $3, $4
      WHERE EXISTS (SELECT 1 FROM users u
                      JOIN user_projects up ON up.user_id = u.id AND up.project_id = $1 AND up.active
                     WHERE u.id = $2 AND u.active AND u.whatsapp_widget_active)`,
    [pid, uid, limpiarPagina(pagina), typeof idioma === 'string' ? idioma.slice(0, 5) : null]
  );
  return rowCount > 0;
}

/**
 * Al dar de alta un lead con origen WhatsApp: su gestora, su última pulsación sin
 * cruzar. Si el lead no tiene página de entrada, se le pone la de la pulsación,
 * que dice por qué curso preguntaba. Devuelve la pulsación cruzada o null.
 */
export async function cruzarConPulsacion({ leadId, projectId, userId }) {
  if (!leadId || !projectId || !userId) return null;
  const { rows } = await query(
    `UPDATE widget_pulsaciones SET lead_id = $1, cruzado_at = NOW()
      WHERE id = (SELECT id FROM widget_pulsaciones
                   WHERE project_id = $2 AND user_id = $3 AND lead_id IS NULL
                     AND creado_at > NOW() - make_interval(hours => $4)
                   ORDER BY creado_at DESC LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING id, pagina, creado_at`,
    [leadId, projectId, userId, HORAS_PARA_CRUZAR]
  );
  const p = rows[0];
  if (!p) return null;
  if (p.pagina) {
    await query(
      `UPDATE leads SET landing_url = $2, updated_at = NOW()
        WHERE id = $1 AND COALESCE(landing_url, '') = ''`,
      [leadId, p.pagina]
    );
  }
  return p;
}

/**
 * Las cifras de la pantalla, por gestora, en días de Madrid: pulsaciones, altas
 * por WhatsApp y cuántas de esas altas tienen una pulsación cruzada. Y las
 * páginas desde las que más se pulsa.
 *
 * Un campus, los de una empresa o, con `projectIds` null, todos menos los de
 * pruebas (Diego, 30/10: «sigue sin tener la vista de empresa»).
 */
export async function resumenDePulsaciones({ projectIds, from, to }) {
  const params = [projectIds || null, from, to];
  const enCampus = (col) => `($1::int[] IS NULL AND ${SIN_PRUEBAS(col)} OR ${col} = ANY($1::int[]))`;
  const enRango = (col) => `(${col} AT TIME ZONE 'Europe/Madrid')::date BETWEEN $2::date AND $3::date`;
  const [{ rows: porGestora }, { rows: paginas }] = await Promise.all([
    query(
      `WITH pul AS (
         SELECT user_id, count(*)::int AS pulsaciones
           FROM widget_pulsaciones
          WHERE ${enCampus('project_id')} AND ${enRango('creado_at')}
          GROUP BY user_id
       ), altas AS (
         SELECT l.responsable_id AS user_id, count(*)::int AS altas,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM widget_pulsaciones p WHERE p.lead_id = l.id))::int AS con_pulsacion
           FROM leads l
          WHERE ${enCampus('l.project_id')} AND l.deleted_at IS NULL
            AND ${enRango('l.created_at')} AND ${ALTA_POR_WHATSAPP('l')}
          GROUP BY l.responsable_id
       )
       SELECT u.id, u.nombre,
              COALESCE(pul.pulsaciones, 0) AS pulsaciones,
              COALESCE(altas.altas, 0) AS altas,
              COALESCE(altas.con_pulsacion, 0) AS con_pulsacion
         FROM users u
         LEFT JOIN pul ON pul.user_id = u.id
         LEFT JOIN altas ON altas.user_id = u.id
        WHERE pul.user_id IS NOT NULL OR altas.user_id IS NOT NULL
        ORDER BY COALESCE(pul.pulsaciones, 0) DESC, u.nombre`,
      params
    ),
    query(
      `SELECT regexp_replace(COALESCE(pagina, ''), '\\?.*$', '') AS pagina,
              count(*)::int AS pulsaciones,
              count(lead_id)::int AS con_alta
         FROM widget_pulsaciones
        WHERE ${enCampus('project_id')} AND ${enRango('creado_at')}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      params
    ),
  ]);
  return { porGestora, paginas };
}

export const _recientes = recientes;
