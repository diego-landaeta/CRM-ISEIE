// Los filtros de Ventas y de Análisis viven en la dirección (#1194): se
// conservan al recargar, al volver atrás desde una venta y al pasar el enlace.
//
// Lo que llega por la dirección lo escribe cualquiera: un valor que no se
// entiende se IGNORA (se usa el de siempre) y la pantalla no se rompe. El
// servidor vuelve a validarlo con Zod, y la gestora la sigue recortando el
// alcance de la sesión: la dirección solo elige entre lo que ya se puede ver.

export type Reparto = 'todas' | 'solo' | 'enteras';
const REPARTOS: readonly Reparto[] = ['todas', 'solo', 'enteras'];

/** «solo» o «enteras»; cualquier otra cosa, «todas». */
export function repartoDeUrl(valor: unknown): Reparto {
  return REPARTOS.includes(valor as Reparto) ? (valor as Reparto) : 'todas';
}

/** Una fecha AAAA-MM-DD que existe de verdad; si no, ''. */
export function fechaDeUrl(valor: unknown): string {
  const s = String(valor ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T00:00:00Z`);
  // «2026-02-31» pasa el patrón pero no existe: Date lo corre al 3 de marzo.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}

/** Un entero positivo (un id, una página); si no, null. */
export function enteroDeUrl(valor: unknown): number | null {
  const s = String(valor ?? '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
