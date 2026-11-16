/**
 * El país de entrada de un prospecto (#221), para enseñarlo.
 *
 * El CRM guarda solo el código ISO de dos letras (`CL`, `MX`): el nombre lo pone
 * el navegador con `Intl.DisplayNames`, así que un país nuevo en la tabla de un
 * campus sale con su nombre sin tocar código. La regla que lo deduce vive en el
 * servidor (`backend/src/modules/leads/pais.js`).
 */

/** Valor del filtro para los prospectos sin país de entrada. */
export const SIN_PAIS = 'sin_pais';

let nombres: Intl.DisplayNames | null = null;
try {
  nombres = new Intl.DisplayNames(['es'], { type: 'region' });
} catch {
  nombres = null;
}

/** «Chile» de `CL`. Sin código, cadena vacía; si el navegador no lo sabe, el código. */
export function nombreDelPais(codigo?: string | null): string {
  if (!codigo) return '';
  if (codigo === SIN_PAIS) return 'Sin país';
  try {
    return nombres?.of(codigo.toUpperCase()) || codigo.toUpperCase();
  } catch {
    return codigo.toUpperCase();
  }
}

/** «Fono Aprende · Chile»; sin país, solo el campus. */
export function etiquetaCampusPais(campus?: string | null, codigo?: string | null): string {
  const pais = nombreDelPais(codigo);
  if (!campus) return pais;
  return pais ? `${campus} · ${pais}` : campus;
}

type ConPaises = { paises_por_subdominio?: Record<string, string> | null };

/** Los códigos que tienen configurados estos campus, sin repetir y por nombre. */
export function paisesConfigurados(proyectos: ConPaises[] | null | undefined): string[] {
  const codigos = new Set<string>();
  for (const p of proyectos || []) {
    for (const c of Object.values(p?.paises_por_subdominio || {})) {
      if (typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)) codigos.add(c.toUpperCase());
    }
  }
  return [...codigos].sort((a, b) => nombreDelPais(a).localeCompare(nombreDelPais(b), 'es'));
}

/** Las opciones del selector: los países configurados y, al final, «Sin país». */
export function opcionesDePais(proyectos: ConPaises[] | null | undefined): Array<{ valor: string; etiqueta: string }> {
  const lista = paisesConfigurados(proyectos).map((c) => ({ valor: c, etiqueta: nombreDelPais(c) }));
  return lista.length ? [...lista, { valor: SIN_PAIS, etiqueta: 'Sin país' }] : [];
}
