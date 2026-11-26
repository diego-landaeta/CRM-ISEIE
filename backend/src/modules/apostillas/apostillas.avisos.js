import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import * as model from './apostillas.model.js';
import { textoDelEstado, rutaDeLaApostilla, DIAS_AVISO_DE_SERIE } from './apostillas.estados.js';

/*
  LOS AVISOS DE LAS APOSTILLAS (CRM#1130 / CRM-ISEIE#786). SOLO INTERNOS.

  Diego, 25/11/2026: NUNCA se manda un correo automático al alumno o al
  prospecto por la apostilla, ni al cambiar de estado ni por atasco. Los avisos
  son la campana del CRM, y nada más:

    · a la GESTORA de esa venta (la de la venta; si no tiene, la del cliente) y
      a quien la lleve (`responsable_id`), si es otra persona;
    · si no hay ninguna de las dos, a los admins del campus (y si el campus no
      tiene, a los superadmin).

  Este fichero solo usa `notifyUsers`. La prueba `apostillasSinCorreo.test.js`
  comprueba que ningún fichero de apostillas importa nada que envíe correos.

  Dos avisos:
    apostilla_nueva     una apostilla nueva por iniciar (al pagarse o venderse).
    apostilla_atascada  «La apostilla de X lleva N días en "Y"»: al llegar a los
                        N días del campus (7 si no se ha dicho otra cosa) y otra
                        vez cada N días mientras siga en ese paso.
*/

/** Personas activas de esa lista. */
async function activas(ids) {
  const lista = [...new Set(ids.filter((x) => x != null).map(Number))];
  if (!lista.length) return [];
  const { rows } = await query('SELECT id FROM users WHERE id = ANY($1::int[]) AND active', [lista]);
  return rows.map((r) => Number(r.id));
}

/** Los admins del campus; si no tiene ninguno, los superadmin. */
async function adminsDelCampus(projectId) {
  const { rows } = await query(
    `SELECT u.id FROM users u
      WHERE u.active AND u.role = 'admin'
        AND EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = $1 AND up.active)`,
    [projectId]);
  if (rows.length) return rows.map((r) => Number(r.id));
  const { rows: sa } = await query("SELECT id FROM users WHERE active AND role = 'superadmin'");
  return sa.map((r) => Number(r.id));
}

/** A quién le llega el aviso de esta apostilla (ver arriba). */
export async function destinatarios(a) {
  const suyas = await activas([a.gestora_id, a.responsable_id]);
  return suyas.length ? suyas : adminsDelCampus(a.project_id);
}

const deQuien = (a) => (a.cliente ? `de ${a.cliente}` : 'sin asociar');

export async function avisarNueva(a) {
  const a_quien = await destinatarios(a);
  if (!a_quien.length) return null;
  return notifyUsers({
    targetUserIds: a_quien,
    type: 'apostilla_nueva',
    title: a.cliente ? `Apostilla nueva de ${a.cliente}` : 'Apostilla nueva sin asociar',
    message: a.cliente
      ? 'Está pendiente de iniciar. Ábrela para empezar el trámite.'
      : 'Llegó el cobro y no se sabe de quién es: enlázala con su cliente en «Sin asociar».',
    link_path: rutaDeLaApostilla(a.id),
    metadata: { apostilla_id: a.id, lead_id: a.lead_id, conversion_id: a.conversion_id },
  });
}

export function tituloAtascada(a, dias) {
  return `La apostilla ${deQuien(a)} lleva ${dias} días en «${textoDelEstado(a.estado)}»`;
}

/**
 * Una vuelta del aviso de atascadas: las que llevan N días o más en el mismo
 * estado (sin contar Entregada ni Cancelada) y no se han avisado en los
 * últimos N días. Devuelve cuántas se han avisado.
 */
export async function avisarAtascadas() {
  const { rows } = await query(
    `SELECT a.id FROM apostillas a
       LEFT JOIN apostillas_ajustes aj ON aj.project_id = a.project_id
      WHERE a.estado NOT IN ('entregada', 'cancelada')
        AND a.estado_desde <= NOW() - make_interval(days => COALESCE(aj.dias_aviso, ${DIAS_AVISO_DE_SERIE}))
        AND (a.aviso_atasco_at IS NULL OR a.aviso_atasco_at < a.estado_desde
             OR a.aviso_atasco_at <= NOW() - make_interval(days => COALESCE(aj.dias_aviso, ${DIAS_AVISO_DE_SERIE})))
      ORDER BY a.id LIMIT 500`);
  let avisadas = 0;
  for (const { id } of rows) {
    try {
      const a = await model.porId(id);
      if (!a) continue;
      const a_quien = await destinatarios(a);
      if (a_quien.length) {
        await notifyUsers({
          targetUserIds: a_quien,
          type: 'apostilla_atascada',
          title: tituloAtascada(a, a.dias_en_estado),
          message: 'Mírala por si hay que empujar el trámite o cambiarla de paso.',
          link_path: rutaDeLaApostilla(a.id),
          metadata: { apostilla_id: a.id, estado: a.estado, dias: a.dias_en_estado },
        });
        avisadas++;
      }
      await query('UPDATE apostillas SET aviso_atasco_at = NOW() WHERE id = $1', [id]);
    } catch (err) {
      logger.warn({ err: err.message, apostillaId: id }, 'apostillas: no se pudo avisar de una atascada');
    }
  }
  return avisadas;
}
