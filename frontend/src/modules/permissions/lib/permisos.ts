// Lo que hace el editor de permisos (#423), sin React: buscar, «Seleccionar
// todo» por sección y los avisos de dependencias. Aparte para poder probarlo.
import { casaPorTrozos } from '@/shared/lib/buscarPorTrozos';
import type { PermissionMap } from '@/shared/hooks/usePermission';
import type { AccionDelCatalogo, Catalogo, SeccionDelCatalogo } from '../api/permissions.api';

/** Todas las acciones del catálogo, planas. */
export function accionesDe(catalogo: Catalogo): AccionDelCatalogo[] {
  return catalogo.secciones.flatMap((s) => s.recursos.flatMap((r) => r.acciones));
}

/** El nombre que se lee de una clave: «Prospectos · Ver prospectos». */
export function nombreDe(catalogo: Catalogo, clave: string): string {
  for (const s of catalogo.secciones) for (const r of s.recursos) {
    const a = r.acciones.find((x) => x.clave === clave);
    if (a) return a.nombre;
  }
  return clave;
}

/**
 * El catálogo con solo lo que casa con lo escrito: por el nombre o la frase
 * del permiso, por el de su pantalla o su sección, o por la clave. Sin
 * acentos y por trozos («fact emit» encuentra «Emitir desde la cola» de
 * Facturación). Lo que se queda sin nada desaparece.
 */
export function filtrar(catalogo: Catalogo, texto: string): SeccionDelCatalogo[] {
  if (!texto.trim()) return catalogo.secciones;
  return catalogo.secciones
    .map((s) => ({
      ...s,
      recursos: s.recursos
        .map((r) => ({
          ...r,
          acciones: r.acciones.filter((a) => casaPorTrozos(texto, a.nombre, a.descripcion, r.nombre, s.nombre, a.clave)),
        }))
        .filter((r) => r.acciones.length > 0),
    }))
    .filter((s) => s.recursos.length > 0);
}

export const clavesDeSeccion = (s: SeccionDelCatalogo) => s.recursos.flatMap((r) => r.acciones.map((a) => a.clave));

/** Cómo está una sección: todas marcadas, ninguna o unas sí y otras no. */
export function estadoDe(claves: string[], valores: PermissionMap): 'todas' | 'ninguna' | 'parcial' {
  const n = claves.filter((k) => valores[k] === true).length;
  if (n === 0) return 'ninguna';
  return n === claves.length ? 'todas' : 'parcial';
}

/** Marca o desmarca todas estas claves, menos las que no se pueden tocar. */
export function marcarTodas(valores: PermissionMap, claves: string[], marcada: boolean, bloqueadas: string[] = []): PermissionMap {
  const out = { ...valores };
  for (const k of claves) if (!bloqueadas.includes(k)) out[k] = marcada;
  return out;
}

export interface AvisoDeDependencia { clave: string; nombre: string; faltan: { clave: string; nombre: string }[] }

/**
 * Lo marcado que necesita algo que no está marcado: «Editar prospectos» sin
 * «Ver prospectos». No se arregla solo —quien edita decide—, se avisa.
 */
export function avisosDeDependencias(catalogo: Catalogo, valores: PermissionMap): AvisoDeDependencia[] {
  return accionesDe(catalogo)
    .filter((a) => valores[a.clave] === true)
    .map((a) => ({
      clave: a.clave,
      nombre: a.nombre,
      faltan: a.requiere.filter((r) => valores[r] !== true).map((r) => ({ clave: r, nombre: nombreDe(catalogo, r) })),
    }))
    .filter((x) => x.faltan.length > 0);
}

/** Las claves que han cambiado respecto a como estaban. */
export function cambiadas(original: PermissionMap, valores: PermissionMap): string[] {
  const todas = new Set([...Object.keys(original), ...Object.keys(valores)]);
  return [...todas].filter((k) => (original[k] === true) !== (valores[k] === true));
}
