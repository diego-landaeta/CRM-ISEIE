/**
 * El último golpe de cada webhook que entra.
 *
 * Parte de #26, que pide «Stripe — último cobro recibido y último webhook». Lo
 * primero ya estaba en `stripe_payments`; lo segundo no estaba en ninguna
 * parte: el webhook contesta y se olvida, y lo único que queda es una línea de
 * pino que nadie lee.
 *
 * Y hay un caso que merece verse en pantalla más que ningún otro. Cuando un
 * proyecto no tiene el secreto configurado, el webhook se RECHAZA con un 400:
 *
 *     logger.error({ projectId: pid }, 'Webhook de Stripe RECHAZADO: ...')
 *
 * Está bien rechazado —sin firma, esa URL sería un formulario público para
 * inventar cobros— y no se pierde dinero, porque el sondeo los recoge cada
 * cinco minutos. Pero hoy eso solo se descubre entrando por SSH a leer logs,
 * que es justo la pregunta que esta pantalla viene a quitar de en medio.
 *
 * En memoria, igual que el pulso de las tareas y por el mismo motivo: una tabla
 * serían tres migraciones sin aplicar en vez de dos, y esto no diría nada hasta
 * que alguien las corriera. Se pierde al reiniciar, y la pantalla ya enseña
 * cuánto lleva el servidor arriba para poder interpretarlo.
 */

import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

const ultimos = new Map();

/**
 * El mismo golpe, pero de UN campus y guardado en la base (CRM#533, migración
 * 293): la salud de las conexiones dice por campus si el webhook de Stripe
 * recibe avisos, y eso no puede depender de que el proceso no se haya reiniciado.
 *
 * Sin esperar y sin romper nada: el webhook contesta a Stripe igual aunque esto
 * falle (sin la 293, por ejemplo). Solo se apunta si el campus existe: la URL es
 * pública y cualquiera puede inventarse un número.
 */
export async function anotaRecepcion(fuente, projectId, resultado, motivo = null) {
  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) return;
  const acepta = resultado === 'aceptado';
  try {
    await query(
      `INSERT INTO webhook_recepciones (fuente, project_id, ultimo_at, resultado, motivo, ultimo_aceptado_at, aceptados, rechazados)
       SELECT $1::varchar, p.id, NOW(), $3::varchar, $4::text,
              CASE WHEN $5::boolean THEN NOW() END,
              CASE WHEN $5::boolean THEN 1 ELSE 0 END,
              CASE WHEN $5::boolean THEN 0 ELSE 1 END
         FROM projects p WHERE p.id = $2::int
       ON CONFLICT (fuente, project_id) DO UPDATE
         SET ultimo_at = NOW(),
             resultado = EXCLUDED.resultado,
             motivo = EXCLUDED.motivo,
             ultimo_aceptado_at = COALESCE(EXCLUDED.ultimo_aceptado_at, webhook_recepciones.ultimo_aceptado_at),
             aceptados = webhook_recepciones.aceptados + EXCLUDED.aceptados,
             rechazados = webhook_recepciones.rechazados + EXCLUDED.rechazados`,
      [fuente, pid, resultado, acepta ? null : (motivo ? String(motivo).slice(0, 200) : null), acepta]
    );
  } catch (err) {
    logger.warn({ fuente, projectId: pid, err: err.message }, 'webhook: no se pudo apuntar la recepción');
  }
}

/**
 * @param {string} fuente     'stripe', 'meta'...
 * @param {'aceptado'|'rechazado'|'error'} resultado
 * @param {string} [motivo]   solo cuando no se acepta
 * @param {number} [projectId] el campus, si se sabe: se guarda también en la base
 */
export function anotaWebhook(fuente, resultado, motivo = null, projectId = null) {
  if (projectId) anotaRecepcion(fuente, projectId, resultado, motivo);
  const previo = ultimos.get(fuente) || { aceptados: 0, rechazados: 0 };
  ultimos.set(fuente, {
    cuando: Date.now(),
    resultado,
    // Sin datos del evento: ni importes, ni correos, ni el cuerpo. Solo si
    // entró y por qué no, que es lo que #26 permite enseñar.
    motivo: motivo ? String(motivo).slice(0, 200) : null,
    aceptados: previo.aceptados + (resultado === 'aceptado' ? 1 : 0),
    rechazados: previo.rechazados + (resultado === 'aceptado' ? 0 : 1),
  });
}

export function ultimoWebhook(fuente) {
  const w = ultimos.get(fuente);
  if (!w) return null;
  return { ...w, cuando: new Date(w.cuando).toISOString() };
}

export const _internos = { ultimos };
