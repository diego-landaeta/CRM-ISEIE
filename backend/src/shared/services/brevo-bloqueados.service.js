import { logger } from '../utils/logger.js';
import { query } from '../config/db.js';
import { getDecryptedValue } from '../../modules/credentials/credentials.model.js';

/**
 * Las direcciones que Brevo se niega a entregar (lista de bloqueados de los
 * correos transaccionales).
 *
 * POR QUÉ EXISTE (17/11/2026, ISEIE): una gestora estuvo tres semanas sin
 * recibir NINGÚN aviso del CRM —prospectos asignados, resúmenes— porque Brevo
 * bloqueó su dirección el 26/10 tras un rebote duro: su buzón todavía no
 * existía. Desde entonces Brevo aceptaba cada envío con un 201 y lo tiraba; el
 * CRM apuntaba «enviado» y nadie se enteró.
 *
 * Aquí está solo la conversación con Brevo: qué cuentas hay, leer la lista y
 * sacar a alguien de ella. Cruzarla con el equipo y avisar es cosa de la tarea
 * (`jobs/brevoBloqueadosScheduler.js`).
 *
 * Interruptor: `BREVO_BLOQUEADOS_ACTIVO=true`. APAGADO de serie, y apagado no
 * se pregunta NADA a Brevo (ni la tarea ni el botón de desbloquear).
 */

const BREVO_API_URL = 'https://api.brevo.com/v3';
// El máximo que acepta Brevo por página.
const POR_PAGINA = 100;
// Tope de páginas por cuenta y vuelta (50 000 direcciones): una cuenta con
// muchos alumnos dados de baja no puede dejar la tarea dando vueltas sin fin.
const MAX_PAGINAS = 500;

export const bloqueadosActivo = () => {
  const v = String(process.env.BREVO_BLOQUEADOS_ACTIVO || '').toLowerCase();
  return v === 'true' || v === '1';
};

/** Lo que dice Brevo, en castellano. Los códigos son los de su API. */
const MOTIVOS = {
  hardBounce: 'Rebote duro: el buzón no existe o rechaza los correos',
  contactFlaggedAsSpam: 'Marcó un correo del CRM como spam',
  unsubscribedViaEmail: 'Se dio de baja desde el enlace de un correo',
  unsubscribedViaMA: 'Se dio de baja desde una automatización de Brevo',
  unsubscribedViaApi: 'Dado de baja por la API de Brevo',
  adminBlocked: 'Bloqueado a mano en el panel de Brevo',
};

export function motivoLegible(codigo, mensaje = null) {
  return MOTIVOS[codigo] || mensaje || codigo || 'Motivo desconocido';
}

/**
 * Las cuentas de Brevo que usa el CRM: la suya (base o .env) y la de cada marca
 * que tenga la propia (los avisos de un campus salen por la de su marca). Sin
 * repetir: dos marcas con la misma clave son la misma lista.
 *
 * `etiqueta` es lo que se guarda para saber dónde desbloquear: 'crm' o 'p:<id>'.
 */
export async function cuentasDeBrevo() {
  const cuentas = [];
  const vistas = new Set();
  const sumar = (etiqueta, apiKey) => {
    if (!apiKey || apiKey === 'test' || vistas.has(apiKey)) return;
    vistas.add(apiKey);
    cuentas.push({ etiqueta, apiKey });
  };

  let delCrm = null;
  try { delCrm = await getDecryptedValue('brevo', null); } catch (err) {
    logger.warn({ err: err.message }, 'Brevo bloqueados: no se pudo leer la clave del CRM');
  }
  sumar('crm', delCrm || process.env.BREVO_API_KEY || null);

  try {
    const { rows } = await query(
      `SELECT DISTINCT project_id FROM api_credentials
        WHERE service = 'brevo' AND active = true AND project_id IS NOT NULL
        ORDER BY project_id`
    );
    for (const r of rows) {
      try { sumar(`p:${r.project_id}`, await getDecryptedValue('brevo', r.project_id)); } catch (err) {
        logger.warn({ err: err.message, projectId: r.project_id }, 'Brevo bloqueados: no se pudo leer la clave de la marca');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Brevo bloqueados: no se pudieron listar las cuentas de las marcas');
  }
  return cuentas;
}

async function pedir(apiKey, ruta, { method = 'GET' } = {}) {
  const res = await fetch(`${BREVO_API_URL}${ruta}`, {
    method,
    headers: { 'api-key': apiKey, accept: 'application/json' },
  });
  return res;
}

/**
 * La lista entera de bloqueados de UNA cuenta, página a página.
 * Devuelve [{ email, codigo, mensaje, desde }]. Lanza si Brevo no contesta bien:
 * con la lista a medias no se puede decir quién ya NO está bloqueado.
 */
export async function listarBloqueados(apiKey) {
  const todos = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const res = await pedir(apiKey, `/smtp/blockedContacts?limit=${POR_PAGINA}&offset=${pagina * POR_PAGINA}`);
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '');
      throw new Error(`Brevo contestó ${res.status} al pedir los bloqueados: ${cuerpo.slice(0, 200)}`);
    }
    const datos = await res.json().catch(() => ({}));
    const lista = Array.isArray(datos?.contacts) ? datos.contacts : [];
    for (const c of lista) {
      if (!c?.email) continue;
      const desde = c.blockedAt ? new Date(c.blockedAt) : null;
      todos.push({
        email: String(c.email).trim().toLowerCase(),
        codigo: c.reason?.code || null,
        mensaje: c.reason?.message || null,
        desde: desde && !Number.isNaN(desde.getTime()) ? desde : null,
      });
    }
    const total = Number(datos?.count);
    if (lista.length < POR_PAGINA || (Number.isFinite(total) && todos.length >= total)) return todos;
  }
  logger.warn({ paginas: MAX_PAGINAS }, 'Brevo bloqueados: se llegó al tope de páginas');
  return todos;
}

/**
 * Saca una dirección de la lista de bloqueados de una cuenta. Un 404 cuenta
 * como hecho: ya no estaba (alguien la quitó desde el panel de Brevo).
 */
export async function desbloquearEnBrevo(apiKey, email) {
  const res = await pedir(apiKey, `/smtp/blockedContacts/${encodeURIComponent(email)}`, { method: 'DELETE' });
  if (res.ok || res.status === 404) return { ok: true, estado: res.status };
  const cuerpo = await res.text().catch(() => '');
  return { ok: false, estado: res.status, error: cuerpo.slice(0, 200) };
}
