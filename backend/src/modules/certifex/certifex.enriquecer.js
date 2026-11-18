import { logger } from '../../shared/utils/logger.js';
import * as model from './certifex.model.js';
import { programasPara, datosDeCandidato } from './certifex.programa.js';

/**
 * Lo que el CRM añade a las filas de Certifex que aún no tienen título: lo revisado a mano
 * y el programa que se imprimiría. Lo usan Diplomas y, desde la #351 (prevención),
 * Certificaciones › Emisiones. Aquí, y no en certifex.diplomas.js, para que Emisiones no
 * importe de Diplomas (que ya importa de Emisiones): sin ciclos.
 */

/**
 * Lo revisado a mano de cada fila sin diploma (`edicion`): el correo del CRM, la
 * formacion elegida y el programa editado, con quien y cuando. null si no hay nada.
 * Si la base no contesta, el listado sale igual, sin ediciones.
 */
export async function conEdicion(filas) {
  const sinTitulo = filas.filter((c) => !c.nexpediente);
  for (const c of filas) c.edicion = null;
  if (!sinTitulo.length) return;
  try {
    const m = await model.edicionesDe(sinTitulo.map((c) => c.matriculaId));
    for (const c of sinTitulo) c.edicion = m.get(c.matriculaId) ?? null;
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo leer lo revisado a mano');
  }
}

/**
 * El programa que se imprimiria si se emite ahora (`programaCrm`): el de la formacion
 * vendida, o null con el motivo. Es lo que se revisa antes de aprobar.
 */
export async function conProgramaCrm(filas) {
  const sinTitulo = filas.filter((c) => !c.nexpediente);
  for (const c of filas) c.programaCrm = null;
  const m = await programasPara(sinTitulo.map(datosDeCandidato));
  for (const c of sinTitulo) c.programaCrm = m.get(c.matriculaId) ?? null;
}
