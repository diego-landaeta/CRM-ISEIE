/*
  CAMPUS AGRUPADOS POR EMPRESA (Diego, 24/11/2026).

  «Tienen que haber separación de empresas y campus en esos casos para todos»:
  en las listas de Stripe (conectado / no conectado, «FALTA CONECTAR STRIPE», el
  estado y la salud de las integraciones) salían todos los campus mezclados.

  La empresa de cada campus es su sociedad emisora (`projects.sociedad_emisora_id`
  → `invoice_issuers.razon_social`), que ya viene en los proyectos de quien mira
  (`/auth/me`: `sociedad_emisora_id`, `sociedad_nombre`). No se pide nada aparte
  y el ámbito no cambia: se agrupa lo que el servidor ya ha recortado a lo suyo.

  Las empresas, por nombre; los campus, en el orden en que vienen; los que no
  tienen empresa (o no están entre los proyectos de quien mira), al final, en
  «Sin empresa asignada».
*/

export interface ProyectoConEmpresa {
  id: number | string;
  sociedad_emisora_id?: number | string | null;
  sociedad_nombre?: string | null;
}

export interface GrupoDeEmpresa<T> {
  /** El id de la empresa (`invoice_issuers.id`); null: sin empresa. */
  id: number | null;
  nombre: string;
  campus: T[];
}

export const SIN_EMPRESA = 'Sin empresa asignada';

export function agruparPorEmpresa<T>(
  items: T[],
  proyectos: ProyectoConEmpresa[] | null | undefined,
  idDelCampus: (item: T) => number,
): GrupoDeEmpresa<T>[] {
  const empresaDe = new Map<number, { id: number; nombre: string }>();
  for (const p of proyectos || []) {
    const id = Number(p?.sociedad_emisora_id);
    if (Number(p?.id) > 0 && id > 0) empresaDe.set(Number(p.id), { id, nombre: p.sociedad_nombre?.trim() || `Empresa ${id}` });
  }
  const grupos = new Map<number, GrupoDeEmpresa<T>>();
  const sueltos: T[] = [];
  for (const item of items || []) {
    const e = empresaDe.get(Number(idDelCampus(item)));
    if (!e) { sueltos.push(item); continue; }
    if (!grupos.has(e.id)) grupos.set(e.id, { id: e.id, nombre: e.nombre, campus: [] });
    grupos.get(e.id)!.campus.push(item);
  }
  const lista = [...grupos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (sueltos.length) lista.push({ id: null, nombre: SIN_EMPRESA, campus: sueltos });
  return lista;
}

/*
  STRIPE PRESTADO (rama `feat/stripe-prestado`): un campus puede cobrar con la
  cuenta de Stripe de otro (ICTESS US e Instituto Naval, con la de ICTESS). La API
  lo dirá con `stripe_prestado_de: { id, nombre }`; ese campus está conectado y se
  pinta «Usa el Stripe de <nombre>», nunca «falta conectar». Sin el campo, nada cambia.
*/
export interface StripePrestado { id: number; nombre: string | null }

export function stripePrestadoDe(c: { stripe_prestado_de?: StripePrestado | null } | null | undefined): StripePrestado | null {
  const p = c?.stripe_prestado_de;
  return p && Number(p.id) > 0 ? p : null;
}

export function textoStripePrestado(p: StripePrestado) {
  return `Usa el Stripe de ${p.nombre || `el campus ${p.id}`}`;
}
