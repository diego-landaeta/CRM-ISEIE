import * as taskModel from './tasks.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { tieneRol } from '../../shared/utils/roles.js';
import { veTodoElCrm } from '../../shared/utils/ambito.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { buildPermissionsMap } from '../permissions/permissions.service.js';
import * as reglas from './tasks.reglas.js';
import * as eqModel from './tasks.equipos.model.js';
import { anotarCambioDeEstado } from './tasks.avisos-estado.js';
import {
  enviarCorreoAsignada,
  enviarCorreoDevuelta,
  enviarCorreoCerrada,
  enviarCorreoComentario,
  enviarCorreoSupervisor,
  enviarCorreoParaRevisar,
  AVISO_TAREA_SUPERVISOR,
  AVISO_TAREA_ASIGNADA,
  AVISO_TAREA_DEVUELTA,
  AVISO_TAREA_CERRADA,
  AVISO_TAREA_COMENTARIO,
} from './tasks.emails.js';

// Por debajo de este hueco entre dos vecinas se renumera la columna.
const HUECO_MINIMO = 0.001;

// Las dos columnas con reglas (decisión 4 de la #210): «En revisión» es lo que
// sale en «Por revisar» y «Hecha» la que cierra.
const EN_REVISION = 'en_revision';
const HECHA = 'hecha';

function truncar(str, max = 200) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

/** «10/10», en la zona de la oficina (APP_TIMEZONE), no en la del servidor. */
function formatearFechaTexto(fecha) {
  if (!fecha) return 'sin fecha límite';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return String(fecha);
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
  }).format(d);
}

const PRIORIDAD_ES = { baja: 'baja', media: 'media', alta: 'alta' };

/**
 * Una línea por cada campo que cambió, en castellano: «Cambió la fecha del
 * 10/10 al 14/10.». Los nombres (proyecto, área, responsable) salen de la
 * tarea antes y después del cambio, que ya los traen.
 */
function comentariosDeCambios(dif, antes, despues) {
  const lineas = [];
  const nombre = (t, campo, vacio) => t[campo] || vacio;
  if (dif.title) lineas.push(`Cambió el título de «${dif.title.antes}» a «${dif.title.despues}».`);
  if (dif.description) lineas.push(dif.description.despues ? 'Cambió la descripción.' : 'Quitó la descripción.');
  if (dif.priority) {
    lineas.push(`Cambió la prioridad de «${PRIORIDAD_ES[dif.priority.antes] || dif.priority.antes || 'media'}» a «${PRIORIDAD_ES[dif.priority.despues] || dif.priority.despues}».`);
  }
  if (dif.due_date) {
    lineas.push(`Cambió la fecha del ${formatearFechaTexto(dif.due_date.antes)} al ${formatearFechaTexto(dif.due_date.despues)}.`);
  }
  if (dif.project_id || dif.external_project_id) {
    const de = antes.project_name || antes.external_project_name || 'sin proyecto';
    const a = despues.project_name || despues.external_project_name || 'sin proyecto';
    if (de !== a) lineas.push(`Cambió el proyecto de «${de}» a «${a}».`);
  }
  if (dif.area_id) {
    lineas.push(`Cambió el área de «${nombre(antes, 'area_name', 'sin área')}» a «${nombre(despues, 'area_name', 'sin área')}».`);
  }
  if (dif.assigned_to) {
    lineas.push(`Cambió la persona asignada de «${nombre(antes, 'assigned_to_name', 'nadie')}» a «${nombre(despues, 'assigned_to_name', 'nadie')}».`);
  }
  if (dif.team_id) {
    lineas.push(`Cambió el equipo de «${nombre(antes, 'team_name', 'sin equipo')}» a «${nombre(despues, 'team_name', 'sin equipo')}».`);
  }
  if (dif.supervisor_id) {
    lineas.push(`Cambió el supervisor de «${nombre(antes, 'supervisor_name', 'nadie')}» a «${nombre(despues, 'supervisor_name', 'nadie')}».`);
  }
  return lineas;
}

/**
 * Lo que esta persona puede hacer en el tablero, con el sistema de claves de
 * siempre: rol, roles añadidos, rol a medida y excepciones personales. Es el
 * mismo mapa que recibe el frontal en /auth/me, así que pantalla y servidor
 * deciden con lo mismo.
 *
 * Nadie entra por su rol: un admin aprueba porque su rol trae `tasks.close`
 * por defecto, y si en Configuración › Roles se le quita, deja de poder. Solo
 * el superadmin lo puede todo, como en el resto del CRM.
 */
export async function permisosDe(user) {
  const mapa = await buildPermissionsMap(
    user.userId, user.role, user.customRoleId ?? null, user.roles_extra || []
  );
  const clave = (accion) => mapa[`tasks.${accion}`] === true;
  return {
    viewAll: clave('view_all'),
    viewOwn: clave('view_own'),
    create: clave('create'),
    edit: clave('edit'),
    assign: clave('assign'),
    archive: clave('delete'),
    close: clave('close'),
    manage: clave('manage'),
    // Crear, renombrar y archivar equipos, sus cargos y sus miembros (26/10/2026).
    manageTeams: clave('manage_teams'),
  };
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new AppError(mensaje, 403, 'FORBIDDEN');
}

/**
 * El ámbito de quien mira, POR EMPRESA (Diego, 26/10/2026: «para los
 * encargados del equipo de desarrollo, las tareas van por empresa, no por
 * proyecto»): todos los campus de sus empresas —las de sus campus y las que
 * tiene en `user_empresas`—, aunque no esté en cada uno. Así Julián, de CEDIA,
 * pone una tarea a Diana y la supervisa Ángel sin compartir campus.
 *
 * Con una empresa o un campus elegidos arriba, la empresa entera de lo elegido,
 * siempre cortada a las suyas (#245). `null` es «todo el CRM» (superadmin y
 * soporte sin elegir nada).
 *
 * Sobre esa lista, `genteDelAmbito` (modelo) decide qué personas entran: las de
 * esos campus, las de esas empresas, las que no tienen ni campus ni empresa
 * (colaboradores del grupo) y quien mira.
 */
export async function ambitoDe(user, { issuerId = null, projectId = null } = {}) {
  const empresa = issuerId ? Number(issuerId) : null;
  const campus = projectId ? Number(projectId) : null;
  let pedidos = null;
  if (empresa) {
    pedidos = await taskModel.campusDeLaEmpresa(empresa);
  } else if (campus) {
    const suya = await taskModel.empresaDelCampus(campus);
    pedidos = suya ? await taskModel.campusDeLaEmpresa(suya) : [campus];
  }
  // Una empresa sin campus no puede acabar significando «todos».
  if (pedidos && !pedidos.length) pedidos = [-1];
  if (veTodoElCrm(user)) return pedidos;

  const mios = await taskModel.campusDeSusEmpresas(user.userId);
  if (campus && !mios.includes(campus)) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
  const lista = pedidos ? pedidos.filter((id) => mios.includes(id)) : mios;
  return lista.length ? lista : [-1];
}

/**
 * Los campus de la empresa elegida arriba: la empresa entera, o la del campus
 * elegido (las tareas van por empresa). null si arriba no hay nada.
 */
export async function campusDeLaCabecera({ issuerId = null, projectId = null } = {}) {
  if (issuerId) {
    const ids = await taskModel.campusDeLaEmpresa(Number(issuerId));
    return ids.length ? ids : [-1];
  }
  if (projectId) {
    const suya = await taskModel.empresaDelCampus(Number(projectId));
    return suya ? await taskModel.campusDeLaEmpresa(suya) : [Number(projectId)];
  }
  return null;
}

/** Una tarea fuera del ámbito no existe para quien mira: 404, no 403. */
async function exigirEnAmbito(personaId, user) {
  const ambito = await ambitoDe(user);
  if (!(await taskModel.personaEnAmbito(personaId, ambito, user.userId))) {
    throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');
  }
}

/**
 * Solo se asigna a gente de los campus de quien asigna (Diego 08/10 y Hugo
 * 09/10): un admin de CEDIA, a gente de sus campus de CEDIA. A un colaborador
 * sin campus, solo el superadmin. El superadmin, a cualquiera.
 */
async function exigirResponsableEnAmbito(personaId, user, que = 'asignar tareas') {
  const ambito = await ambitoDe(user);
  if (!(await taskModel.personaAsignable(personaId, ambito, user.userId))) {
    throw new AppError(`Solo puedes ${que} a gente de tu empresa`, 403, 'FORBIDDEN');
  }
}

/**
 * Aprobar o devolver (Diego, 26/10/2026: «solo superadmin pueden mover las
 * tareas de lugar, y quienes supervisan»): el superadmin y el supervisor de la
 * tarea. Ni el admin ni un cargo alto, si no la supervisan.
 */
async function tareaRevisable(id, user) {
  const task = await taskModel.findTaskById(id);
  if (!task || task.archived_at) {
    throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');
  }
  if (!reglas.puedeRevisar(task, user)) {
    // Fuera de su ámbito la tarea no existe (404); dentro, no es suya (403).
    await tareaVisible(id, user);
    exigir(false, 'Solo el supervisor de la tarea o un superadmin la aprueban o la devuelven');
  }
  return task;
}

const SOLO_MOVER = 'Solo el responsable, el supervisor o un superadmin pueden moverla o comentarla';

/**
 * Mover (columna, orden) y comentar (comentarios, pasos, enlaces): el
 * superadmin, el supervisor y quien la lleva (Diego, 26/10/2026). Mover pide
 * además «Editar» (tasks.edit), como siempre.
 */
function exigirMover(task, user, p) {
  exigir(reglas.puedeMoverYComentar(task, user) && (p.edit || reglas.esSuperadmin(user)), SOLO_MOVER);
}
function exigirComentar(task, user) {
  exigir(reglas.puedeMoverYComentar(task, user), SOLO_MOVER);
}

/**
 * Los demás campos (título, descripción, fecha, responsable, supervisor,
 * equipo, etiquetas): quien la creó, el superadmin y quien delega en su equipo
 * sobre quien la lleva (admin y superadmin en todos). Con «Editar».
 */
async function exigirCampos(task, user, p) {
  exigir((p.edit || reglas.esSuperadmin(user)) && await reglas.puedeEditarCampos(task, user, p),
    'Solo editan esta tarea quien la creó, un superadmin o quien delega en su equipo');
}

/**
 * El equipo de una tarea es el de quien la lleva (Diego, 27/10/2026: «el equipo
 * es según la persona enlazada»), no se elige aparte. Si esa persona está en
 * varios equipos, por este orden: el que se pide (o ya tenía la tarea) si es
 * suyo, el de la empresa del campus de la tarea, el que comparte con quien la
 * da, o el primero. Sin equipos, ninguno.
 */
async function equipoDelResponsable(responsableId, { preferido = null, projectId = null, quien = null } = {}) {
  if (!responsableId || !(await eqModel.existeEquipos())) return null;
  const suyos = (await eqModel.equiposDeLaGente([responsableId])).get(Number(responsableId)) || [];
  if (!suyos.length) return null;
  const ids = suyos.map((e) => e.team_id);
  if (preferido && ids.includes(Number(preferido))) return Number(preferido);
  if (projectId) {
    const [empresa] = await eqModel.empresasDeLosCampus([Number(projectId)]);
    const deEsa = suyos.find((e) => e.issuer_id === empresa);
    if (deEsa) return deEsa.team_id;
  }
  if (quien && Number(quien) !== Number(responsableId)) {
    const mios = new Set(((await eqModel.equiposDeLaGente([quien])).get(Number(quien)) || []).map((e) => e.team_id));
    const compartido = ids.find((id) => mios.has(id));
    if (compartido) return compartido;
  }
  return ids[0];
}

/** El día de una fecha en la oficina: dos horas del mismo día no son un cambio. */
const diaOficina = (f) => (f ? new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(f)) : null);

/**
 * De lo que llega en el PATCH, solo lo que de verdad cambia. La ficha manda
 * todos sus campos al guardar: sin esto, reasignar parecía editar y quedaban
 * comentarios como «del 14/10 al 14/10».
 */
function soloLoQueCambia(fields, task) {
  const iguales = {
    due_date: (a, b) => diaOficina(a) === diaOficina(b),
    description: (a, b) => (a || null) === (b || null),
  };
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const antes = task[k];
    const igual = iguales[k]
      ? iguales[k](antes, v)
      : (antes == null && v == null) || (antes != null && v != null && String(antes) === String(v));
    if (!igual) out[k] = v;
  }
  return out;
}

/** Un nombre repetido (columna, área, proyecto) es un 409, no un 500. */
async function sinRepetir(fn, mensaje) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505') throw new AppError(mensaje, 409, 'DUPLICATE');
    throw err;
  }
}

/** El proyecto tiene que ser un campus de las empresas de la persona (26/10/2026: por empresa). */
async function validarAccesoProyecto(projectId, user) {
  if (!projectId) return;
  if (tieneRol(user, 'superadmin', 'soporte')) return;

  const mios = await taskModel.campusDeSusEmpresas(user.userId);
  if (!mios.includes(Number(projectId))) {
    throw new AppError('No tienes acceso al campus/proyecto seleccionado', 403, 'FORBIDDEN');
  }
}

async function validarResponsable(userId) {
  const persona = await taskModel.findUserBasic(userId);
  if (!persona || !persona.active || !persona.con_tablero) {
    throw new AppError('Esa persona no existe, está inactiva o no tiene tablero de tareas', 400, 'VALIDATION_ERROR');
  }
  return persona;
}

/** La columna de destino tiene que existir y estar activa. */
async function validarColumna(key) {
  const col = await taskModel.findColumnByKey(key);
  if (!col || !col.is_active) {
    throw new AppError('Esa columna no existe o está archivada', 400, 'VALIDATION_ERROR');
  }
  return col;
}

/** Área y proyecto propio, si vienen, tienen que existir y estar activos. No bloquea si ya estaban en la tarea. */
async function validarClasificacion({ area_id, external_project_id }, actualTask = null) {
  if (area_id && (!actualTask || Number(area_id) !== Number(actualTask.area_id))) {
    const area = await taskModel.findAreaById(area_id);
    if (!area || !area.is_active) {
      throw new AppError('Esa área no existe o está archivada', 400, 'VALIDATION_ERROR');
    }
  }
  if (external_project_id && (!actualTask || Number(external_project_id) !== Number(actualTask.external_project_id))) {
    const proyecto = await taskModel.findExternalProjectById(external_project_id);
    if (!proyecto || !proyecto.is_active) {
      throw new AppError('Ese proyecto propio no existe o está archivado', 400, 'VALIDATION_ERROR');
    }
  }
}

async function tareaVisible(id, user, permisos) {
  const task = await taskModel.findTaskById(id);
  if (!task || task.archived_at) {
    throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');
  }
  const p = permisos || await permisosDe(user);
  // Suya: la lleva, la creó o la supervisa.
  const suya = task.assigned_to === user.userId || task.created_by === user.userId
    || task.supervisor_id === user.userId;
  if (suya) {
    exigir(p.viewOwn || p.viewAll, 'No tienes permiso para ver el tablero de tareas');
    return task;
  }
  // Las de sus equipos se ven (26/10/2026: «cada persona ve en el tablero sus equipos»).
  if (task.team_id && (p.viewOwn || p.viewAll) && (await reglas.nivelEn(task.team_id, user.userId)) != null) return task;
  exigir(p.viewAll, 'No tienes permiso para esta tarea');
  await exigirEnAmbito(task.assigned_to, user);
  return task;
}

/**
 * Manda un correo de tareas a una persona si lo tiene encendido en «Mis
 * preferencias». Con TAREAS_CORREOS_ACTIVOS apagado, `tasks.emails.js` lo arma
 * y lo registra sin llamar a Brevo. Un fallo de correo nunca tumba la acción:
 * la tarea ya está guardada y la campana ya ha sonado.
 */
async function correoA(personaId, aviso, enviar) {
  try {
    const persona = await taskModel.findUserBasic(personaId);
    if (!persona?.email) return;
    if (await taskModel.avisoApagado(personaId, aviso)) return;
    await enviar(persona);
  } catch (err) {
    logger.warn({ err: err.message, personaId, aviso }, 'No se pudo preparar un correo de tareas');
  }
}

/**
 * «Cualquier cambio, desde el más mínimo, quien haga el cambio queda guardado
 * y notificado» (Diego, WhatsApp 09/10).
 *
 * Guardado: un comentario automático en la tarjeta, a nombre de quien cambió
 * (el historial ya lo apunta cada función). Notificado: un aviso en la campana
 * a la persona asignada, a quien la creó y a quien la supervisa, nunca a quien hizo el cambio ni a
 * quien ya recibió otro aviso por lo mismo (`yaAvisados`). Sin correo: serían
 * decenas al día.
 */
async function registrarCambio({ tarea, user, lineas, yaAvisados = [] }) {
  const texto = [].concat(lineas).filter(Boolean).join('\n');
  if (!texto) return;
  await taskModel.createComment({ task_id: tarea.id, user_id: user.userId, content: texto });

  const destinatarios = new Set([tarea.assigned_to, tarea.created_by, tarea.supervisor_id].filter(Boolean));
  destinatarios.delete(user.userId);
  for (const id of yaAvisados) destinatarios.delete(id);
  if (destinatarios.size === 0) return;
  const autor = await taskModel.findUserBasic(user.userId);
  await notifyUsers({
    targetUserIds: [...destinatarios],
    type: 'task_cambio',
    title: `Cambio en: ${truncar(tarea.title, 180)}`,
    message: `${autor?.nombre || 'Alguien del equipo'}: ${texto}`.slice(0, 1000),
    link_path: `/tareas?id=${tarea.id}`,
    triggered_by_user_id: user.userId,
    metadata: { task_id: tarea.id },
  });
}

async function avisarAsignacion({ tarea, responsableId, quien, reasignada = false }) {
  await notifyUsers({
    targetUserIds: [responsableId],
    type: 'task_asignada',
    title: `${reasignada ? 'Tarea reasignada' : 'Nueva tarea asignada'}: ${truncar(tarea.title, 180)}`,
    message: `Te han ${reasignada ? 'reasignado' : 'asignado'} la tarea "${tarea.title}" en el tablero de equipo.`,
    link_path: `/tareas?id=${tarea.id}`,
    triggered_by_user_id: quien.userId,
    metadata: { task_id: tarea.id },
  });
  const autor = await taskModel.findUserBasic(quien.userId);
  await correoA(responsableId, AVISO_TAREA_ASIGNADA,
    (persona) => enviarCorreoAsignada({ persona, tarea, quien: autor, reasignada }));
}

/**
 * A quien se pone de supervisor (Diego, 26/10/2026: «eso debe llegar por
 * correo»): campana y correo, como al asignar.
 */
async function avisarSupervisor({ tarea, supervisorId, quien }) {
  if (!supervisorId || supervisorId === quien.userId) return;
  await notifyUsers({
    targetUserIds: [supervisorId],
    type: 'task_supervisor',
    title: `Supervisas una tarea: ${truncar(tarea.title, 180)}`,
    message: `Te han puesto de supervisor de "${tarea.title}"${tarea.assigned_to_name ? `, que lleva ${tarea.assigned_to_name}` : ''}.`,
    link_path: `/tareas?id=${tarea.id}`,
    triggered_by_user_id: quien.userId,
    metadata: { task_id: tarea.id },
  });
  const autor = await taskModel.findUserBasic(quien.userId);
  await correoA(supervisorId, AVISO_TAREA_SUPERVISOR,
    (persona) => enviarCorreoSupervisor({ persona, tarea, quien: autor }));
}

/**
 * El supervisor (26/10/2026): lo pone quien puede delegar en el equipo de la
 * tarea (o en todos: admin y superadmin). Tiene que ser de la empresa, con
 * tablero, y del equipo con un cargo igual o mayor que quien la lleva, o un
 * admin. Sin equipo, cualquiera de la empresa que pueda asignar.
 */
async function validarSupervisor(supervisorId, responsableId, user, p, teamId = null) {
  exigir(await reglas.puedeDelegarEn(teamId, user, p),
    'Solo quien puede delegar en el equipo (o un admin) pone supervisor');
  if (!supervisorId) return;
  if (supervisorId === responsableId) {
    throw new AppError('El supervisor tiene que ser otra persona, no quien lleva la tarea', 400, 'VALIDATION_ERROR');
  }
  if (!(await taskModel.existeSupervisor())) {
    throw new AppError('Falta aplicar la migración 234: todavía no se puede poner supervisor', 409, 'FALTA_MIGRACION');
  }
  const persona = await validarResponsable(supervisorId);
  await exigirResponsableEnAmbito(supervisorId, user, 'poner de supervisor');
  const r = await reglas.supervisorValido(teamId, responsableId, persona);
  exigir(r.ok, r.motivo);
}

/** Si no puede dársela a esa persona en ese equipo, el motivo con su código. */
async function exigirAsignable(teamId, user, p, destinoId) {
  const r = await reglas.puedeAsignarA(teamId, user, p, destinoId);
  if (!r.ok) throw new AppError(r.motivo, r.status || 403, r.status === 400 ? 'VALIDATION_ERROR' : 'FORBIDDEN');
}

/** A quien la lleva: su tarea se ha cerrado (aprobada o movida a «Hecha»). */
async function avisarCierre({ tarea, quien }) {
  if (!tarea.assigned_to || tarea.assigned_to === quien.userId) return;
  await notifyUsers({
    targetUserIds: [tarea.assigned_to],
    type: 'task_aprobada',
    title: `Tarea aprobada: ${truncar(tarea.title, 180)}`,
    message: `Tu tarea "${tarea.title}" se ha aprobado y está en «Hecha».`,
    link_path: `/tareas?id=${tarea.id}`,
    triggered_by_user_id: quien.userId,
    metadata: { task_id: tarea.id, status: HECHA },
  });
  const autor = await taskModel.findUserBasic(quien.userId);
  await correoA(tarea.assigned_to, AVISO_TAREA_CERRADA,
    (persona) => enviarCorreoCerrada({ persona, tarea, quien: autor }));
}

async function nombreDeColumna(key) {
  const col = await taskModel.findColumnByKey(key);
  return col?.name || key;
}

/* --- Tablero y tareas --- */

export async function listTasks(user, q) {
  const p = await permisosDe(user);
  exigir(p.viewAll || p.viewOwn, 'No tienes permiso para ver el tablero de tareas');
  // Qué se ve (un solo tablero con filtros, Diego 27/10/2026):
  //   · «Mis tareas»: lo que lleva, supervisa o creó, sea quien sea;
  //   · «Mi equipo»: eso y lo de sus equipos;
  //   · «Todo»: con «Ver todo», la gente de su ámbito (empresa o campus de
  //     arriba); sin él, lo mismo que «Mi equipo». El filtro nunca abre más.
  const ver = q.ver || (q.mias ? 'mias' : 'todo');
  const ambito = p.viewAll && ver === 'todo' ? await ambitoDe(user, q) : null;
  // Con una empresa o un campus arriba, en cualquier vista, solo las tareas de esa
  // empresa (30/10). Sin nada arriba, como siempre.
  const deLaCabecera = await campusDeLaCabecera(q);

  if (q.project_id) {
    await validarAccesoProyecto(q.project_id, user);
  }

  const tareas = await taskModel.findTasks({
    ambito,
    de_la_cabecera: deLaCabecera,
    yo: user.userId,
    visibles_para: p.viewAll && ver === 'todo' ? null : user.userId,
    // «Mis tareas»: lo suyo, sea quien sea (también el admin y el superadmin).
    mias_de: ver === 'mias' ? user.userId : null,
    assigned_to: q.assigned_to,
    team_id: q.team_id,
    project_id: q.project_id,
    external_project_id: q.external_project_id,
    area_id: q.area_id,
    status: q.status,
    priority: q.priority,
    search: q.search,
    tag: q.tag,
    vencidas: q.vencidas,
    desde: q.desde,
    hasta: q.hasta,
    periodo_desde: q.periodo_desde,
    periodo_hasta: q.periodo_hasta,
    incluir_archivadas: p.viewAll ? q.incluir_archivadas : false,
  });
  // Lo que el tablero necesita para dejar arrastrar o no cada tarjeta.
  return tareas.map((t) => ({ ...t, puede_mover: reglas.puedeMoverYComentar(t, user) && (p.edit || reglas.esSuperadmin(user)) }));
}

export async function getTaskById(id, user) {
  const p = await permisosDe(user);
  const task = await tareaVisible(id, user, p);

  const [events, checklist, comments, tags, links, permisos] = await Promise.all([
    taskModel.findTaskEvents(id),
    taskModel.findChecklistItems(id),
    taskModel.findComments(id),
    taskModel.findTags(id),
    taskModel.findLinks(id),
    reglas.permisosDeLaTarea(task, user, p),
  ]);
  permisos.mover = permisos.mover && (p.edit || reglas.esSuperadmin(user));
  permisos.editar = permisos.editar && (p.edit || reglas.esSuperadmin(user));

  return { ...task, events, checklist, comments, tags, links, permisos };
}

/**
 * La gente a la que se le puede dar una tarea. Con `team_id`, además, su cargo
 * y su nivel en ese equipo, y `asignable` según la regla de niveles: quien no
 * es del equipo no sale como asignable.
 */
export async function listAssignees(user, q = {}) {
  const p = await permisosDe(user);
  const teamId = q.team_id ? Number(q.team_id) : null;
  const delega = teamId ? await reglas.puedeDelegarEn(teamId, user, p) : false;
  exigir(p.viewAll || p.assign || p.manage || delega, 'No tienes permiso para ver el equipo');
  const lista = await taskModel.findAssignees(await ambitoDe(user, q), user.userId, await ambitoDe(user));
  // Con sus equipos: la ficha enseña el de quien la va a llevar (27/10/2026).
  const equiposDe = await eqModel.equiposDeLaGente(lista.map((g) => g.id));
  const gente = lista.map((g) => ({ ...g, equipos: equiposDe.get(Number(g.id)) || [] }));
  if (!teamId) return gente;
  const niveles = await eqModel.nivelesEn(teamId, gente.map((g) => g.id));
  const mio = niveles.get(Number(user.userId))?.nivel ?? null;
  return gente.map((g) => {
    const n = niveles.get(Number(g.id));
    const asignable = g.id === user.userId
      || (n != null && g.asignable !== false && (reglas.esMando(p) || (mio != null && mio > n.nivel)));
    return { ...g, team_nivel: n?.nivel ?? null, team_cargo: n?.cargo ?? null, asignable };
  });
}

export async function listTagNames(user, q = {}) {
  const p = await permisosDe(user);
  if (!p.viewAll) return taskModel.findTagNames({ assigned_to: user.userId });
  return taskModel.findTagNames({ ambito: await ambitoDe(user, q), yo: user.userId });
}

export async function createTask(data, user) {
  const p = await permisosDe(user);
  exigir(p.create, 'No tienes permiso para crear tareas');

  // Decisión 3, con equipos (26/10/2026): cualquiera se crea tareas; dársela a
  // otro, solo hacia abajo en su equipo (o en todos, quien tiene «Asignar»).
  const responsable = data.assigned_to || user.userId;
  // El equipo, el de quien la lleva (27/10/2026).
  const teamId = await equipoDelResponsable(responsable, { preferido: data.team_id, projectId: data.project_id, quien: user.userId });
  if (teamId) data.team_id = teamId;
  else delete data.team_id;
  const equipo = teamId ? { id: teamId } : null;
  await exigirAsignable(equipo?.id ?? null, user, p, responsable);
  // Decisión 4, también al crear: si no, crearla ya cerrada se saltaba la regla.
  exigir(data.status !== HECHA || p.close,
    'Solo quienes tienen permiso de cierre pueden crear una tarea como Hecha');

  const status = data.status || 'por_hacer';
  await validarColumna(status);
  if (responsable !== user.userId) {
    await validarResponsable(responsable);
    await exigirResponsableEnAmbito(responsable, user);
  }
  if (data.supervisor_id) await validarSupervisor(data.supervisor_id, responsable, user, p, equipo?.id ?? null);
  if (data.project_id) await validarAccesoProyecto(data.project_id, user);
  await validarClasificacion(data);

  const position = (await taskModel.getMaxPosition(status, responsable)) + 1000;

  const createdTask = await taskModel.createTask({
    ...data,
    status,
    position,
    assigned_to: responsable,
    created_by: user.userId,
    completed_at: status === HECHA ? new Date().toISOString() : null,
  });

  await taskModel.createTaskEvent({
    task_id: createdTask.id,
    user_id: user.userId,
    event_type: 'created',
    details: {
      title: createdTask.title,
      status: createdTask.status,
      priority: createdTask.priority,
      assigned_to: createdTask.assigned_to,
      ...(createdTask.supervisor_id ? { supervisor_id: createdTask.supervisor_id } : {}),
      ...(createdTask.team_id ? { team_id: createdTask.team_id } : {}),
    },
  });

  if (responsable !== user.userId) {
    await avisarAsignacion({ tarea: createdTask, responsableId: responsable, quien: user });
  }
  if (createdTask.supervisor_id) {
    await avisarSupervisor({ tarea: createdTask, supervisorId: createdTask.supervisor_id, quien: user });
  }

  logger.info({ taskId: createdTask.id, userId: user.userId }, 'Tarea creada en el tablero');
  return createdTask;
}

export async function updateTask(id, rawFields, user) {
  const p = await permisosDe(user);
  const currentTask = await tareaVisible(id, user, p);

  const fields = soloLoQueCambia(rawFields, currentTask);
  const cambiaResponsable = fields.assigned_to !== undefined;
  const cambiaSupervisor = fields.supervisor_id !== undefined;
  const responsable = cambiaResponsable ? fields.assigned_to : currentTask.assigned_to;
  // El equipo es el de quien la lleva (27/10/2026): al cambiar de responsable
  // se recalcula, y pedir otro equipo solo vale si también es suyo.
  let teamId = currentTask.team_id ?? null;
  if (cambiaResponsable || fields.team_id !== undefined) {
    teamId = await equipoDelResponsable(responsable, {
      preferido: fields.team_id !== undefined ? fields.team_id : currentTask.team_id,
      projectId: fields.project_id !== undefined ? fields.project_id : currentTask.project_id,
      quien: user.userId,
    });
    if (teamId !== (currentTask.team_id ?? null)) fields.team_id = teamId;
    else delete fields.team_id;
  }
  const cambiaEquipo = fields.team_id !== undefined;
  // Guardar sin cambiar nada no es editar: se devuelve la tarea tal cual.
  if (Object.keys(fields).length === 0) return currentTask;
  // Cualquier campo, también responsable, supervisor y equipo (26/10/2026):
  // quien la creó, el superadmin o quien delega en su equipo.
  await exigirCampos(currentTask, user, p);

  if (cambiaResponsable && fields.assigned_to) {
    await validarResponsable(fields.assigned_to);
    if (fields.assigned_to !== user.userId) await exigirResponsableEnAmbito(fields.assigned_to, user);
  }
  if (cambiaResponsable || cambiaEquipo) {
    await exigirAsignable(teamId, user, p, responsable);
  }
  if (cambiaSupervisor) {
    await validarSupervisor(fields.supervisor_id, responsable, user, p, teamId);
  } else if (cambiaResponsable && fields.assigned_to && fields.assigned_to === currentTask.supervisor_id) {
    throw new AppError('El supervisor tiene que ser otra persona, no quien lleva la tarea', 400, 'VALIDATION_ERROR');
  }

  if (fields.project_id && fields.project_id !== currentTask.project_id) {
    await validarAccesoProyecto(fields.project_id, user);
  }
  await validarClasificacion(fields, currentTask);

  // Campus o proyecto propio, nunca los dos (CHECK de la 210): elegir uno
  // quita el otro, en vez de chocar con el CHECK.
  const cambios = { ...fields };
  if (cambios.project_id && cambios.external_project_id === undefined) cambios.external_project_id = null;
  if (cambios.external_project_id && cambios.project_id === undefined) cambios.project_id = null;

  const updatedTask = await taskModel.updateTask(id, cambios);
  if (!updatedTask) throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');

  const diferencias = {};
  for (const k of Object.keys(cambios)) {
    const antes = currentTask[k] instanceof Date ? currentTask[k].toISOString() : currentTask[k];
    const despues = updatedTask[k] instanceof Date ? updatedTask[k].toISOString() : updatedTask[k];
    if (antes !== despues) diferencias[k] = { antes: antes ?? null, despues: despues ?? null };
  }
  if (Object.keys(diferencias).length > 0) {
    await taskModel.createTaskEvent({
      task_id: id,
      user_id: user.userId,
      event_type: cambiaResponsable || cambiaSupervisor || cambiaEquipo ? 'assigned' : 'updated',
      details: diferencias,
    });
  }

  // Comentario automático (Diego 08/10, y por WhatsApp el 09/10: «cualquier
  // cambio, por mínimo que sea»): todo lo que cambie queda en el historial
  // (arriba) y además comentado en la tarjeta, lo cambie quien lo cambie.
  // A quien se le acaba de asignar ya le llega «Tarea reasignada».
  await registrarCambio({
    tarea: currentTask,
    user,
    lineas: comentariosDeCambios(diferencias, currentTask, updatedTask),
    yaAvisados: [
      ...(cambiaResponsable && fields.assigned_to ? [fields.assigned_to] : []),
      ...(cambiaSupervisor && fields.supervisor_id ? [fields.supervisor_id] : []),
    ],
  });

  if (cambiaResponsable && fields.assigned_to && fields.assigned_to !== user.userId) {
    await avisarAsignacion({ tarea: updatedTask, responsableId: fields.assigned_to, quien: user, reasignada: true });
  }
  if (cambiaSupervisor && fields.supervisor_id) {
    await avisarSupervisor({ tarea: updatedTask, supervisorId: fields.supervisor_id, quien: user });
  }

  return updatedTask;
}

/**
 * Mueve una tarjeta de columna, de sitio en su columna, o las dos.
 *
 * `prev_id`/`next_id` son las tarjetas entre las que se suelta. Si `prev_id` ya
 * no está, manda la que de verdad está antes de `next_id` (findNeighbors): así
 * la tarjeta no salta por encima de las que había delante.
 */
export async function moveTask(id, { status, prev_id, next_id }, user) {
  const p = await permisosDe(user);
  const currentTask = await tareaVisible(id, user, p);
  // Moverla (también reordenar): el superadmin, el supervisor y quien la lleva
  // (26/10/2026). Cerrarla o reabrirla: el supervisor o el superadmin, o quien
  // la lleva si además tiene «Aprobar y cerrar».
  exigirMover(currentTask, user, p);
  const cierraOReabre = (status === HECHA) !== (currentTask.status === HECHA);

  if (status !== currentTask.status) await validarColumna(status);
  exigir(!(cierraOReabre && status === HECHA) || reglas.puedeCerrar(currentTask, user, p),
    'Solo el supervisor o un superadmin marcan esta tarea como Hecha');
  exigir(!(cierraOReabre && currentTask.status === HECHA) || reglas.puedeCerrar(currentTask, user, p),
    'Solo el supervisor o un superadmin reabren una tarea completada');

  const vecinas = () => taskModel.findNeighbors(status, currentTask.assigned_to, { prev_id, next_id, sin: id });
  let { prevPos: prev, nextPos: next } = await vecinas();
  if ((prev != null && next != null && next - prev < HUECO_MINIMO)
      || (prev == null && next != null && next < HUECO_MINIMO)) {
    await taskModel.renumberColumn(status, currentTask.assigned_to);
    ({ prevPos: prev, nextPos: next } = await vecinas());
  }

  let newPos;
  if (prev != null && next != null) newPos = (prev + next) / 2;
  else if (prev != null) newPos = prev + 1000;
  else if (next != null) newPos = next / 2;
  else if (status === currentTask.status) newPos = currentTask.position;
  else newPos = (await taskModel.getMaxPosition(status, currentTask.assigned_to)) + 1000;

  let completedAt = currentTask.completed_at;
  if (status === HECHA && currentTask.status !== HECHA) completedAt = new Date().toISOString();
  else if (status !== HECHA) completedAt = null;

  const movedTask = await taskModel.updateTaskPositionAndStatus(id, {
    status,
    position: newPos,
    completed_at: completedAt,
  });
  if (!movedTask) throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');

  // En el historial, solo los cambios de columna: reordenar dentro de la
  // misma llenaba la tarjeta de ruido (54 en el QA).
  if (currentTask.status === status) return movedTask;

  await taskModel.createTaskEvent({
    task_id: id,
    user_id: user.userId,
    event_type: 'status_changed',
    details: { old_status: currentTask.status, new_status: status },
  });

  const [deNombre, aNombre] = await Promise.all([nombreDeColumna(currentTask.status), nombreDeColumna(status)]);
  const texto = `«${currentTask.title}» pasó de ${deNombre} a ${aNombre}.`;

  // A quien la creó: cuando pasa a «En revisión» o a «Hecha».
  if ([EN_REVISION, HECHA].includes(status)
      && currentTask.created_by && currentTask.created_by !== user.userId) {
    await notifyUsers({
      targetUserIds: [currentTask.created_by],
      type: 'task_estado_cambiado',
      title: status === HECHA ? `Tarea cerrada: ${truncar(currentTask.title, 180)}` : `Tarea en revisión: ${truncar(currentTask.title, 180)}`,
      message: texto,
      link_path: `/tareas?id=${id}`,
      triggered_by_user_id: user.userId,
      metadata: { task_id: id, status },
    });
  }

  const yaAvisados = [];
  if ([EN_REVISION, HECHA].includes(status)) yaAvisados.push(currentTask.created_by);
  if (status === HECHA) {
    // Cerrarla arrastrando avisa igual que aprobarla desde «Por revisar».
    await avisarCierre({ tarea: movedTask, quien: user });
    yaAvisados.push(currentTask.assigned_to);
  } else if (currentTask.assigned_to && currentTask.assigned_to !== user.userId
      && currentTask.assigned_to !== currentTask.created_by) {
    await notifyUsers({
      targetUserIds: [currentTask.assigned_to],
      type: 'task_estado_cambiado',
      title: `Tu tarea cambió de estado: ${truncar(currentTask.title, 180)}`,
      message: texto,
      link_path: `/tareas?id=${id}`,
      triggered_by_user_id: user.userId,
      metadata: { task_id: id, status },
    });
    yaAvisados.push(currentTask.assigned_to);
  }

  // Al supervisor, por correo, cuando está lista para revisar (Diego, 26/10/2026).
  if (status === EN_REVISION && currentTask.supervisor_id && currentTask.supervisor_id !== user.userId) {
    const autor = await taskModel.findUserBasic(user.userId);
    await correoA(currentTask.supervisor_id, AVISO_TAREA_SUPERVISOR,
      (persona) => enviarCorreoParaRevisar({ persona, tarea: movedTask, quien: autor }));
  }

  // Comentario automático también al cambiarla de columna (WhatsApp, 09/10).
  await registrarCambio({
    tarea: currentTask, user, lineas: `Movió la tarea de «${deNombre}» a «${aNombre}».`, yaAvisados,
  });

  // El correo de cambio de estado (26/10/2026), agrupado si se mueve varias veces
  // seguidas. Sin quien ya tiene el suyo: «Tarea completada» o «Para revisar».
  await anotarCambioDeEstado({
    taskId: id, de: currentTask.status, a: status, autorId: user.userId,
    yaConCorreo: [
      status === HECHA ? currentTask.assigned_to : null,
      status === EN_REVISION ? currentTask.supervisor_id : null,
    ],
  });

  return movedTask;
}

export async function archiveTask(id, user) {
  const p = await permisosDe(user);
  const currentTask = await tareaVisible(id, user, p);

  exigir(p.archive || currentTask.created_by === user.userId,
    'Solo quienes tienen permiso de borrado o quien la creó pueden archivar esta tarea');

  const archived = await taskModel.archiveTask(id);
  if (!archived) throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');

  await taskModel.createTaskEvent({
    task_id: id,
    user_id: user.userId,
    event_type: 'archived',
    details: { archived_by: user.userId },
  });
  await registrarCambio({ tarea: currentTask, user, lineas: 'Archivó la tarea.' });

  return archived;
}

/* --- Por revisar --- */

/**
 * Las tareas «En revisión» de su ámbito, por fecha límite, y además las que
 * supervisa (26/10/2026). La lista es de quien tiene «Aprobar y cerrar»; el
 * supervisor sin él revisa desde la tarjeta (le llega el correo con el enlace).
 */
export async function getReviewTasks(user, q = {}) {
  // El superadmin, todas las de su ámbito; el resto, las que supervisa
  // (26/10/2026: aprobar es del supervisor o del superadmin).
  if (reglas.esSuperadmin(user)) {
    return taskModel.findTasks({
      status: EN_REVISION, orden: 'vencimiento', ambito: await ambitoDe(user, q), yo: user.userId,
      de_la_cabecera: await campusDeLaCabecera(q),
    });
  }
  return taskModel.findTasks({ status: EN_REVISION, orden: 'vencimiento', supervisor_id: user.userId, de_la_cabecera: await campusDeLaCabecera(q) });
}

export async function getReviewCount(user, q = {}) {
  if (reglas.esSuperadmin(user)) {
    return { count: await taskModel.countReview(await ambitoDe(user, q), user.userId, { deLaCabecera: await campusDeLaCabecera(q) }) };
  }
  return { count: (await taskModel.findTasks({ status: EN_REVISION, supervisor_id: user.userId, de_la_cabecera: await campusDeLaCabecera(q) })).length };
}

/** Aprobar: de «En revisión» a «Hecha», en una transacción. */
export async function approveTask(id, user) {
  await tareaRevisable(id, user);

  const result = await taskModel.approveTaskAtomic({ taskId: id, user });
  if (!result) throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');
  if (result.noEnRevision) {
    throw new AppError('Solo se aprueba una tarea que está «En revisión»', 409, 'NOT_IN_REVIEW');
  }

  if (result.oldTask.created_by && result.oldTask.created_by !== user.userId
      && result.oldTask.created_by !== result.oldTask.assigned_to) {
    await notifyUsers({
      targetUserIds: [result.oldTask.created_by],
      type: 'task_estado_cambiado',
      title: `Tarea cerrada: ${truncar(result.task.title, 180)}`,
      message: `«${result.task.title}» se ha aprobado y está en «Hecha».`,
      link_path: `/tareas?id=${id}`,
      triggered_by_user_id: user.userId,
      metadata: { task_id: id, status: HECHA },
    });
  }
  await avisarCierre({ tarea: result.task, quien: user });
  await anotarCambioDeEstado({
    taskId: id, de: EN_REVISION, a: HECHA, autorId: user.userId, accion: 'aprobada',
    yaConCorreo: [result.oldTask.assigned_to],
  });
  return result.task;
}

/**
 * Devolver: de «En revisión» a «En curso» con el porqué. Mover y comentar van
 * en la misma transacción (tasks.model.js): nunca queda movida sin el motivo.
 */
export async function returnTask(id, { comment }, user) {
  await tareaRevisable(id, user);

  const result = await taskModel.returnTaskAtomic({ taskId: id, comment, user });
  if (!result) throw new AppError('Tarea no encontrada', 404, 'NOT_FOUND');
  if (result.noEnRevision) {
    throw new AppError('Solo se devuelve una tarea que está «En revisión»', 409, 'NOT_IN_REVIEW');
  }

  const { task, oldTask } = result;
  if (oldTask.assigned_to && oldTask.assigned_to !== user.userId) {
    await notifyUsers({
      targetUserIds: [oldTask.assigned_to],
      type: 'task_devuelta',
      title: `Tarea devuelta: ${truncar(oldTask.title, 180)}`,
      message: comment,
      link_path: `/tareas?id=${id}`,
      triggered_by_user_id: user.userId,
      metadata: { task_id: id, status: 'en_curso', comment },
    });
    const autor = await taskModel.findUserBasic(user.userId);
    await correoA(oldTask.assigned_to, AVISO_TAREA_DEVUELTA,
      (persona) => enviarCorreoDevuelta({ persona, tarea: task, quien: autor, comentario: comment }));
  }
  // Al supervisor y a quien la creó, con el motivo; quien la lleva ya tiene «Tarea devuelta».
  await anotarCambioDeEstado({
    taskId: id, de: EN_REVISION, a: task.status || 'en_curso', autorId: user.userId,
    accion: 'devuelta', comentario: comment, yaConCorreo: [oldTask.assigned_to],
  });

  return task;
}

/* --- Lista de comprobación --- */

export async function addChecklistItem(taskId, data, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  exigirComentar(tarea, user);
  const item = await taskModel.createChecklistItem({ task_id: taskId, title: data.title });
  await taskModel.createTaskEvent({
    task_id: taskId,
    user_id: user.userId,
    event_type: 'checklist',
    details: { action: 'item_added', title: data.title },
  });
  await registrarCambio({ tarea, user, lineas: `Añadió el paso «${data.title}».` });
  return item;
}

export async function updateChecklistItem(taskId, itemId, fields, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  exigirComentar(tarea, user);
  const updated = await taskModel.updateChecklistItem(taskId, itemId, fields);
  if (!updated) throw new AppError('Elemento no encontrado en esta tarea', 404, 'NOT_FOUND');
  const lineas = [];
  if (fields.title !== undefined) lineas.push(`Cambió un paso a «${updated.title}».`);
  if (fields.is_completed !== undefined) {
    await taskModel.createTaskEvent({
      task_id: taskId,
      user_id: user.userId,
      event_type: 'checklist',
      details: { action: fields.is_completed ? 'item_checked' : 'item_unchecked', title: updated.title },
    });
    lineas.push(fields.is_completed ? `Marcó como hecho el paso «${updated.title}».` : `Desmarcó el paso «${updated.title}».`);
  }
  await registrarCambio({ tarea, user, lineas });
  return updated;
}

export async function deleteChecklistItem(taskId, itemId, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  exigirComentar(tarea, user);
  const deleted = await taskModel.deleteChecklistItem(taskId, itemId);
  if (!deleted) throw new AppError('Elemento no encontrado en esta tarea', 404, 'NOT_FOUND');
  await taskModel.createTaskEvent({
    task_id: taskId,
    user_id: user.userId,
    event_type: 'checklist',
    details: { action: 'item_removed', title: deleted.title },
  });
  await registrarCambio({ tarea, user, lineas: `Quitó el paso «${deleted.title}».` });
  return deleted;
}

/* --- Comentarios --- */

export async function addComment(taskId, data, user) {
  const task = await tareaVisible(taskId, user);
  exigirComentar(task, user);
  const comment = await taskModel.createComment({ task_id: taskId, user_id: user.userId, content: data.content });
  await taskModel.createTaskEvent({
    task_id: taskId,
    user_id: user.userId,
    event_type: 'comment',
    details: { comment_id: comment.id },
  });

  const destinatarios = new Set();
  if (task.assigned_to && task.assigned_to !== user.userId) destinatarios.add(task.assigned_to);
  if (task.created_by && task.created_by !== user.userId) destinatarios.add(task.created_by);
  if (task.supervisor_id && task.supervisor_id !== user.userId) destinatarios.add(task.supervisor_id);

  if (destinatarios.size > 0) {
    const autor = await taskModel.findUserBasic(user.userId);
    await notifyUsers({
      targetUserIds: [...destinatarios],
      type: 'task_comentario',
      title: `Nuevo comentario en: ${truncar(task.title, 180)}`,
      message: `${autor?.nombre || 'Alguien del equipo'} comentó en la tarea "${task.title}".`,
      link_path: `/tareas?id=${taskId}`,
      triggered_by_user_id: user.userId,
      metadata: { task_id: taskId, comment_id: comment.id },
    });
    // El correo, solo a la persona de la tarea (Diego, 07/10: «comentario
    // nuevo en su tarea»). Quien la creó ya tiene la campana.
    if (destinatarios.has(task.assigned_to)) {
      await correoA(task.assigned_to, AVISO_TAREA_COMENTARIO, (persona) => enviarCorreoComentario({
        persona, tarea: task, quien: autor, comentario: data.content, commentId: comment.id,
      }));
    }
  }

  return comment;
}

export async function deleteComment(taskId, commentId, user) {
  const p = await permisosDe(user);
  await tareaVisible(taskId, user, p);
  const comment = await taskModel.findComment(taskId, commentId);
  if (!comment) throw new AppError('Comentario no encontrado', 404, 'NOT_FOUND');

  // El suyo, cada uno; el de otra persona, solo el superadmin (26/10/2026).
  exigir(reglas.esSuperadmin(user) || comment.user_id === user.userId, 'Solo puedes borrar tus propios comentarios');

  return taskModel.deleteComment(taskId, commentId);
}

/* --- Etiquetas --- */

export async function addTag(taskId, data, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  await exigirCampos(tarea, user, p);
  const { repetida, ...tag } = await taskModel.createTag({ task_id: taskId, name: data.name, color: data.color });
  if (!repetida) {
    await taskModel.createTaskEvent({
      task_id: taskId,
      user_id: user.userId,
      event_type: 'tag',
      details: { action: 'added', name: tag.name },
    });
    await registrarCambio({ tarea, user, lineas: `Añadió la etiqueta «${tag.name}».` });
  }
  return tag;
}

export async function deleteTag(taskId, tagId, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  await exigirCampos(tarea, user, p);
  const deleted = await taskModel.deleteTag(taskId, tagId);
  if (!deleted) throw new AppError('Etiqueta no encontrada en esta tarea', 404, 'NOT_FOUND');
  await taskModel.createTaskEvent({
    task_id: taskId,
    user_id: user.userId,
    event_type: 'tag',
    details: { action: 'removed', name: deleted.name },
  });
  await registrarCambio({ tarea, user, lineas: `Quitó la etiqueta «${deleted.name}».` });
  return deleted;
}

/* --- Enlaces --- */

export async function addLink(taskId, data, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  exigirComentar(tarea, user);
  const link = await taskModel.createLink({
    task_id: taskId, url: data.url, title: data.title || null, created_by: user.userId,
  });
  await taskModel.createTaskEvent({
    task_id: taskId,
    user_id: user.userId,
    event_type: 'link',
    details: { action: 'added', url: link.url, title: link.title },
  });
  await registrarCambio({ tarea, user, lineas: `Añadió el enlace «${link.title || link.url}».` });
  return link;
}

export async function deleteLink(taskId, linkId, user) {
  const p = await permisosDe(user);
  const tarea = await tareaVisible(taskId, user, p);
  exigirComentar(tarea, user);
  const deleted = await taskModel.deleteLink(taskId, linkId);
  if (!deleted) throw new AppError('Enlace no encontrado en esta tarea', 404, 'NOT_FOUND');
  await taskModel.createTaskEvent({
    task_id: taskId,
    user_id: user.userId,
    event_type: 'link',
    details: { action: 'removed', url: deleted.url },
  });
  await registrarCambio({ tarea, user, lineas: `Quitó el enlace «${deleted.title || deleted.url}».` });
  return deleted;
}

/* --- Todo el equipo --- */

export async function getTeamMetrics(projectId, areaId, user, q = {}) {
  const p = await permisosDe(user);
  exigir(p.viewAll, 'No tienes permiso para ver las métricas del equipo');
  if (projectId) await validarAccesoProyecto(projectId, user);
  return taskModel.getTeamMetrics(projectId, areaId, await ambitoDe(user, q), user.userId, await campusDeLaCabecera(q));
}

export async function getTeamMetricsByArea(projectId, user, q = {}) {
  const p = await permisosDe(user);
  exigir(p.viewAll, 'No tienes permiso para ver las métricas del equipo');
  if (projectId) await validarAccesoProyecto(projectId, user);
  return taskModel.getTeamMetricsByArea(projectId, await ambitoDe(user, q), user.userId, await campusDeLaCabecera(q));
}

/* --- Configurar tablero: columnas --- */

export async function listColumns(user) {
  const p = await permisosDe(user);
  return p.manage ? taskModel.findAllColumns() : taskModel.findActiveColumns();
}

export async function createColumn(data, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  if (data.sort_order === undefined) {
    const columnas = await taskModel.findAllColumns();
    data.sort_order = Math.max(0, ...columnas.map((c) => c.sort_order)) + 10;
  }
  return sinRepetir(() => taskModel.createColumn(data), 'Ya existe una columna con esa clave');
}

/** Archivar una columna: nunca una fija, nunca una con tareas. */
async function puedeArchivarColumna(col) {
  if (col.is_system) {
    throw new AppError('Las 4 columnas fijas no se archivan: tienen reglas', 400, 'VALIDATION_ERROR');
  }
  const count = await taskModel.countTasksInColumn(col.key);
  if (count > 0) {
    throw new AppError(
      `«${col.name}» tiene ${count} tarea(s). Muévelas a otra columna antes de archivarla.`,
      409, 'COLUMN_NOT_EMPTY'
    );
  }
}

export async function updateColumn(id, fields, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  const col = await taskModel.findColumnById(id);
  if (!col) throw new AppError('Columna no encontrada', 404, 'NOT_FOUND');
  // Archivar por aquí cumple las mismas reglas que por DELETE.
  if (fields.is_active === false && col.is_active) await puedeArchivarColumna(col);
  return taskModel.updateColumn(id, fields);
}

export async function archiveColumn(id, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  const col = await taskModel.findColumnById(id);
  if (!col) throw new AppError('Columna no encontrada', 404, 'NOT_FOUND');
  await puedeArchivarColumna(col);
  return taskModel.updateColumn(id, { is_active: false });
}

export async function reorderColumns({ keys }, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  // La lista entera de columnas activas, cada una una vez: un orden a medias
  // dejaría dos columnas en el mismo sitio.
  const activas = (await taskModel.findActiveColumns()).map((c) => c.key).sort();
  const pedidas = [...keys].sort();
  if (new Set(keys).size !== keys.length || JSON.stringify(activas) !== JSON.stringify(pedidas)) {
    throw new AppError('Manda todas las columnas activas, cada una una vez', 400, 'VALIDATION_ERROR');
  }
  return taskModel.reorderColumns(keys);
}

/* --- Configurar tablero: áreas --- */

export async function listAreas(user) {
  const p = await permisosDe(user);
  return p.manage ? taskModel.findAllAreas() : taskModel.findActiveAreas();
}

export async function createArea(data, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  return sinRepetir(() => taskModel.createArea(data), 'Ya existe un área con ese nombre');
}

export async function updateArea(id, fields, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  const area = await taskModel.findAreaById(id);
  if (!area) throw new AppError('Área no encontrada', 404, 'NOT_FOUND');
  return sinRepetir(() => taskModel.updateArea(id, fields), 'Ya existe un área con ese nombre');
}

export async function getUserAreas(userId, user) {
  const p = await permisosDe(user);
  exigir(userId === user.userId || p.viewAll || p.manage, 'No tienes permiso para ver las áreas de esa persona');
  return taskModel.getUserAreas(userId);
}

export async function getUserAreaAssignments(user) {
  const p = await permisosDe(user);
  exigir(p.viewAll || p.manage, 'No tienes permiso para consultar quién está en cada área');
  return taskModel.getUserAreaAssignments();
}

/** Las áreas de una persona: la lista entera. */
export async function setUserAreas(userId, { area_ids }, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  await validarResponsable(userId);
  for (const areaId of new Set(area_ids)) await validarClasificacion({ area_id: areaId });
  return taskModel.setUserAreas(userId, [...new Set(area_ids)]);
}

/** Quién está en un área: la lista entera. Las demás áreas de cada persona no se tocan. */
export async function setAreaMembers(areaId, { user_ids }, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  const area = await taskModel.findAreaById(areaId);
  if (!area) throw new AppError('Área no encontrada', 404, 'NOT_FOUND');
  const ids = [...new Set(user_ids)];
  for (const userId of ids) await validarResponsable(userId);
  return taskModel.setAreaMembers(areaId, ids);
}

/* --- Configurar tablero: proyectos propios --- */

export async function listExternalProjects(user) {
  const p = await permisosDe(user);
  return p.manage ? taskModel.findAllExternalProjects() : taskModel.findActiveExternalProjects();
}

export async function createExternalProject(data, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  return sinRepetir(() => taskModel.createExternalProject(data), 'Ya existe un proyecto propio con ese nombre');
}

export async function updateExternalProject(id, fields, user) {
  const p = await permisosDe(user);
  exigir(p.manage, 'No tienes permiso para configurar el tablero');
  const proj = await taskModel.findExternalProjectById(id);
  if (!proj) throw new AppError('Proyecto propio no encontrado', 404, 'NOT_FOUND');
  return sinRepetir(() => taskModel.updateExternalProject(id, fields), 'Ya existe un proyecto propio con ese nombre');
}
