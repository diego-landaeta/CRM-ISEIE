import client from '@/shared/api/client';
import type {
  Assignee,
  TagName,
  Task,
  TaskArea,
  TaskChecklistItem,
  TaskColumn,
  TaskComment,
  TaskDetail,
  TaskExternalProject,
  TaskLink,
  TaskPriority,
  TaskStatus,
  TaskTag,
  TeamMemberMetric,
  AreaMetric,
  Team,
  TeamMember,
  TeamRole,
  MyTeam,
} from '../types';

/**
 * La empresa o el campus elegidos arriba (#245, Diego 08/10). Sale de
 * `ambitoComoObjeto`: `{}`, `{ issuerId }` o `{ projectId }`. El servidor lo
 * recorta además a los campus de quien mira.
 */
export type Ambito = { issuerId?: number; projectId?: number };

export type GetTasksParams = Ambito & {
  /** El equipo elegido arriba; 0 = «Sin equipo». */
  team_id?: number;
  status?: TaskStatus;
  assigned_to?: number;
  project_id?: number;
  external_project_id?: number;
  area_id?: number;
  priority?: TaskPriority;
  search?: string;
  tag?: string;
  vencidas?: boolean;
  desde?: string;
  hasta?: string;
};

export type TaskPayload = {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
  project_id?: number | null;
  external_project_id?: number | null;
  area_id?: number | null;
  status?: TaskStatus;
  assigned_to?: number | null;
  /** Quien la supervisa (26/10/2026). Solo lo manda quien puede asignar. */
  supervisor_id?: number | null;
  /** Su equipo (26/10/2026). */
  team_id?: number | null;
};

export async function getTasks(params: GetTasksParams = {}): Promise<Task[]> {
  const limpios = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false)
  );
  const { data } = await client.get<Task[]>('/tasks', { params: limpios });
  return data ?? [];
}

export async function getTaskById(id: number): Promise<TaskDetail> {
  const { data } = await client.get<TaskDetail>(`/tasks/${id}`);
  return data as TaskDetail;
}

export async function createTask(payload: TaskPayload): Promise<Task> {
  const { data } = await client.post<Task>('/tasks', payload);
  return data as Task;
}

export async function updateTask(id: number, payload: Partial<TaskPayload>): Promise<Task> {
  const { data } = await client.patch<Task>(`/tasks/${id}`, payload);
  return data as Task;
}

export async function moveTask(
  id: number,
  payload: { status: TaskStatus; prev_id?: number | null; next_id?: number | null }
): Promise<Task> {
  const { data } = await client.patch<Task>(`/tasks/${id}/move`, payload);
  return data as Task;
}

export async function returnTask(id: number, comment: string): Promise<Task> {
  const { data } = await client.patch<Task>(`/tasks/${id}/return`, { comment });
  return data as Task;
}

export async function approveTask(id: number): Promise<Task> {
  const { data } = await client.patch<Task>(`/tasks/${id}/approve`, {});
  return data as Task;
}

export async function getReviewTasks(ambito: Ambito = {}): Promise<Task[]> {
  const { data } = await client.get<Task[]>('/tasks/review', { params: ambito });
  return data ?? [];
}

export async function getReviewCount(ambito: Ambito = {}): Promise<{ count: number }> {
  const { data } = await client.get<{ count: number }>('/tasks/review/count', { params: ambito });
  return data ?? { count: 0 };
}

export async function archiveTask(id: number): Promise<Task> {
  const { data } = await client.delete<Task>(`/tasks/${id}`);
  return data as Task;
}

export async function getAssignees(ambito: Ambito & { team_id?: number } = {}): Promise<Assignee[]> {
  const { data } = await client.get<Assignee[]>('/tasks/assignees', { params: ambito });
  return data ?? [];
}

export async function getTagNames(ambito: Ambito = {}): Promise<TagName[]> {
  const { data } = await client.get<TagName[]>('/tasks/tags', { params: ambito });
  return data ?? [];
}

/* --- Lista de comprobación --- */

export async function addChecklistItem(taskId: number, payload: { title: string }): Promise<TaskChecklistItem> {
  const { data } = await client.post<TaskChecklistItem>(`/tasks/${taskId}/checklist`, payload);
  return data as TaskChecklistItem;
}

export async function updateChecklistItem(
  taskId: number,
  itemId: number,
  payload: { title?: string; is_completed?: boolean }
): Promise<TaskChecklistItem> {
  const { data } = await client.patch<TaskChecklistItem>(`/tasks/${taskId}/checklist/${itemId}`, payload);
  return data as TaskChecklistItem;
}

export async function deleteChecklistItem(taskId: number, itemId: number): Promise<void> {
  await client.delete(`/tasks/${taskId}/checklist/${itemId}`);
}

/* --- Comentarios --- */

export async function addComment(taskId: number, payload: { content: string }): Promise<TaskComment> {
  const { data } = await client.post<TaskComment>(`/tasks/${taskId}/comments`, payload);
  return data as TaskComment;
}

export async function deleteComment(taskId: number, commentId: number): Promise<void> {
  await client.delete(`/tasks/${taskId}/comments/${commentId}`);
}

/* --- Etiquetas --- */

export async function addTag(taskId: number, payload: { name: string; color: string }): Promise<TaskTag> {
  const { data } = await client.post<TaskTag>(`/tasks/${taskId}/tags`, payload);
  return data as TaskTag;
}

export async function deleteTag(taskId: number, tagId: number): Promise<void> {
  await client.delete(`/tasks/${taskId}/tags/${tagId}`);
}

/* --- Enlaces --- */

export async function addLink(taskId: number, payload: { url: string; title?: string | null }): Promise<TaskLink> {
  const { data } = await client.post<TaskLink>(`/tasks/${taskId}/links`, payload);
  return data as TaskLink;
}

export async function deleteLink(taskId: number, linkId: number): Promise<void> {
  await client.delete(`/tasks/${taskId}/links/${linkId}`);
}

/* --- Todo el equipo --- */

export async function getTeamMetrics(projectId?: number, areaId?: number, ambito: Ambito = {}): Promise<TeamMemberMetric[]> {
  const { data } = await client.get<TeamMemberMetric[]>('/tasks/metrics', {
    params: {
      ...ambito,
      ...(projectId ? { project_id: projectId } : {}),
      ...(areaId ? { area_id: areaId } : {}),
    },
  });
  return data ?? [];
}

/** «Todo el equipo» agrupado por área. */
export async function getTeamMetricsByArea(projectId?: number, ambito: Ambito = {}): Promise<AreaMetric[]> {
  const { data } = await client.get<AreaMetric[]>('/tasks/metrics/areas', {
    params: { ...ambito, ...(projectId ? { project_id: projectId } : {}) },
  });
  return data ?? [];
}

/* --- Configuración de Columnas --- */

export async function getColumns(): Promise<TaskColumn[]> {
  const { data } = await client.get<TaskColumn[]>('/tasks/columns');
  return data ?? [];
}

export async function createColumn(payload: { key: string; name: string; color?: string; sort_order?: number }): Promise<TaskColumn> {
  const { data } = await client.post<TaskColumn>('/tasks/columns', payload);
  return data as TaskColumn;
}

export async function updateColumn(id: number, payload: Partial<TaskColumn>): Promise<TaskColumn> {
  const { data } = await client.patch<TaskColumn>(`/tasks/columns/${id}`, payload);
  return data as TaskColumn;
}

export async function archiveColumn(id: number): Promise<TaskColumn> {
  const { data } = await client.delete<TaskColumn>(`/tasks/columns/${id}`);
  return data as TaskColumn;
}

export async function reorderColumns(keys: string[]): Promise<TaskColumn[]> {
  const { data } = await client.patch<TaskColumn[]>('/tasks/columns/reorder', { keys });
  return data ?? [];
}

/* --- Configuración de Áreas --- */

export async function getAreas(): Promise<TaskArea[]> {
  const { data } = await client.get<TaskArea[]>('/tasks/areas');
  return data ?? [];
}

export async function createArea(payload: { name: string; color?: string; sort_order?: number }): Promise<TaskArea> {
  const { data } = await client.post<TaskArea>('/tasks/areas', payload);
  return data as TaskArea;
}

export async function updateArea(id: number, payload: Partial<TaskArea>): Promise<TaskArea> {
  const { data } = await client.patch<TaskArea>(`/tasks/areas/${id}`, payload);
  return data as TaskArea;
}

export async function getUserAreaAssignments(): Promise<{ user_id: number; area_id: number }[]> {
  const { data } = await client.get<{ user_id: number; area_id: number }[]>('/tasks/areas/assignments');
  return data ?? [];
}

/** Quién está en un área: la lista entera. Las demás áreas de cada persona no se tocan. */
export async function setAreaMembers(areaId: number, userIds: number[]): Promise<number[]> {
  const { data } = await client.put<number[]>(`/tasks/areas/${areaId}/members`, { user_ids: userIds });
  return data ?? [];
}

/* --- Configuración de Proyectos Propios --- */

export async function getExternalProjects(): Promise<TaskExternalProject[]> {
  const { data } = await client.get<TaskExternalProject[]>('/tasks/external-projects');
  return data ?? [];
}

export async function createExternalProject(payload: { name: string; description?: string | null; url?: string | null; color?: string }): Promise<TaskExternalProject> {
  const { data } = await client.post<TaskExternalProject>('/tasks/external-projects', payload);
  return data as TaskExternalProject;
}

export async function updateExternalProject(id: number, payload: Partial<TaskExternalProject>): Promise<TaskExternalProject> {
  const { data } = await client.patch<TaskExternalProject>(`/tasks/external-projects/${id}`, payload);
  return data as TaskExternalProject;
}

/* --- Equipos del tablero (26/10/2026) --- */

export async function getTeams(opciones: { gestion?: boolean } = {}): Promise<Team[]> {
  const { data } = await client.get<Team[]>('/tasks/teams', { params: opciones.gestion ? { gestion: 'true' } : {} });
  return data ?? [];
}

export async function getMyTeams(): Promise<MyTeam[]> {
  const { data } = await client.get<MyTeam[]>('/tasks/teams/mine');
  return data ?? [];
}

export async function getTeamEmpresas(): Promise<{ id: number; razon_social: string }[]> {
  const { data } = await client.get<{ id: number; razon_social: string }[]>('/tasks/teams/empresas');
  return data ?? [];
}

export async function getTeam(id: number): Promise<Team & { miembros: TeamMember[] }> {
  const { data } = await client.get<Team & { miembros: TeamMember[] }>(`/tasks/teams/${id}`);
  return data;
}

export async function createTeam(body: { issuer_id: number; name: string; color?: string }): Promise<Team> {
  const { data } = await client.post<Team>('/tasks/teams', body);
  return data;
}

export async function updateTeam(id: number, body: Partial<Pick<Team, 'name' | 'color' | 'is_active' | 'sort_order'>>): Promise<Team> {
  const { data } = await client.patch<Team>(`/tasks/teams/${id}`, body);
  return data;
}

export async function createTeamRole(teamId: number, body: { name: string; level: number; sort_order?: number }): Promise<TeamRole> {
  const { data } = await client.post<TeamRole>(`/tasks/teams/${teamId}/roles`, body);
  return data;
}

export async function updateTeamRole(teamId: number, roleId: number, body: Partial<Pick<TeamRole, 'name' | 'level' | 'sort_order' | 'is_active'>>): Promise<TeamRole> {
  const { data } = await client.patch<TeamRole>(`/tasks/teams/${teamId}/roles/${roleId}`, body);
  return data;
}

export async function getTeamCandidates(teamId: number): Promise<{ id: number; nombre: string; email: string; role: string }[]> {
  const { data } = await client.get<{ id: number; nombre: string; email: string; role: string }[]>(`/tasks/teams/${teamId}/candidates`);
  return data ?? [];
}

export async function setTeamMember(teamId: number, userId: number, teamRoleId: number): Promise<TeamMember[]> {
  const { data } = await client.put<TeamMember[]>(`/tasks/teams/${teamId}/members/${userId}`, { team_role_id: teamRoleId });
  return data ?? [];
}

export async function removeTeamMember(teamId: number, userId: number): Promise<TeamMember[]> {
  const { data } = await client.delete<TeamMember[]>(`/tasks/teams/${teamId}/members/${userId}`);
  return data ?? [];
}
