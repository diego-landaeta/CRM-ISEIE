import * as leadModel from './lead.model.js';
import * as dupQueue from './dup-queue.service.js';
import * as leadProducts from './lead-products.service.js';
import { normalizePhone } from '../../shared/utils/normalizePhone.js';
import { logger } from '../../shared/utils/logger.js';

/*
  DUPLICADOS EN LAS ALTAS QUE NO PASAN POR EL WEBHOOK DE LEADS (Diego, 29/10/2026:
  «en ISECD las personas llegan duplicadas y no dice nada de que son duplicados»).

  ISECD, ISEF e ISSLOGG mandan el formulario de su web al webhook de FORMULARIOS
  (`/api/forms/...`), y ese camino —como el formulario incrustado y el webhook con
  token— creaba el lead sin mirar si ya existía: la misma persona que enviaba tres
  veces quedaba como tres leads sueltos, con tres gestoras distintas.

  Aquí, la misma regla que el webhook de leads (`createFromExternalWebhook`):
  · duplicado = un lead anterior del campus con el mismo correo, teléfono o usuario
    de WhatsApp; el nuevo se enlaza con `lead_duplicado_de`;
  · reincidente = además pide la misma formación;
  · reenvío (mismo correo/teléfono y misma formación en menos de 2 minutos, o lo que
    diga LEAD_BURST_WINDOW_SECONDS): no se crea otro lead, se apunta en el que ya hay.
*/

const ventanaRafaga = () => parseInt(process.env.LEAD_BURST_WINDOW_SECONDS || '120', 10);

/** Antes de crear el lead: si ya hay uno del mismo contacto en el campus, y si es un reenvío. */
export async function duplicadoParaAlta({ projectId, email, telefono, whatsappUsuario = null, productoInteresId = null }) {
  const tel = normalizePhone(telefono);
  const duplicate = (email || tel || whatsappUsuario)
    ? await leadModel.findDuplicateByEmailOrPhone(email || null, tel, projectId, whatsappUsuario || null)
    : null;
  const reincidente = !!(duplicate && productoInteresId && Number(duplicate.producto_interes_id) === Number(productoInteresId));
  const edadS = duplicate ? (Date.now() - new Date(duplicate.created_at).getTime()) / 1000 : Infinity;
  const ventana = ventanaRafaga();
  return {
    duplicate,
    duplicadoDe: duplicate ? duplicate.id : null,
    reincidente,
    reenvio: !!(duplicate && reincidente && ventana > 0 && edadS <= ventana),
    edadS,
  };
}

/** Un reenvío del mismo formulario: no hay lead nuevo, queda apuntado en el que ya había. */
export async function apuntarReenvio(dup, { notas = null, origen }) {
  const msg = notas ? ` — mensaje: "${String(notas).substring(0, 200)}"` : '';
  const texto = `🔁 Re-envío del mismo formulario (mismo producto) por ${origen} · hace ${Math.round(dup.edadS)}s${msg}`;
  await leadModel.createInteraction(dup.duplicate.id, 'nota', texto, null, null)
    .catch((err) => logger.warn({ err: err.message, leadId: dup.duplicate.id }, 'No se pudo apuntar el reenvío'));
  logger.info({ leadId: dup.duplicate.id, edadS: Math.round(dup.edadS), origen }, 'reenvío del formulario juntado con el lead que ya había');
  return dup.duplicate;
}

/** Después de crear el lead duplicado: la nota en los dos, la cola de revisión y el curso secundario. */
export function avisarDuplicado(lead, dup, { origen, productoInteresId = null }) {
  if (!dup?.duplicadoDe) return;
  const tag = dup.reincidente ? ' [REINCIDENTE — mismo producto]' : '';
  Promise.all([
    leadModel.createInteraction(lead.id, 'nota', `🔁 Marcado como duplicado del lead #${dup.duplicadoDe}${tag} — entrada por ${origen}.`, null, null),
    leadModel.createInteraction(dup.duplicadoDe, 'nota', `📌 Llegó un nuevo lead duplicado #${lead.id} (${lead.nombre || 'sin nombre'}) por ${origen}.${tag}`, null, null),
  ]).catch((err) => logger.warn({ err: err.message, leadId: lead.id, duplicadoDe: dup.duplicadoDe }, 'No se pudo apuntar el duplicado'));
  dupQueue.enqueue({
    leadId: lead.id,
    originalLeadId: dup.duplicadoDe,
    projectId: lead.project_id,
    matchByEmail: !!dup.duplicate?.match_by_email,
    matchByPhone: !!dup.duplicate?.match_by_phone,
    source: origen,
    leadName: lead.nombre,
  });
  if (productoInteresId && dup.duplicate && Number(dup.duplicate.producto_interes_id) !== Number(productoInteresId)) {
    leadProducts.autoAddFromReincidente({ originalLeadId: dup.duplicadoDe, newProductId: productoInteresId, newLeadId: lead.id, addedByUserId: null });
  }
}
