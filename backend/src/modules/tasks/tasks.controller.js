import * as taskService from './tasks.service.js';
import * as equipos from './tasks.equipos.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import {
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
  returnTaskSchema,
  listTasksQuerySchema,
  metricsQuerySchema,
  ambitoQuerySchema,
  addChecklistItemSchema,
  updateChecklistItemSchema,
  addCommentSchema,
  addTagSchema,
  addLinkSchema,
  createColumnSchema,
  updateColumnSchema,
  reorderColumnsSchema,
  createAreaSchema,
  updateAreaSchema,
  setUserAreasSchema,
  setAreaMembersSchema,
  createExternalProjectSchema,
  updateExternalProjectSchema,
  assigneesQuerySchema,
  createTeamSchema,
  updateTeamSchema,
  createTeamRoleSchema,
  updateTeamRoleSchema,
  setTeamMemberSchema,
  listTeamsQuerySchema,
} from './tasks.validation.js';

function validar(schema, datos) {
  const r = schema.safeParse(datos ?? {});
  if (!r.success) {
    throw new AppError(r.error.errors[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
  }
  return r.data;
}

function validarId(paramId) {
  if (!/^\d+$/.test(String(paramId))) {
    throw new AppError('ID inválido', 400, 'VALIDATION_ERROR');
  }
  const id = Number(paramId);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    throw new AppError('ID inválido', 400, 'VALIDATION_ERROR');
  }
  return id;
}

const quien = (req) => req.user;

const accion = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

/* --- Tareas CRUD y Tablero --- */

export const list = accion(async (req, res) => {
  const q = validar(listTasksQuerySchema, req.query);
  const data = await taskService.listTasks(quien(req), q);
  res.json({ success: true, data });
});

export const getById = accion(async (req, res) => {
  const data = await taskService.getTaskById(validarId(req.params.id), quien(req));
  res.json({ success: true, data });
});

export const create = accion(async (req, res) => {
  const body = validar(createTaskSchema, req.body);
  const data = await taskService.createTask(body, quien(req));
  res.status(201).json({ success: true, data });
});

export const update = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const body = validar(updateTaskSchema, req.body);
  const data = await taskService.updateTask(id, body, quien(req));
  res.json({ success: true, data });
});

export const move = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const body = validar(moveTaskSchema, req.body);
  const data = await taskService.moveTask(id, body, quien(req));
  res.json({ success: true, data });
});

export const archive = accion(async (req, res) => {
  const data = await taskService.archiveTask(validarId(req.params.id), quien(req));
  res.json({ success: true, data });
});

export const returnTask = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const body = validar(returnTaskSchema, req.body);
  const data = await taskService.returnTask(id, body, quien(req));
  res.json({ success: true, data });
});

export const approve = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const data = await taskService.approveTask(id, quien(req));
  res.json({ success: true, data });
});

export const reviewTasks = accion(async (req, res) => {
  const data = await taskService.getReviewTasks(quien(req), validar(ambitoQuerySchema, req.query));
  res.json({ success: true, data });
});

export const reviewCount = accion(async (req, res) => {
  const data = await taskService.getReviewCount(quien(req), validar(ambitoQuerySchema, req.query));
  res.json({ success: true, data });
});

/* --- Personas, Etiquetas y Métricas --- */

export const assignees = accion(async (req, res) => {
  const data = await taskService.listAssignees(quien(req), validar(assigneesQuerySchema, req.query));
  res.json({ success: true, data });
});

export const tagNames = accion(async (req, res) => {
  const data = await taskService.listTagNames(quien(req), validar(ambitoQuerySchema, req.query));
  res.json({ success: true, data });
});

export const teamMetrics = accion(async (req, res) => {
  const q = validar(metricsQuerySchema, req.query);
  const data = await taskService.getTeamMetrics(q.project_id || null, q.area_id || null, quien(req), q);
  res.json({ success: true, data });
});

export const teamMetricsByArea = accion(async (req, res) => {
  const q = validar(metricsQuerySchema, req.query);
  const data = await taskService.getTeamMetricsByArea(q.project_id || null, quien(req), q);
  res.json({ success: true, data });
});

/* --- Lista de comprobación --- */

export const addChecklistItem = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const body = validar(addChecklistItemSchema, req.body);
  const data = await taskService.addChecklistItem(taskId, body, quien(req));
  res.status(201).json({ success: true, data });
});

export const updateChecklistItem = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const itemId = validarId(req.params.itemId);
  const body = validar(updateChecklistItemSchema, req.body);
  const data = await taskService.updateChecklistItem(taskId, itemId, body, quien(req));
  res.json({ success: true, data });
});

export const deleteChecklistItem = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const itemId = validarId(req.params.itemId);
  const data = await taskService.deleteChecklistItem(taskId, itemId, quien(req));
  res.json({ success: true, data });
});

/* --- Comentarios --- */

export const addComment = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const body = validar(addCommentSchema, req.body);
  const data = await taskService.addComment(taskId, body, quien(req));
  res.status(201).json({ success: true, data });
});

export const deleteComment = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const commentId = validarId(req.params.commentId);
  const data = await taskService.deleteComment(taskId, commentId, quien(req));
  res.json({ success: true, data });
});

/* --- Etiquetas --- */

export const addTag = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const body = validar(addTagSchema, req.body);
  const data = await taskService.addTag(taskId, body, quien(req));
  res.status(201).json({ success: true, data });
});

export const deleteTag = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const tagId = validarId(req.params.tagId);
  const data = await taskService.deleteTag(taskId, tagId, quien(req));
  res.json({ success: true, data });
});

/* --- Enlaces --- */

export const addLink = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const body = validar(addLinkSchema, req.body);
  const data = await taskService.addLink(taskId, body, quien(req));
  res.status(201).json({ success: true, data });
});

export const deleteLink = accion(async (req, res) => {
  const taskId = validarId(req.params.id);
  const linkId = validarId(req.params.linkId);
  const data = await taskService.deleteLink(taskId, linkId, quien(req));
  res.json({ success: true, data });
});

/* --- Configuración: Columnas --- */

export const listColumns = accion(async (req, res) => {
  const data = await taskService.listColumns(quien(req));
  res.json({ success: true, data });
});

export const createColumn = accion(async (req, res) => {
  const body = validar(createColumnSchema, req.body);
  const data = await taskService.createColumn(body, quien(req));
  res.status(201).json({ success: true, data });
});

export const updateColumn = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const body = validar(updateColumnSchema, req.body);
  const data = await taskService.updateColumn(id, body, quien(req));
  res.json({ success: true, data });
});

export const archiveColumn = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const data = await taskService.archiveColumn(id, quien(req));
  res.json({ success: true, data });
});

export const reorderColumns = accion(async (req, res) => {
  const body = validar(reorderColumnsSchema, req.body);
  const data = await taskService.reorderColumns(body, quien(req));
  res.json({ success: true, data });
});

/* --- Configuración: Áreas --- */

export const listAreas = accion(async (req, res) => {
  const data = await taskService.listAreas(quien(req));
  res.json({ success: true, data });
});

export const createArea = accion(async (req, res) => {
  const body = validar(createAreaSchema, req.body);
  const data = await taskService.createArea(body, quien(req));
  res.status(201).json({ success: true, data });
});

export const updateArea = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const body = validar(updateAreaSchema, req.body);
  const data = await taskService.updateArea(id, body, quien(req));
  res.json({ success: true, data });
});

export const getUserAreas = accion(async (req, res) => {
  const userId = validarId(req.params.userId);
  const data = await taskService.getUserAreas(userId, quien(req));
  res.json({ success: true, data });
});

export const getUserAreaAssignments = accion(async (req, res) => {
  const data = await taskService.getUserAreaAssignments(quien(req));
  res.json({ success: true, data });
});

export const setUserAreas = accion(async (req, res) => {
  const userId = validarId(req.params.userId);
  const body = validar(setUserAreasSchema, req.body);
  const data = await taskService.setUserAreas(userId, body, quien(req));
  res.json({ success: true, data });
});

export const setAreaMembers = accion(async (req, res) => {
  const areaId = validarId(req.params.id);
  const body = validar(setAreaMembersSchema, req.body);
  const data = await taskService.setAreaMembers(areaId, body, quien(req));
  res.json({ success: true, data });
});

/* --- Configuración: Proyectos Propios --- */

export const listExternalProjects = accion(async (req, res) => {
  const data = await taskService.listExternalProjects(quien(req));
  res.json({ success: true, data });
});

export const createExternalProject = accion(async (req, res) => {
  const body = validar(createExternalProjectSchema, req.body);
  const data = await taskService.createExternalProject(body, quien(req));
  res.status(201).json({ success: true, data });
});

export const updateExternalProject = accion(async (req, res) => {
  const id = validarId(req.params.id);
  const body = validar(updateExternalProjectSchema, req.body);
  const data = await taskService.updateExternalProject(id, body, quien(req));
  res.json({ success: true, data });
});

/* --- Equipos del tablero (26/10/2026) --- */

const responder = (fn) => accion(async (req, res) => {
  const data = await fn(req);
  res.status(req.method === 'POST' ? 201 : 200).json({ success: true, data });
});

export const listTeams = responder((req) => equipos.listar(quien(req), validar(listTeamsQuerySchema, req.query)));
export const myTeams = responder((req) => equipos.mios(quien(req)));
export const teamEmpresas = responder((req) => equipos.empresas(quien(req)));
export const getTeam = responder((req) => equipos.detalle(quien(req), validarId(req.params.teamId)));
export const createTeam = responder((req) => equipos.crear(quien(req), validar(createTeamSchema, req.body)));
export const updateTeam = responder((req) => equipos.editar(quien(req), validarId(req.params.teamId), validar(updateTeamSchema, req.body)));
export const createTeamRole = responder((req) => equipos.crearCargo(quien(req), validarId(req.params.teamId), validar(createTeamRoleSchema, req.body)));
export const updateTeamRole = responder((req) => equipos.editarCargo(quien(req), validarId(req.params.teamId),
  validarId(req.params.roleId), validar(updateTeamRoleSchema, req.body)));
export const teamCandidates = responder((req) => equipos.candidatos(quien(req), validarId(req.params.teamId)));
export const setTeamMember = responder((req) => equipos.ponerMiembro(quien(req), validarId(req.params.teamId),
  validarId(req.params.userId), validar(setTeamMemberSchema, req.body)));
export const removeTeamMember = responder((req) => equipos.quitarMiembro(quien(req), validarId(req.params.teamId), validarId(req.params.userId)));
