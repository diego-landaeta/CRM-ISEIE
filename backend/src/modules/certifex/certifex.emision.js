import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './certifex.model.js';
import { certifex, recorrer } from './certifex.cliente.js';
import { programasPara, datosDeCandidato, tieneEdicion } from './certifex.programa.js';
import { alcanceDe, exigirMatriculas } from './certifex.alcance.js';
import { firmasParaEmitir } from './certifex.firma.js';
import { bloqueosDeConfirmacion, anotarEmisiones } from '../diploma-confirmacion/diploma-confirmacion.puerta.js';

/**
 * EMITIR CON EL PROGRAMA DEL CRM, desde cualquier pestaña (#272).
 *
 * Lo usan «Aprobar y emitir» y «Emitir» de Diplomas y el «Emitir» de la pestaña antigua
 * Certificaciones/Emisiones: una misma matricula se imprime igual la emita quien la
 * emita y desde donde la emita.
 *
 * Aqui no hay modo laxo. Si la base del CRM no contesta, se para ANTES de llamar a
 * Certifex (ni /decisiones ni /emitir): un diploma no se borra, y emitirlo con lo de
 * Moodle porque la base se cayo un momento seria imprimir lo que no era.
 *
 * El DNI es OBLIGATORIO (Diego, 20/10/2026: «revisa si los diplomas llevan el DNI porque es
 * obligatorio»). Vive en Certifex, en el titular, y el CRM no lo guarda: antes de aprobar o
 * emitir se le pregunta a Certifex por cada matricula. La que no lo tiene no se aprueba ni
 * se emite; si Certifex no contesta, no se aprueba ni se emite nada.
 */

/**
 * ¿Va la firma del alumno en el diploma? Diego, 20/10/2026: «las firmas no van en los
 * diplomas, solo el DNI». Apagado, ni se busca ni se manda `firmaAlumno` a Certifex (y un
 * item sin firma borra en Certifex la que tuviera guardada esa matricula: no sale). Para
 * volver a ponerla, true (y lo mismo en el panel: components/piezas.tsx).
 */
export const FIRMA_EN_DIPLOMA = false;

/** Lo que dice cada matricula que no se emite por el DNI (y su `codigo`, para el panel). */
export const FALTA_DNI = 'FALTA_DNI';
export const DNI_SIN_COMPROBAR = 'DNI_SIN_COMPROBAR';
export const MOTIVO_FALTA_DNI = 'No se ha emitido: falta el DNI (o NIE o pasaporte) del alumno, que es obligatorio en el diploma. Ponlo con «Sin DNI · Poner» y vuelve a emitir.';
const MOTIVO_DNI_SIN_COMPROBAR = 'No se ha emitido: Certifex no ha devuelto esta solicitud, así que no se puede comprobar el DNI del alumno, que es obligatorio en el diploma. Prueba de nuevo en un momento.';

/** El DNI tal y como lo da Certifex: vacío o solo espacios es no tenerlo (null). */
const dniDe = (c) => String(c?.titular?.dni ?? '').trim() || null;

/**
 * Lo que hace falta para buscar el programa de cada matricula: primero lo que guardo el
 * CRM al recibir la solicitud (con lo revisado a mano); lo que falte, de Certifex (lo
 * mas reciente primero). Si de una matricula el CRM solo tiene lo revisado (fila a
 * medias, sin campus), lo de Certifex se completa SIN perder lo revisado.
 *
 * Con `conDni` (para aprobar y emitir) se pregunta a Certifex por TODAS, tambien por las que
 * el CRM ya tiene guardadas, y cada una trae su `dni` (null si no lo tiene; sin `dni` si
 * Certifex no la ha devuelto). Lo guardado en el CRM sigue mandando en lo demas. Si Certifex
 * no contesta, lanza un 503: sin saber el DNI no se aprueba ni se emite nada.
 *
 * Lanza si la base no contesta.
 */
export async function datosPara(ids, { conDni = false } = {}) {
  let datos;
  try {
    datos = await model.datosDeSolicitudes(ids);
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudieron leer las solicitudes guardadas');
    throw new AppError('No se pudieron leer las solicitudes guardadas en el CRM: no se ha aprobado ni emitido nada. Prueba de nuevo en un momento.', 503, 'CRM_NO_CONTESTA');
  }
  const buscar = new Set(conDni ? ids : ids.filter((id) => !datos.get(id)?.centro));
  if (buscar.size) {
    let r;
    try {
      r = await recorrer('/candidatos', { estado: 'todas' }, {
        filtro: (c) => buscar.has(c.matriculaId),
        completo: (hallados) => new Set(hallados.map((c) => c.matriculaId)).size >= buscar.size,
      });
    } catch (e) {
      if (!conDni || e?.code === 'CERTIFEX_SIN_CONFIGURAR') throw e;
      logger.warn({ err: e.message, code: e?.code }, 'Certifex: no se pudo comprobar el DNI antes de emitir');
      throw new AppError(
        `No se ha podido comprobar en Certifex el DNI de los alumnos, que es obligatorio en el diploma: no se ha aprobado ni emitido nada. ${e?.message || 'Prueba de nuevo en un momento.'}`,
        503, 'CERTIFEX_NO_CONTESTA',
      );
    }
    for (const c of r.filas) {
      const guardada = datos.get(c.matriculaId);
      const dni = conDni ? { dni: dniDe(c) } : {};
      if (guardada?.centro) {
        datos.set(c.matriculaId, { ...guardada, ...dni });
        continue;
      }
      const edicion = tieneEdicion(guardada)
        ? { emailCrm: guardada.emailCrm, productoId: guardada.productoId, programaEditado: guardada.programaEditado }
        : c.edicion;
      datos.set(c.matriculaId, { ...datosDeCandidato({ ...c, edicion }), ...dni });
    }
    // Lo que ni el CRM ni Certifex saben de que campus es, no se usa: «no encontrada».
    for (const id of buscar) if (!datos.get(id)?.centro) datos.delete(id);
  }
  return datos;
}

/**
 * Antes de decidir o emitir nada: los datos, el DNI y el programa de cada matricula, en
 * modo estricto (lanza si el CRM o Certifex no contestan). `bloqueadas` (id → motivo) NO se
 * aprueban ni se emiten, y `codigos` (id → codigo) dice por que a quien lo quiera usar:
 *  · sin DNI (`FALTA_DNI`), o sin poder comprobarlo (`DNI_SIN_COMPROBAR`): es obligatorio;
 *  · con algo revisado a mano y aun asi sin programa: alguien quiso otra cosa que lo de
 *    Moodle, y caer a Moodle en silencio seria perder lo revisado.
 */
export async function prepararEmision(ids) {
  const datos = await datosPara(ids, { conDni: true });
  const programas = await programasPara(ids.map((id) => datos.get(id)).filter(Boolean), { estricto: true });
  const bloqueadas = new Map();
  const codigos = new Map();
  for (const id of ids) {
    const d = datos.get(id);
    const p = programas.get(id);
    if (!d || d.dni === undefined) {
      bloqueadas.set(id, MOTIVO_DNI_SIN_COMPROBAR);
      codigos.set(id, DNI_SIN_COMPROBAR);
    } else if (!d.dni) {
      bloqueadas.set(id, MOTIVO_FALTA_DNI);
      codigos.set(id, FALTA_DNI);
    } else if (tieneEdicion(d) && !p?.programa) {
      bloqueadas.set(id, `No se ha emitido: tiene datos revisados a mano y con ellos no sale el programa (${p?.motivo || 'sin motivo'}). Revísalo con «Editar».`);
    }
  }
  // Los datos confirmados por el alumno (#768). Solo con DIPLOMA_CONFIRMACION_ACTIVA y en
  // los campus donde esté encendido; apagado, ni una consulta. Como el programa: si la base
  // no contesta, no se emite nada (saldría sin saber si el alumno confirmó).
  try {
    const sinConfirmar = await bloqueosDeConfirmacion(ids, (id) => datos.get(id)?.centro);
    for (const [id, b] of sinConfirmar) {
      if (bloqueadas.has(id)) continue;
      bloqueadas.set(id, b.motivo);
      codigos.set(id, b.codigo);
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo mirar la confirmación de datos del alumno');
    throw new AppError('No se pudo comprobar en el CRM si el alumno confirmó sus datos: no se ha aprobado ni emitido nada. Prueba de nuevo en un momento.', 503, 'CRM_NO_CONTESTA');
  }
  // La firma del alumno (CRM #349), como el programa: si la base no contesta, no se emite
  // nada (un diploma no se borra, y saldría sin la firma que sí tenía). Con la firma fuera
  // del diploma (FIRMA_EN_DIPLOMA), ni se mira.
  let firmas = new Map();
  try {
    if (FIRMA_EN_DIPLOMA) firmas = await firmasParaEmitir(ids.map((id) => datos.get(id)).filter(Boolean));
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo mirar la firma del alumno');
    throw new AppError('No se pudo mirar la firma del alumno en el CRM: no se ha aprobado ni emitido nada. Prueba de nuevo en un momento.', 503, 'CRM_NO_CONTESTA');
  }
  return { datos, programas, bloqueadas, codigos, firmas };
}

/** El resultado de una matricula bloqueada: no ha llegado a Certifex, y se dice por que. */
export function resultadoBloqueado(matriculaId, { bloqueadas, codigos = new Map() }) {
  return {
    matriculaId, ok: false, fase: 'emitir_bloqueado', error: bloqueadas.get(matriculaId),
    ...(codigos.has(matriculaId) ? { codigo: codigos.get(matriculaId) } : {}),
  };
}

/**
 * Emite con el programa oficial de la formacion vendida, si se encuentra sin dudas. Lo
 * que no lo tiene (y no se reviso a mano) se emite igual, con lo de Moodle, y se marca
 * con `sinPrograma`. Las bloqueadas (sin DNI, o revisadas sin programa) vuelven con
 * `fase: 'emitir_bloqueado'` sin llegar a Certifex.
 *
 * Devuelve los resultados por matricula y, si la llamada entera fallo, el error tal cual
 * (con su codigo HTTP) para quien quiera relanzarlo.
 */
export async function emitirConPrograma(emitidaPor, ids, { datos = null, programas, bloqueadas, codigos = new Map(), firmas = new Map() }) {
  const porId = new Map();
  for (const id of ids) {
    if (bloqueadas.has(id)) porId.set(id, resultadoBloqueado(id, { bloqueadas, codigos }));
  }
  const aEmitir = ids.filter((id) => !bloqueadas.has(id));
  if (!aEmitir.length) return { porId, error: null };
  // `firmaAlumno` (data:image/png;base64): la firma sobre «El interesado». Un Certifex que
  // aún no la conoce la ignora, y el diploma sale con el nombre impreso, como antes. Con
  // FIRMA_EN_DIPLOMA apagado no se manda nunca, aunque quien llame traiga `firmas`.
  const firmaDe = (matriculaId) => (FIRMA_EN_DIPLOMA ? firmas.get(matriculaId) ?? null : null);
  const items = aEmitir.map((matriculaId) => {
    const p = programas.get(matriculaId)?.programa;
    const firma = firmaDe(matriculaId);
    return { matriculaId, ...(p ? { programa: p } : {}), ...(firma ? { firmaAlumno: firma } : {}) };
  });
  // Solo se dice que programa se mando si se emitio de verdad: con `yaExistia` (un doble
  // clic, o ya estaba emitido) el diploma es el de antes, no el de ahora.
  const marca = (r) => {
    if (!r.ok || r.yaExistia) return {};
    const p = programas.get(r.matriculaId);
    const firma = { firmaAlumno: !!firmaDe(r.matriculaId) };
    return p?.programa
      ? { ...firma, programa: { horas: p.programa.horas ?? null, modulos: p.programa.modulos.length, formacion: p.formacion?.nombre ?? null, ...(p.editado ? { editado: true } : {}) } }
      : { ...firma, sinPrograma: p?.motivo ?? 'No se encontró la matrícula para buscar su venta.' };
  };
  try {
    const em = await certifex('POST', '/emitir', { items, emitidaPor }, { timeoutMs: 180_000 });
    for (const r of em?.resultados ?? []) porId.set(r.matriculaId, { ...r, ...marca(r) });
    // Con qué datos salió cada diploma (#768): solo se apunta en las matrículas con
    // confirmación del alumno, y nunca para la emisión.
    await anotarEmisiones((em?.resultados ?? []).filter((r) => r.ok && !r.yaExistia && r.nexpediente).map((r) => {
      const p = programas.get(r.matriculaId);
      return {
        matriculaId: r.matriculaId,
        nexpediente: r.nexpediente,
        datos: {
          documento: datos?.get(r.matriculaId)?.dni ?? null,
          horas: p?.programa?.horas ?? null,
          formacion: p?.formacion?.nombre ?? null,
          modulos: p?.programa?.modulos?.length ?? null,
          emitidaPor,
        },
      };
    }));
    return { porId, error: null };
  } catch (e) {
    return { porId, error: e };
  }
}

/**
 * Emitir lo ya aprobado, con su programa, comprobando antes que cada matricula es de
 * los campus de quien emite. Si Certifex falla entero y no hay nada que contar, su
 * error sale tal cual (mismo codigo y mensaje).
 */
export async function emitirMatriculas(user, ids) {
  const alcance = await alcanceDe(user);
  const preparado = await prepararEmision(ids);
  exigirMatriculas(alcance, ids, (id) => preparado.datos.get(id)?.centro);
  const { porId, error } = await emitirConPrograma(user.email, ids, preparado);
  if (error && porId.size === 0) throw error;
  return ids.map((matriculaId) => porId.get(matriculaId) ?? { matriculaId, ok: false, error: error?.message || 'Certifex no contestó por esta matrícula' });
}
