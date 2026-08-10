import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/shared/types';

export type PermissionKey = string;
export type PermissionMap = Record<PermissionKey, boolean>;

export interface PermissionResource {
  key: string;
  label: string;
  actions: string[];
}

export interface FixedRole {
  key: UserRole;
  label: string;
  desc: string;
  color: 'rose' | 'violet' | 'sky' | 'emerald';
}

// Permisos por rol fijo del sistema. Cuando CRM-228 (backend custom_roles)
// este desplegado, `user.permissions` vendra del backend y sobreescribira
// estos defaults. Mientras tanto, esta tabla cubre los 4 roles base.
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, PermissionMap> = {
  superadmin: { '*': true },
  soporte:    { '*': true },
  admin: {
    'leads.read': true,    'leads.create': true,    'leads.update': true,    'leads.delete': true,    'leads.export': true,    'leads.reassign': true,
    'clients.read': true,  'clients.create': true,  'clients.update': true,  'clients.delete': true,
    'products.read': true, 'products.create': true, 'products.update': true, 'products.delete': true,
    'conversions.read': true, 'conversions.create': true, 'conversions.update': true, 'conversions.delete': true,
    'matriculas.read': true,  'matriculas.create': true,  'matriculas.update': true,
    'reports.read': true,
    'users.read': true,    'users.create': true,    'users.update': true,    'users.delete': true,
    'settings.read': true, 'settings.update': true,
    'projects.read': true, 'projects.update': true,
    'campaigns.read': true,
    'accounting.read': true, 'accounting.update': true,
  },
  gestor: {
    'leads.read': true,    'leads.create': true,    'leads.update': true,
    'clients.read': true,
    'products.read': true,
    'conversions.read': true, 'conversions.create': true,
    'matriculas.read': true,
    'reports.read': true,
  },
};

export const PERMISSION_RESOURCES: ReadonlyArray<PermissionResource> = [
  { key: 'leads',       label: 'Prospectos',  actions: ['read', 'create', 'update', 'delete', 'export', 'reassign'] },
  { key: 'clients',     label: 'Clientes',    actions: ['read', 'create', 'update', 'delete'] },
  { key: 'products',    label: 'Productos',   actions: ['read', 'create', 'update', 'delete'] },
  { key: 'conversions', label: 'Conversiones', actions: ['read', 'create', 'update', 'delete'] },
  { key: 'matriculas',  label: 'Matrículas',  actions: ['read', 'create', 'update'] },
  { key: 'reports',     label: 'Reportes',    actions: ['read'] },
  { key: 'users',       label: 'Usuarios',    actions: ['read', 'create', 'update', 'delete'] },
  { key: 'settings',    label: 'Configuración', actions: ['read', 'update'] },
  { key: 'campaigns',   label: 'Campañas',    actions: ['read'] },
  { key: 'accounting',  label: 'Contabilidad', actions: ['read', 'update'] },
];

export const FIXED_ROLES: ReadonlyArray<FixedRole> = [
  { key: 'superadmin', label: 'Superadmin', desc: 'Acceso total. Solo este rol gestiona usuarios.', color: 'rose' },
  { key: 'admin',      label: 'Admin',      desc: 'Acceso operativo completo, no gestiona usuarios.', color: 'violet' },
  { key: 'gestor',     label: 'Gestor',     desc: 'Solo sus leads asignados.', color: 'sky' },
  // El tutor no entra al CRM normal: solo ve sus formaciones y lo suyo.
  { key: 'tutor',      label: 'Tutor',      desc: 'Colaborador externo. Solo sus formaciones y sus comisiones.', color: 'violet' },
  { key: 'soporte',    label: 'Soporte',    desc: 'Acceso de solo lectura para soporte técnico.', color: 'emerald' },
];

export interface UsePermissionResult {
  can: (permission: PermissionKey) => boolean;
  role: UserRole | undefined;
  isAdmin: boolean;
}

export default function usePermission(): UsePermissionResult {
  const { user } = useAuth();

  function can(permission: PermissionKey): boolean {
    if (!user) return false;
    // bypass para roles privilegiados
    if (user.role === 'superadmin' || user.role === 'soporte') return true;
    // override desde el backend (cuando CRM-228 exista)
    if (user.permissions && Object.keys(user.permissions).length > 0) {
      return user.permissions[permission] === true || user.permissions['*'] === true;
    }
    // fallback: defaults por rol
    const defaults = ROLE_DEFAULT_PERMISSIONS[user.role as UserRole] || {};
    return defaults[permission] === true || defaults['*'] === true;
  }

  return { can, role: user?.role, isAdmin: user?.role === 'admin' || user?.role === 'superadmin' };
}
