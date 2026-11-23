// #694 · Las formas en que una persona tiene (o no) cada permiso, sin React,
// para que la ficha y su prueba digan lo mismo. Todo sale del catálogo y del
// origen que calcula el servidor (resolver.js): nada escrito a mano aquí, así
// un permiso o un rol nuevo sale solo.
import type { AccionDelCatalogo, Catalogo, Origen } from '../api/permissions.api';
import { nombreDe } from './permisos';

/** De dónde le viene (o por qué no lo tiene). Cada una se pinta distinta. */
export type FormaDeOrigen =
  | 'superadmin'
  | 'rol'            // de serie por su rol principal
  | 'rol_extra'      // por uno de sus roles de más
  | 'ajuste_rol'     // su rol, cambiado en Configuración › Roles
  | 'rol_a_medida'
  | 'dado'           // excepción suya: dado a mano
  | 'quitado'        // excepción suya: quitado a mano
  | 'nunca'          // su rol no puede tenerlo: bloqueada, con el motivo
  | 'ninguno';       // su rol no lo trae

/** Lo que es el permiso en sí, tenga quien lo tenga. */
export type Marca = 'propia' | 'independiente' | 'requiere' | 'soloPrincipal';

export interface Forma {
  clave: string;
  tiene: boolean;
  origen: FormaDeOrigen;
  /** La etiqueta de su origen: «Su rol: Gestora», «Rol de más: Tutor»… */
  texto: string;
  marcas: Marca[];
  /** Las que necesita, con su nombre, y si ya las tiene. */
  requiere: { clave: string; nombre: string; tiene: boolean }[];
  /** Si no se le puede dar ni con excepción, por qué. */
  bloqueo: string | null;
}

/** El nombre de un rol, del catálogo. */
export function nombreDeRol(catalogo: Catalogo, rol: string): string {
  return catalogo.roles?.find((r) => r.clave === rol)?.nombre || rol;
}

const lista = (catalogo: Catalogo, roles: string[]) => roles.map((r) => nombreDeRol(catalogo, r)).join(' + ');

/** El motivo de una casilla bloqueada (`nunca` / `nuncaPrincipal`). */
export function motivoDelBloqueo(catalogo: Catalogo, o: Extract<Origen, { tipo: 'nunca' }>, role?: string): string {
  if (o.principal && role) {
    return `Bloqueado: su rol principal (${nombreDeRol(catalogo, role)}) no puede tenerlo, aunque tenga otros roles, ni con excepción.`;
  }
  const roles = o.roles?.length ? o.roles : (role ? [role] : []);
  return roles.length > 1
    ? `Bloqueado: sus roles (${lista(catalogo, roles)}) no pueden tenerlo, ni con excepción.`
    : `Bloqueado: su rol (${lista(catalogo, roles)}) no puede tenerlo, ni con excepción.`;
}

/** De dónde le viene un permiso, en una etiqueta corta. */
export function textoDeOrigen(catalogo: Catalogo, o: Origen | undefined, tiene: boolean, role?: string): string {
  if (!o) return '';
  switch (o.tipo) {
    case 'superadmin': return 'Superadmin: todo, siempre';
    case 'rol': return o.extra ? `Rol de más: ${nombreDeRol(catalogo, o.rol)}` : `Su rol: ${nombreDeRol(catalogo, o.rol)}`;
    case 'ajuste_rol': return `${o.extra ? 'Rol de más' : 'Su rol'} (cambiado en Roles): ${nombreDeRol(catalogo, o.rol)}`;
    case 'rol_a_medida': return `Rol a medida: ${o.nombre}`;
    case 'excepcion': return tiene ? 'Excepción suya: dado a mano' : 'Excepción suya: quitado a mano';
    case 'nunca': return motivoDelBloqueo(catalogo, o, role);
    default: return 'Su rol no lo trae';
  }
}

function formaDeOrigen(o: Origen | undefined, tiene: boolean): FormaDeOrigen {
  switch (o?.tipo) {
    case 'superadmin': return 'superadmin';
    case 'rol': return o.extra ? 'rol_extra' : 'rol';
    case 'ajuste_rol': return 'ajuste_rol';
    case 'rol_a_medida': return 'rol_a_medida';
    case 'excepcion': return tiene ? 'dado' : 'quitado';
    case 'nunca': return 'nunca';
    default: return 'ninguno';
  }
}

/** La forma de un permiso para una persona: su origen, sus marcas y si está bloqueado. */
export function formaDe(
  catalogo: Catalogo,
  a: AccionDelCatalogo,
  { mapa, origenes, role }: { mapa: Record<string, boolean>; origenes: Record<string, Origen>; role?: string },
): Forma {
  const tiene = mapa[a.clave] === true;
  const o = origenes[a.clave];
  const requiere = (a.requiere || []).map((k) => ({ clave: k, nombre: nombreDe(catalogo, k), tiene: mapa[k] === true }));
  const marcas: Marca[] = [];
  if (a.propia) marcas.push('propia');
  if (a.independiente) marcas.push('independiente');
  if (requiere.length) marcas.push('requiere');
  if (a.soloPrincipal) marcas.push('soloPrincipal');
  return {
    clave: a.clave,
    tiene,
    origen: formaDeOrigen(o, tiene),
    texto: textoDeOrigen(catalogo, o, tiene, role),
    marcas,
    requiere,
    bloqueo: o?.tipo === 'nunca' ? motivoDelBloqueo(catalogo, o, role) : null,
  };
}

/** El texto de cada marca, para la etiqueta y su explicación. */
export const MARCAS: Record<Marca, { etiqueta: string; ayuda: string }> = {
  propia: { etiqueta: 'Solo lo suyo', ayuda: 'Solo sobre lo suyo (su factura, sus consultas, sus cursos): no da poder sobre nada de otros.' },
  independiente: { etiqueta: 'Independiente', ayuda: 'No depende de otro permiso: es una pantalla aparte.' },
  requiere: { etiqueta: 'Requiere otro', ayuda: 'No sirve sin el permiso que necesita, y no se puede dar sin él.' },
  soloPrincipal: { etiqueta: 'Solo rol principal', ayuda: 'De serie lo trae solo su rol principal: un rol de más no lo suma.' },
};

/** El texto de cada origen para la leyenda. */
export const ORIGENES: Record<Exclude<FormaDeOrigen, 'superadmin' | 'ninguno'>, string> = {
  rol: 'De serie por su rol',
  rol_extra: 'Por un rol de más',
  ajuste_rol: 'Su rol, cambiado en Roles',
  rol_a_medida: 'Rol a medida',
  dado: 'Dado a mano',
  quitado: 'Quitado a mano',
  nunca: 'Bloqueado para su rol',
};
