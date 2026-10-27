export type TaskStatus = 'por_hacer' | 'en_curso' | 'en_revision' | 'hecha' | string;
export type TaskPriority = 'baja' | 'media' | 'alta';
export type TagColor = 'sky' | 'rose' | 'amber' | 'emerald' | 'violet' | 'slate' | string;

export interface TaskTag {
  id: number;
  name: string;
  color: TagColor;
}

export interface TaskChecklistItem {
  id: number;
  task_id: number;
  title: string;
  is_completed: boolean;
  position: number;
  created_at: string;
  updated_at?: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  user_name: string;
  user_avatar?: string | null;
  content: string;
  created_at: string;
  updated_at?: string;
}

export interface TaskLink {
  id: number;
  task_id: number;
  url: string;
  title: string | null;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface TaskEvent {
  id: number;
  task_id: number;
  user_id?: number | null;
  user_name?: string | null;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  priority: TaskPriority;
  due_date: string | null;
  project_id: number | null;
  project_name?: string | null;
  external_project_id?: number | null;
  external_project_name?: string | null;
  external_project_color?: string | null;
  area_id?: number | null;
  area_name?: string | null;
  area_color?: string | null;
  assigned_to: number | null;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  /** Quien la supervisa (26/10/2026): la ve, recibe los avisos y la aprueba o devuelve. */
  supervisor_id?: number | null;
  supervisor_name?: string | null;
  /** Su equipo (26/10/2026) y el cargo de quien la lleva en él. */
  team_id?: number | null;
  team_name?: string | null;
  team_color?: string | null;
  assigned_cargo?: string | null;
  /** Si quien mira puede moverla (arrastrarla): el responsable, el supervisor o un superadmin. */
  puede_mover?: boolean;
  created_by: number;
  created_by_name?: string | null;
  /** Cuándo pasó a «Hecha» (se borra si vuelve atrás). */
  completed_at: string | null;
  /** En la ficha: quién la pasó a «Hecha» (la cerró o la aprobó). */
  completed_by?: number | null;
  completed_by_name?: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  checklist_total?: number;
  checklist_completed?: number;
  comments_count?: number;
  links_count?: number;
  last_comment?: string | null;
  tags?: TaskTag[];
}

/** La tarjeta abierta: con todo lo que cuelga de ella. */
/** Lo que quien mira puede hacer con esta tarea (lo decide el servidor, tasks.reglas.js). */
export interface TaskPermisos {
  mover: boolean;
  comentar: boolean;
  revisar: boolean;
  cerrar: boolean;
  editar: boolean;
  delegar: boolean;
}

export interface TaskDetail extends Task {
  permisos?: TaskPermisos;
  checklist: TaskChecklistItem[];
  comments: TaskComment[];
  tags: TaskTag[];
  links: TaskLink[];
  events: TaskEvent[];
}

export interface Assignee {
  id: number;
  nombre: string;
  email: string;
  role: string;
  /** Si quien mira puede ponerla como responsable (un colaborador sin campus, solo el superadmin). */
  asignable?: boolean;
  /** Con un equipo elegido: su cargo y su nivel en él (null si no está). */
  team_nivel?: number | null;
  team_cargo?: string | null;
  /** Sus equipos, con su cargo: el equipo de una tarea es el de quien la lleva (27/10/2026). */
  equipos?: Array<{ team_id: number; team_name: string; issuer_id: number; empresa: string; cargo: string | null; nivel: number | null }>;
}

/** Un cargo de un equipo, con su nivel: se delega hacia niveles menores. */
export interface TeamRole {
  id: number;
  name: string;
  level: number;
  sort_order: number;
  is_active: boolean;
}

/** Un equipo del tablero (26/10/2026), de una empresa. */
export interface Team {
  id: number;
  issuer_id: number;
  empresa: string;
  name: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  miembros: number;
  cargos: TeamRole[];
}

export interface TeamMember {
  id: number;
  nombre: string;
  email: string;
  role: string;
  active: boolean;
  team_role_id: number;
  cargo: string;
  nivel: number;
}

/** Un equipo de quien mira, con su cargo. */
export interface MyTeam {
  team_id: number;
  team_name: string;
  team_color: string;
  issuer_id: number;
  empresa: string;
  team_role_id: number;
  cargo: string;
  nivel: number;
  puede_delegar: boolean;
}

export interface TagName {
  name: string;
  total: number;
}

export interface TeamMemberMetric {
  user_id: number;
  user_name: string;
  user_email: string;
  user_role: string;
  open_tasks: number;
  overdue_tasks: number;
  completed_this_week: number;
  completed_this_month: number;
}

export interface AreaMetric {
  area_id: number | null;
  area_name: string;
  area_color: string | null;
  open_tasks: number;
  overdue_tasks: number;
  completed_this_week: number;
  completed_this_month: number;
  people: number;
}

export interface TaskColumn {
  id: number;
  key: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TaskArea {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  member_count?: number;
}

export interface TaskExternalProject {
  id: number;
  name: string;
  description: string | null;
  url?: string | null;
  color: string;
  sort_order?: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}
