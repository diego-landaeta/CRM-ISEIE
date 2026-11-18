/*
  LO QUE AVISA EL PLUGIN DEL CAMPUS (#679): cada mensaje privado, al momento.

  Con el plugin, al CRM le llegan TODOS los mensajes privados del campus, no solo
  los de las tutoras que tiene dadas de alta (la lectura cada 5 minutos solo mira
  esas). Qué se hace con cada uno:

    · lo escribe una tutora del CRM      → su respuesta, en la consulta de ese alumno;
    · lo escribe un alumno a personal     → consulta (nueva o la suya). Si el
      del campus o a una tutora del CRM     destinatario es tutora del CRM, para ella;
                                            si no (coordinación, un profesor sin
                                            ficha), al reparto de siempre;
    · lo escribe personal sin ficha       → no es del CRM: se ignora;
    · entre alumnos                       → no es una consulta: se ignora.

  CHAT DE GRUPO (plugin 1.9.0, opción B de la #285). «Entrar al chat» abre una
  conversación de grupo por alumno y curso con las tutoras de ese curso. Su aviso trae
  `grupo` (el alumno, el curso y quién está dentro). Una consulta = ese chat:

    · lo escribe el alumno                → consulta (nueva o la suya) de ese curso; se
                                            reparte entre las tutoras del curso como
                                            siempre (para métricas y «Mi campus»);
    · lo escribe CUALQUIER tutora de      → cuenta como respuesta, sea o no la tutora de
      dentro (con ficha o sin ella)         la consulta; sin ficha, con su nombre del campus.

  Lo repetido (el aviso de un mensaje que ya se leyó, o el de una respuesta que
  salió del propio CRM) lo descarta su id de Moodle, como en la lectura.
*/
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { textoDeMoodle } from '../../shared/services/moodle.client.js';
import * as model from './consultas.model.js';
import { entraMensajeDelAlumno, tutoresDelCampus, siYaEstaRepetido, campusConConsultas } from './consultas.service.js';
import { claveDelCampus, firmaValida, apuntarAviso } from './consultas.plugin.js';
import { avisoSchema } from './consultas.validation.js';

const NO_VALE = () => new AppError('Firma no válida', 401, 'INVALID_SIGNATURE');

const entero = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

/** Comprueba la firma y procesa el aviso. La firma, antes de leer nada del cuerpo. */
export async function recibirAviso(projectId, cuerpo, cabecera, { ahoraMs = Date.now() } = {}) {
  const clave = await claveDelCampus(projectId);
  if (!clave || !firmaValida(cabecera, cuerpo, clave, ahoraMs)) throw NO_VALE();
  let aviso;
  try {
    aviso = JSON.parse(cuerpo.toString('utf8'));
  } catch {
    throw new AppError('El aviso no es JSON', 400, 'VALIDATION_ERROR');
  }
  await apuntarAviso(projectId);
  return procesarAviso(projectId, aviso);
}

/**
 * Lo mismo para el aviso firmado y para el repaso. Primero, que el aviso tenga la forma que
 * manda el plugin (`avisoSchema`, con sus topes): en el chat de grupo puede no haber nadie
 * más dentro (todas «No disponible») y no hace falta `para`; en la conversación de un grupo
 * del curso escriben varios alumnos y, si escribe una tutora, no hay «alumno».
 */
export async function procesarAviso(projectId, avisoRecibido) {
  const valido = avisoSchema.safeParse(avisoRecibido);
  if (!valido.success) {
    const fallo = valido.error.issues[0];
    const donde = fallo?.path?.length ? ` (${fallo.path.join('.')})` : '';
    throw new AppError(`Aviso incompleto o no válido${donde}: ${fallo?.message || 'formato'}`, 400, 'VALIDATION_ERROR');
  }
  const aviso = valido.data;
  const m = aviso.mensaje;
  const de = aviso.de;
  const para = aviso.para?.[0] ?? null;
  const grupo = aviso.grupo ?? null;
  // «Leer las consultas» apagado en Integraciones: el campus no entra en el CRM, ni por
  // la lectura ni por el plugin. Y lo de antes de encenderlo, tampoco (como la lectura).
  const campus = (await campusConConsultas()).find((x) => x.projectId === Number(projectId));
  if (!campus) return { resultado: 'ignorado', motivo: 'consultas apagadas en este campus' };
  if (entero(m.fecha) && Number(m.fecha) * 1000 < campus.desde.getTime()) {
    return { resultado: 'ignorado', motivo: 'anterior a «Leer las consultas»' };
  }
  const externoId = Number(m.id);
  if (await model.existeMensajeExterno(projectId, externoId)) return { resultado: 'repetido' };

  const tutores = new Map((await tutoresDelCampus(projectId)).map((t) => [t.moodleId, t.tutorId]));
  const texto = textoDeMoodle(m.html);
  const escritoAt = entero(m.fecha) ? new Date(Number(m.fecha) * 1000) : new Date();
  const conversacionId = Number(m.conversacion_id);

  if (grupo) {
    return mensajeDelChatDeGrupo(projectId, { m, de, grupo, tutores, texto, externoId, escritoAt, conversacionId });
  }

  const tutorQueEscribe = tutores.get(Number(de.id));
  if (tutorQueEscribe) {
    const r = await siYaEstaRepetido(() => model.guardarRespuestaDesdeElCampus({
      projectId, conversacionId, alumnoMoodleId: Number(para.id),
      tutorId: tutorQueEscribe, texto, externoId, escritoAt,
    }));
    if (r.duplicado) return { resultado: 'repetido' };
    if (r.sinConsulta) return { resultado: 'ignorado', motivo: 'respuesta sin consulta' };
    return { resultado: 'respuesta', consultaId: r.consulta.id };
  }
  if (de.personal) return { resultado: 'ignorado', motivo: 'personal sin ficha en el CRM' };

  const tutorDestino = tutores.get(Number(para.id)) ?? null;
  if (!tutorDestino && !para.personal) return { resultado: 'ignorado', motivo: 'entre alumnos' };

  const r = await siYaEstaRepetido(() => entraMensajeDelAlumno({
    projectId, conversacionId,
    alumno: { moodleId: Number(de.id), nombre: de.nombre || null, email: de.email || null },
    // El curso, si el alumno entró por «Entrar al chat» de un curso (plugin 1.6.0).
    curso: entero(m.curso_id) ? { moodleId: Number(m.curso_id), nombre: null } : null,
    texto, externoId, escritoAt,
  }, { tutorPreferido: tutorDestino }));
  if (r.duplicado) return { resultado: 'repetido' };
  logger.info({ projectId, consultaId: r.consulta?.id, nueva: r.nueva }, 'consultas: mensaje del campus por el plugin');
  return { resultado: r.nueva ? 'consulta_nueva' : 'mensaje', consultaId: r.consulta?.id ?? null };
}

/** Quién está en el chat de grupo, tal como lo cuenta el plugin (ids de Moodle). */
function participantesDe(grupo) {
  if (!Array.isArray(grupo?.miembros)) return null;
  return grupo.miembros
    .filter((x) => entero(x?.id))
    .slice(0, 50)
    .map((x) => ({
      id: Number(x.id),
      nombre: x.nombre ? String(x.nombre).slice(0, 200) : null,
      tutora: Boolean(x.tutora),
      alumno: Boolean(x.alumno),
    }));
}

/**
 * Un mensaje de un chat de grupo (plugin 1.9.0). Dos clases:
 *
 *  · 'plugin': el chat del alumno con las tutoras de su curso. Lo que escribe el alumno es su
 *    consulta; lo que escribe cualquier tutora o personal de dentro, la respuesta.
 *  · 'curso' (#285): la conversación de un grupo del curso con una tutora dentro, donde
 *    escriben varios alumnos y también hablan entre ellos. Ahí:
 *      - solo es respuesta lo que escribe una tutora DE ESE CURSO (`de.tutora`), nunca por ser
 *        «personal» del campus;
 *      - lo de un alumno es su consulta, aparte de la de su chat con las tutoras, sin correo a
 *        la tutora, y asignada solo a una tutora que esté dentro (si no, la respuesta desde el
 *        CRM no podría salir);
 *      - una consulta cerrada NO se reabre con lo que escribe el alumno en el grupo: el mensaje
 *        queda dentro como contexto. Para una duda nueva tiene su chat con las tutoras
 *        («Entrar al chat»), que sí reabre. Así una charla entre alumnos no reabre nada;
 *      - lo que escribe una tutora cuenta como respuesta solo si hay UNA consulta esperando en
 *        ese grupo; con varias, se guarda como contexto en la que más lleva esperando, sin
 *        darla por respondida (no se sabe a cuál contesta).
 */
async function mensajeDelChatDeGrupo(projectId, {
  m, de, grupo, tutores, texto, externoId, escritoAt, conversacionId,
}) {
  const delCurso = grupo.tipo === 'curso';
  const cursoId = entero(grupo.curso?.id) ? Number(grupo.curso.id) : (entero(m.curso_id) ? Number(m.curso_id) : null);
  const participantes = participantesDe(grupo);
  const autorNombre = de.nombre ? String(de.nombre).slice(0, 200) : null;
  const tutorId = tutores.get(Number(de.id)) ?? null;

  // ¿Escribe el alumno? En el chat del plugin, el de la consulta; en un grupo del curso,
  // cualquiera que no sea tutora de ese curso.
  const alumno = delCurso
    ? (de.tutora ? null : { id: Number(de.id), nombre: de.nombre, email: de.email })
    : (Number(de.id) === Number(grupo.alumno.id) ? grupo.alumno : null);

  if (alumno) {
    // Solo puede llevarla una tutora (con ficha en el CRM) que esté dentro del grupo. En un
    // grupo del curso, siempre. En el chat del plugin, también: si se elegía entre todas las
    // tutoras del campus, podía tocarle una de otro curso, que no está en el chat, y el plugin
    // le rechaza la respuesta (prueba en Moodle 5.2, 10/11). Si ninguna de las de dentro tiene
    // ficha, el chat del plugin sigue como antes: cualquiera del campus.
    const conFicha = new Set((participantes || []).filter((x) => x.tutora).map((x) => tutores.get(x.id)).filter(Boolean));
    const dentro = delCurso ? conFicha : (conFicha.size ? conFicha : null);
    const r = await siYaEstaRepetido(() => entraMensajeDelAlumno({
      projectId, conversacionId,
      alumno: { moodleId: Number(alumno.id), nombre: alumno.nombre || de.nombre || null, email: alumno.email || de.email || null },
      curso: cursoId ? { moodleId: cursoId, nombre: grupo.curso?.nombre ? String(grupo.curso.nombre).slice(0, 255) : null } : null,
      texto, externoId, escritoAt, grupo: true, participantes,
      grupoTipo: delCurso ? 'curso' : 'plugin',
      // La de un grupo del curso es su propia consulta: no se une a la de su chat con las tutoras.
      unirPorCurso: !delCurso,
      reabrir: !delCurso,
    }, { avisar: !delCurso, soloEntre: dentro }));
    if (r.duplicado) return { resultado: 'repetido' };
    if (r.sinReabrir) return { resultado: 'contexto', motivo: 'consulta cerrada de un grupo del curso', consultaId: r.consulta.id };
    logger.info({ projectId, consultaId: r.consulta?.id, nueva: r.nueva, tipo: grupo.tipo || 'plugin' }, 'consultas: mensaje de un chat de grupo');
    return { resultado: r.nueva ? 'consulta_nueva' : 'mensaje', consultaId: r.consulta?.id ?? null };
  }

  // Responde alguien de dentro.
  let alumnoId;
  let cuentaComoRespuesta = true;
  if (delCurso) {
    const espera = await model.alumnoQueEsperaEnElGrupo(projectId, conversacionId);
    if (!espera) return { resultado: 'ignorado', motivo: 'respuesta sin consulta' };
    alumnoId = espera.alumno;
    cuentaComoRespuesta = espera.esperando <= 1;
  } else {
    if (!tutorId && !de.tutora && !de.personal) return { resultado: 'ignorado', motivo: 'no es tutora ni personal' };
    alumnoId = Number(grupo.alumno.id);
  }
  const r = await siYaEstaRepetido(() => model.guardarRespuestaDesdeElCampus({
    projectId, conversacionId, alumnoMoodleId: alumnoId, tutorId, texto, externoId, escritoAt,
    autorMoodleId: Number(de.id), autorNombre, participantes,
    cursoMoodleId: cursoId, grupo: true, cuentaComoRespuesta,
  }));
  if (r.duplicado) return { resultado: 'repetido' };
  if (r.sinConsulta) return { resultado: 'ignorado', motivo: 'respuesta sin consulta' };
  return { resultado: r.soloContexto ? 'contexto' : 'respuesta', consultaId: r.consulta.id };
}
