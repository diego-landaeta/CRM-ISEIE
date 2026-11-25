import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { certifex } from './certifex.cliente.js';
import { normalizarNombreDiploma } from './certifex.validation.js';

/*
  «Pasar a pendientes» (Diego, 22/10/2026: «que se pueda pasar de sin emitir a
  pendientes»), sin la petición HTTP alrededor. Lo usan:
    · el botón del panel Diplomas (`POST /diplomas/pedir`, certifex.diplomas.js);
    · el aviso de Moodle de curso terminado (#768, paso 1,
      diploma-confirmacion.moodle.js): al 100 % el CRM lo pasa solo a pendientes y
      le pide los datos (Diego, CRM#1048).

  Vive aparte (y con pocas dependencias) para que el módulo de la confirmación lo
  importe sin traerse todo el panel ni crear imports en círculo (#351).
*/

/** Las matrículas creadas desde el CRM («Nuevo diploma») llevan este `cursoRef` + id del producto. */
export const REF_CURSO_CRM = 900_000_000;

/**
 * ¿Le falta algo para darlo por terminado? (#629 / CRM-ISEIE #356). null si no.
 *
 * Certifex lo da por terminado si ha entregado todas las tareas que cuenta su plugin, y
 * hasta el plugin 2.8.2 contaba solo las visibles: en un máster con los módulos ocultos,
 * entregar el módulo 1 ya era «todas». Así que antes de pedirle el diploma se mira lo
 * que de verdad dice que terminó: la nota y las actividades calificadas. Con el campus sin
 * actividades publicadas (total 0) el avance no se sabe y no cuenta como que falte.
 * La misma regla y el mismo texto están en el frontal (piezas.tsx, `avisoSinTerminar`).
 */
export function avisoSinTerminar(c) {
  const total = Number(c?.actividades?.total) || 0;
  const calificadas = Number(c?.actividades?.calificadas) || 0;
  const faltaAvance = total > 0 && calificadas < total;
  const faltaNota = c?.notaFinal == null;
  if (!faltaAvance && !faltaNota) return null;
  const e = c?.entregas;
  const partes = [];
  if (e && Number(e.total) > 0) {
    partes.push(`${Number(e.entregadas) < Number(e.total) ? 'Solo ha' : 'Ha'} entregado ${Number(e.entregadas)} de ${Number(e.total)} tareas visibles`);
  } else {
    partes.push('No hay datos de sus tareas entregadas');
  }
  if (faltaAvance) partes.push(`tiene ${calificadas} de ${total} actividades calificadas`);
  if (faltaNota) partes.push('no tiene nota');
  const frase = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0];
  return { faltaAvance, faltaNota, mensaje: `${frase}: ¿seguro?` };
}

/**
 * Pide en Certifex el diploma de ESA matrícula de Moodle (la fila `c` de `/candidatos`),
 * como si lo pidiera el alumno: queda en «Por decidir» y desde ahí se revisa, se aprueba y
 * se emite como cualquier otra.
 *
 * Se hace con el «Nuevo diploma» de Certifex (`POST /matriculas`), mandándole el curso
 * con el nombre TAL CUAL está en Moodle: así Certifex engancha esa misma matrícula
 * (`matriculaDelMismoCurso`) en vez de crear una del CRM. El nombre, el correo, el DNI y
 * el curso salen de Certifex, nunca de quien lo pide. El nombre que se imprimirá es el de
 * Moodle; se revisa con «Editar» antes de aprobar.
 *
 * Si Certifex no devuelve esa matrícula (`vinculadaMoodle` y el mismo `matriculaId`), NO
 * se da por hecho: error claro (502 CERTIFEX_NO_ENGANCHA), diciendo lo que ha hecho en su
 * lugar. Si ya tenía diploma o ya estaba pedida, 409 y no se pide otra vez.
 *
 * Sin terminar (#629) es 409 `SIN_TERMINAR` salvo `forzar`. Los errores del propio Certifex
 * (no responde, clave…) salen tal cual los da `certifex()`.
 *
 * `creadoPor` es quien queda como autor en Certifex; `log`, lo que se añade al registro.
 * Devuelve `{ matriculaId, centro, curso, nombre, yaPedido, forzado }`.
 */
export async function pasarAPendientes(c, centro, { creadoPor, forzar = false, log = {} } = {}) {
  const cod = String(centro).toUpperCase();
  const matriculaId = Number(c.matriculaId);
  if (c.nexpediente) {
    throw new AppError(`Ya tiene el diploma emitido (${c.nexpediente}): está en Emitidos.`, 409, 'YA_EMITIDO');
  }
  if (c.solicitud) {
    throw new AppError('Ya está pedido: búscalo en Pendientes (o en Rechazados, si se rechazó).', 409, 'YA_PEDIDO');
  }
  // Lo creado desde el CRM («Nuevo diploma») no es de Moodle: no hay matrícula que enganchar.
  if (Number(c.curso?.ref) >= REF_CURSO_CRM) {
    throw new AppError('Esta matrícula no viene de Moodle: se creó desde el CRM. Búscala en Pendientes.', 409, 'NO_ES_DE_MOODLE');
  }
  const sinTerminar = avisoSinTerminar(c);
  if (sinTerminar && !forzar) throw new AppError(sinTerminar.mensaje, 409, 'SIN_TERMINAR');
  const email = String(c.titular?.email ?? '').trim().toLowerCase() || null;
  const dni = String(c.titular?.dni ?? '').trim() || null;
  if (!email && !dni) {
    throw new AppError('Este alumno no tiene correo ni DNI en Moodle: Certifex no puede encontrarlo para pedir su diploma.', 400, 'SIN_CORREO');
  }
  const curso = String(c.curso?.nombre ?? '').trim();
  if (!curso) throw new AppError('Certifex no da el nombre del curso de esta matrícula: no se puede pedir el diploma.', 502, 'CERTIFEX_SIN_CURSO');
  const nombre = normalizarNombreDiploma(c.titular?.nombre ?? '');
  if (!nombre) {
    throw new AppError(
      `El nombre que tiene en Moodle («${String(c.titular?.nombre ?? '').trim() || 'vacío'}») no vale para un diploma: hace falta nombre y apellidos, solo con letras. Corrígelo en Moodle y vuelve a intentarlo.`,
      400, 'NOMBRE_NO_VALIDO',
    );
  }

  const r = await certifex('POST', '/matriculas', {
    centro: cod, nombre, email, ...(dni ? { dni } : {}), curso, creadoPor,
  });
  const misma = Number(r?.matriculaId) === matriculaId;
  if (!r?.vinculadaMoodle || !misma) {
    logger.error({
      ...log, centro: cod, matriculaId,
      devuelta: r?.matriculaId ?? null, vinculadaMoodle: !!r?.vinculadaMoodle, nexpediente: r?.nexpediente ?? null,
    }, 'Certifex: «Pasar a pendientes» no enganchó la matrícula de Moodle');
    const queHizo = !r?.matriculaId
      ? 'Certifex no ha dicho qué matrícula ha usado.'
      : r.nexpediente
        ? `Ha encontrado otra matrícula de ese alumno en el mismo curso (nº ${r.matriculaId}) que ya tiene el diploma ${r.nexpediente}.`
        : r.vinculadaMoodle
          ? `Ha usado otra matrícula de Moodle de ese alumno en el mismo curso (nº ${r.matriculaId}): revisa en Pendientes cuál es la buena antes de aprobar.`
          : `Ha creado una solicitud aparte (nº ${r.matriculaId}), sin lo de Moodle, que saldrá en Pendientes: no la apruebes y pide a administración que la rechace.`;
    throw new AppError(`Certifex no ha enganchado esta matrícula de Moodle, así que no se ha pasado a Pendientes. ${queHizo}`, 502, 'CERTIFEX_NO_ENGANCHA');
  }
  if (r.nexpediente) {
    throw new AppError(`Ya tiene el diploma emitido (${r.nexpediente}): está en Emitidos.`, 409, 'YA_EMITIDO');
  }
  logger.info({
    ...log, centro: cod, matriculaId, yaPedido: !!r.yaExistia,
    ...(sinTerminar ? { forzado: true, faltaNota: sinTerminar.faltaNota, faltaAvance: sinTerminar.faltaAvance } : {}),
  }, 'Certifex: pasado a Pendientes');
  return { matriculaId, centro: cod, curso, nombre, yaPedido: !!r.yaExistia, forzado: !!sinTerminar };
}
