import client from '@/shared/api/client';

/**
 * Los roles que no se pueden dar, dichos antes de guardar (gemela de CRM#644:
 * Tony, admin de ICTESS, cinco altas rechazadas con «Ese rol le daría lo que tú
 * no tienes» sin saber qué cambiar). La regla es la del servidor (nadie da lo
 * que no tiene, #423); aquí solo se cuenta.
 */

export interface PuedeDarRol {
  puede: boolean;
  /** Los tres primeros permisos que le daría y quien da de alta no tiene. */
  faltan: string[];
  /** Cuántos son en total. */
  cuantos: number;
}

export interface RolAsignable {
  rol: string;
  nombre: string;
  principal: PuedeDarRol;
  anadido: PuedeDarRol;
}

/** Como se llama cada rol en Configuración › Usuarios. */
export const NOMBRE_ROL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', gestor: 'Gestor', soporte: 'Soporte', tutor: 'Tutor', colaborador: 'Colaborador',
};

/** Qué roles puede dar en un alta quien pregunta. La misma regla que al guardar. */
export async function listRolesAsignables(): Promise<RolAsignable[]> {
  const res = await client.get('/users/roles-asignables');
  if (!res?.success) throw new Error(res?.error || 'No se pudo saber qué roles puedes dar');
  return (res.data || []) as RolAsignable[];
}

const lista = (xs: string[], cuantos = xs.length) => `${xs.join(', ')}${cuantos > xs.length ? '…' : ''}`;
const comillas = (roles: string[]) => {
  const n = roles.map((r) => `«${NOMBRE_ROL[r] ?? r}»`);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0];
};

/** La línea bajo un rol que no se puede dar. Null si se puede (o aún no se sabe). */
export function motivoNoAsignable(p: PuedeDarRol | undefined): string | null {
  if (!p || p.puede) return null;
  return `No puedes dar este rol: le daría permisos que tú no tienes (${lista(p.faltan, p.cuantos)}). Pídeselo a un superadmin.`;
}

/** { rol: fila } para buscar rápido. */
export function porRol(roles: RolAsignable[] | null): Record<string, RolAsignable> {
  return Object.fromEntries((roles ?? []).map((r) => [r.rol, r]));
}

/**
 * Si el servidor aun así rechaza el alta o el cambio con NO_LO_TIENES, qué rol
 * quitar. El servidor dice cuál (`data.roles`); si no lo dijera, los que se
 * piden. Null si el error es otro.
 */
export function mensajeNoLoTienes(err: any, pedidos: { role: string; roles_extra?: string[] }): string | null {
  const cuerpo = err?.data;
  if (cuerpo?.code !== 'NO_LO_TIENES') return null;
  const datos = cuerpo.data || {};
  const extras = (pedidos.roles_extra || []).filter((r) => r !== pedidos.role);
  const roles: string[] = Array.isArray(datos.roles) && datos.roles.length ? datos.roles : [pedidos.role, ...extras];
  const faltan: string[] = Array.isArray(datos.faltan) ? datos.faltan : [];
  const por = faltan.length ? ` (${lista(faltan, datos.cuantos)})` : '';
  return `Quita ${comillas(roles)}: le daría permisos que tú no tienes${por}. Si de verdad lo necesita, pídeselo a un superadmin.`;
}
