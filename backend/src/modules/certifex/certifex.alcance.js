import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { certifex, recorrer } from './certifex.cliente.js';
import { proyectosDeCentro } from './certifex.programa.js';

/**
 * QUE CAMPUS DE CERTIFEX VE CADA PERSONA (#272).
 *
 * El rol (admin) dice QUE puede hacer; esto dice SOBRE QUE campus. Sin esto, un admin
 * de un campus aprobaba, emitia, corregia o revocaba diplomas de todos los demas, y veia
 * los nombres y correos de sus alumnos. Misma regla que el resto del CRM (#245,
 * shared/utils/ambito.js): super admin ve todo; los demas, solo sus campus
 * (`user_projects` activos).
 *
 * Un campus de Certifex (ISEIE, PSIKO…) es de una persona si casa con UN proyecto del
 * CRM (la regla de `proyectosDeCentro`, la misma que busca el programa) y esa persona lo
 * tiene activo. Si casa con ninguno o con varios, solo lo ve super admin: no se adivina.
 *
 * Lo ajeno no se distingue de lo que no existe: listados vacios y, en las acciones, 404.
 */

const NO_ENCONTRADA = 'Matricula no encontrada (o no es de tus campus).';
const NO_ENCONTRADO = 'Diploma no encontrado (o no es de tus campus).';

/**
 * De los campus de este CRM en Certifex (`centrosCrm`), los que ve esa persona. null =
 * todos (super admin, o una persona que los tiene todos).
 */
export async function centrosPermitidos(user, centrosCrm) {
  if (veTodoElCrm(user)) return null;
  const mios = new Set(await campusDeLaPersona(user?.userId));
  if (!mios.size) return new Set();
  const { rows: proyectos } = await query(`SELECT id, nombre, slug FROM projects WHERE NOT COALESCE(es_prueba, false)`);
  const lista = (Array.isArray(centrosCrm) ? centrosCrm : []).map((c) => String(c).toUpperCase());
  const suyos = new Set(lista.filter((c) => {
    const proys = proyectosDeCentro(c, proyectos);
    return proys.length === 1 && mios.has(Number(proys[0].id));
  }));
  return lista.length && suyos.size === lista.length ? null : suyos;
}

/** Los campus que ve quien hace la peticion (null = todos). Super admin no pregunta nada. */
export async function alcanceDe(user) {
  if (veTodoElCrm(user)) return null;
  const yo = await certifex('GET', '/yo');
  return centrosPermitidos(user, yo?.centros);
}

/**
 * Como acotar un listado con ese alcance y el campus que se pide:
 *  · `{ centro }`: un campus (o ninguno = todos, si el alcance es null);
 *  · `{ centros }`: varios, sin pedir ninguno: se filtra fila a fila;
 *  · `{ vacio: true }`: nada que ensenar (campus ajeno, o la persona no tiene ninguno).
 */
export function acotar(alcance, pedido) {
  const centro = pedido ? String(pedido).toUpperCase() : undefined;
  if (!alcance) return { centro };
  if (centro) return alcance.has(centro) ? { centro } : { vacio: true };
  if (alcance.size === 0) return { vacio: true };
  if (alcance.size === 1) return { centro: [...alcance][0] };
  return { centros: alcance };
}

/** 404 si el campus no es de esta persona. */
export function exigirCentro(alcance, centro, mensaje = 'No encontrado.') {
  if (alcance && !alcance.has(String(centro ?? '').toUpperCase())) throw new AppError(mensaje, 404, 'NOT_FOUND');
}

/**
 * 404 si alguna de esas matriculas no es de esta persona. `centroDe` da el campus de
 * cada una (de lo guardado en el CRM o de Certifex); una que no aparece, tampoco pasa.
 */
export function exigirMatriculas(alcance, ids, centroDe) {
  if (!alcance) return;
  for (const id of ids) {
    const centro = centroDe(id);
    if (!centro || !alcance.has(String(centro).toUpperCase())) throw new AppError(`${NO_ENCONTRADA} (${id})`, 404, 'NOT_FOUND');
  }
}

/**
 * 404 si alguno de esos diplomas no es de esta persona. Pocos: se busca cada uno por su
 * numero (`q`); muchos: se recorre el listado hasta encontrarlos todos. Devuelve los diplomas que
 * ha consultado (Map numero → fila de Certifex), para no volver a pedirlos (#351, «Revertir»); sin
 * alcance que comprobar (super admin), no consulta nada y devuelve null.
 */
export async function exigirExpedientes(alcance, nexpedientes) {
  if (!alcance) return null;
  const buscados = new Set(nexpedientes.map((n) => String(n).toUpperCase()));
  const filaDe = new Map();
  if (buscados.size <= 5) {
    for (const nexp of buscados) {
      const d = await certifex('GET', `/diplomas?${new URLSearchParams({ estado: 'todos', q: nexp, pagina: '1', tam: '5' })}`);
      const f = (Array.isArray(d?.filas) ? d.filas : []).find((x) => x.nexpediente === nexp);
      if (f) filaDe.set(nexp, f);
    }
  } else {
    const r = await recorrer('/diplomas', { estado: 'todos' }, {
      filtro: (d) => buscados.has(d.nexpediente),
      completo: (hallados) => hallados.length >= buscados.size,
    });
    for (const d of r.filas) filaDe.set(d.nexpediente, d);
  }
  for (const nexp of buscados) {
    const centro = filaDe.get(nexp)?.centro;
    if (!centro || !alcance.has(String(centro).toUpperCase())) throw new AppError(`${NO_ENCONTRADO} (${nexp})`, 404, 'NOT_FOUND');
  }
  return filaDe;
}

export { NO_ENCONTRADA };
