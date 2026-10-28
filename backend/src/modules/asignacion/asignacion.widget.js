import * as model from './asignacion.model.js';
import { activasEntre, cuentasDe, elegir } from './asignacion.actividad.js';

/*
  EL WIDGET DE WHATSAPP CON LA MISMA REGLA (CRM#513, fase 5).

  El código pegado en las webs —el de antes (`/api/w/whatsapp/:id.js`) y el de
  ahora (`/api/w/data/:id.json`)— elige AL AZAR entre las gestoras que le da el
  CRM. Así que no hace falta volver a pegar nada en ninguna web: si hay alguna
  gestora del widget activa, el CRM le da solo esa, la que toca por la regla de
  los formularios (activa en los últimos N minutos → menos asignados hoy en ese
  campus → menos en total allí → turno). Si no hay ninguna, o la asignación por actividad no está
  encendida en el campus, le da la lista entera y sigue al azar como siempre. Y
  si el CRM no contesta, el código de la web hace lo que hacía.

  Pulsar el botón no asigna nada (ver `asignacion.actividad.js`): cuenta cuando
  la persona escribe o cuando la gestora registra el lead.

  Las webs piden esto en cada visita, así que la decisión se guarda unos
  segundos por campus: sin esto, cada página vista serían tres consultas.
*/

export const SEGUNDOS_EN_MEMORIA = 20;
const memoria = new Map();

/** El id de la gestora del widget a la que le toca, o null (sigue al azar). */
export async function turnoDelWidget(projectId, ids, { ahora = Date.now() } = {}) {
  const lista = [...new Set((ids || []).map(Number).filter(Boolean))].sort((a, b) => a - b);
  if (lista.length < 2) return null;
  const llave = `${projectId}:${lista.join(',')}`;
  const guardado = memoria.get(llave);
  if (guardado && ahora - guardado.at < SEGUNDOS_EN_MEMORIA * 1000) return guardado.id;

  let id = null;
  const config = await model.paraCampus(projectId);
  if (config?.activo) {
    const activas = await activasEntre(lista, config.ventana_min);
    if (activas.size) id = elegir(activas.keys(), await cuentasDe([...activas.keys()], projectId)).elegida?.id ?? null;
  }
  memoria.set(llave, { id, at: ahora });
  if (memoria.size > 500) memoria.delete(memoria.keys().next().value);
  return id;
}

/** Las gestoras que se le dan a la web: solo la que toca, o todas si no toca ninguna. Nunca falla. */
export async function gestorasParaLaWeb(projectId, usuarios) {
  try {
    const id = await turnoDelWidget(projectId, usuarios.map((u) => u.id));
    const una = id ? usuarios.filter((u) => Number(u.id) === id) : [];
    return una.length ? una : usuarios;
  } catch {
    return usuarios;
  }
}

export const _memoria = memoria;
