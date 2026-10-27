import client from '@/shared/api/client';
import type { PermissionMap } from '@/shared/hooks/usePermission';

// Roles a medida y la vista que estrena cada rol.
//
// El backend ya esta: `/permissions/system-defaults` sirve el catalogo entero
// (recursos, acciones, widgets y elementos del menu) y las vistas de los cuatro
// roles fijos. Se lee de ahi a proposito, en vez de copiarlo aqui: la copia es
// justo lo que hizo que el frontal hablara `leads.read` mientras el backend
// decia `leads.view`.

// Los nombres son los de la tabla: `label` y `description`. Estaban declarados
// como `nombre` y `descripcion`, que no es lo que devuelve el backend, asi que
// todo rol a medida se pintaba sin nombre — sin fallar, solo en blanco.
export interface CustomRole {
  id: number;
  label: string;
  description?: string | null;
  base_role?: string | null;
  permissions?: PermissionMap;
  active?: boolean;
}

// Custom roles son globales (no por proyecto). El parámetro projectId se acepta
// por compat pero no se envía al backend.
export async function listCustomRoles(_projectId?: number): Promise<CustomRole[]> {
  const res = await client.get(`/permissions/custom-roles`);
  return (res.data as CustomRole[]) || [];
}

export interface RoleView {
  default_route?: string;
  hidden_sidebar_items?: string[];
  dashboard_widgets?: string[];
  compact_sidebar?: boolean;
}

export interface CatalogItem { id: string; label: string; scope?: string }

export interface SystemDefaults {
  resources: Record<string, string[]>;
  roles: Record<string, PermissionMap | null>;
  views: Record<string, RoleView>;
  catalogs: { dashboard_widgets: CatalogItem[]; sidebar_items: CatalogItem[] };
}

/** Catalogo y vistas por defecto. La autoridad esta en el backend. */
export async function getSystemDefaults(): Promise<SystemDefaults> {
  const res = await client.get(`/permissions/system-defaults`);
  return res.data as SystemDefaults;
}

/**
 * La vista de un rol: nombre para los fijos, id numerico para los a medida.
 *
 * El backend la envuelve en `view` y devuelve al lado `is_system` y `role`.
 * Leer el nivel de arriba deja todos los campos en undefined y la pantalla se
 * pinta entera a cero sin dar ningun error.
 */
export async function getRoleView(roleKey: string | number): Promise<RoleView> {
  const res = await client.get(`/permissions/role-views/${roleKey}`);
  return ((res.data as { view?: RoleView })?.view || {}) as RoleView;
}

/**
 * Guarda la vista de un rol a medida.
 *
 * Solo acepta id numerico: los cuatro fijos viven en el codigo del backend y
 * responden 400 si se intentan guardar. La pantalla ni ofrece el boton.
 */
export async function setRoleView(id: number, view: RoleView): Promise<RoleView> {
  const res = await client.put(`/permissions/role-views/${id}`, view);
  // Al guardar la envuelve en `default_view`, que no es como la devuelve el GET.
  return ((res.data as { default_view?: RoleView })?.default_view || view) as RoleView;
}

/* ─── #423 · El catálogo, los roles y la ficha de permisos de cada persona ─── */

export interface AccionDelCatalogo {
  clave: string;
  accion: string;
  nombre: string;
  descripcion: string;
  /** Roles fijos que la traen de serie. */
  roles: string[];
  /** Lo que necesita para tener sentido (editar pide ver). */
  requiere: string[];
  /** Roles a los que no se les puede dar nunca. */
  nunca: string[];
  /** Ni con excepción si su rol PRINCIPAL es uno de estos (WhatsApp, MCP). */
  nuncaPrincipal?: string[];
  soloPantalla: boolean;
}
export interface RecursoDelCatalogo { clave: string; nombre: string; acciones: AccionDelCatalogo[] }
export interface SeccionDelCatalogo { clave: string; nombre: string; recursos: RecursoDelCatalogo[] }
export interface RolFijoDelCatalogo { clave: string; nombre: string; descripcion: string }
export interface Catalogo { roles: RolFijoDelCatalogo[]; secciones: SeccionDelCatalogo[] }

export async function getCatalogo(): Promise<Catalogo> {
  const res = await client.get('/permissions/catalogo');
  return res.data as Catalogo;
}

export interface RolFijo {
  clave: string; nombre: string; descripcion: string;
  permisos: PermissionMap; cambiados: string[]; personas: number; editable: boolean;
}
export interface RolAMedida {
  id: number; nombre: string; descripcion: string | null; base: string; activo: boolean;
  permisos: PermissionMap; cambiados: string[]; personas: number;
}
export interface ListaDeRoles { fijos: RolFijo[]; aMedida: RolAMedida[] }

export async function getRoles(): Promise<ListaDeRoles> {
  const res = await client.get('/permissions/roles');
  return res.data as ListaDeRoles;
}

export async function guardarRolFijo(rol: string, permisos: PermissionMap): Promise<PermissionMap> {
  const res = await client.put(`/permissions/roles/fijos/${rol}`, { permisos });
  return res.data as PermissionMap;
}

export interface DatosRolAMedida { nombre?: string; descripcion?: string | null; base?: string; activo?: boolean; permisos?: PermissionMap }

export async function crearRolAMedida(datos: DatosRolAMedida): Promise<{ id: number }> {
  const res = await client.post('/permissions/roles/a-medida', datos);
  return res.data as { id: number };
}

export async function guardarRolAMedida(id: number, datos: DatosRolAMedida): Promise<void> {
  await client.patch(`/permissions/roles/a-medida/${id}`, datos);
}

export type Origen =
  | { tipo: 'superadmin' }
  | { tipo: 'rol'; rol: string }
  | { tipo: 'ajuste_rol'; rol: string }
  | { tipo: 'rol_a_medida'; id: number; nombre: string }
  | { tipo: 'excepcion' }
  | { tipo: 'nunca'; roles: string[] }
  | { tipo: 'ninguno' };

export interface ApunteDelRegistro {
  id: number; cuando: string; quien_nombre: string | null; clave: string;
  antes: string | null; despues: string | null; origen: string;
}

export interface FichaDePermisos {
  persona: { id: number; nombre: string; email: string; role: string; roles_extra: string[]; active: boolean };
  mapa: PermissionMap;
  origenes: Record<string, Origen>;
  excepciones: PermissionMap;
  rolAMedida: { id: number; nombre: string; activo: boolean } | null;
  rolesAMedida: { id: number; nombre: string; base: string }[];
  registro: ApunteDelRegistro[];
  puedeEditar: boolean;
}

export async function getFicha(userId: number): Promise<FichaDePermisos> {
  const res = await client.get(`/permissions/personas/${userId}`);
  return res.data as FichaDePermisos;
}

/** `null` = como diga su rol. */
export async function guardarExcepciones(userId: number, cambios: Record<string, boolean | null>): Promise<PermissionMap> {
  const res = await client.put(`/permissions/personas/${userId}/excepciones`, { cambios });
  return res.data as PermissionMap;
}

export async function cambiarRolAMedida(userId: number, customRoleId: number | null): Promise<PermissionMap> {
  const res = await client.put(`/permissions/personas/${userId}/rol-a-medida`, { customRoleId });
  return res.data as PermissionMap;
}
