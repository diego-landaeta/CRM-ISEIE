import { alcanceComercial } from '../../shared/utils/roles.js';

/**
 * Qué facturas ve cada persona: el recorte POR PERSONA (el de campus va aparte).
 *
 * Diego, 19/11/2026: «las gestoras y admin que tienen acceso a facturación tienen
 * que ver TODAS las facturas, no solo las suyas». Acceso a facturación es «Poner
 * número al cobrar» (`facturas.emitir`), lo que abre la entrada Facturación del
 * menú: con él, ninguna persona fuera (null). Sin él, el recorte de siempre
 * (`base`, por defecto el alcance comercial).
 */
export async function tieneAccesoFacturacion(user) {
  const id = Number(user?.userId ?? user?.id);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    const { explicarPermisos } = await import('../permissions/permissions.service.js');
    const e = await explicarPermisos(id);
    return e?.mapa?.['facturas.emitir'] === true;
  } catch { return false; }   // sin poder leer los permisos, el recorte de siempre
}

export async function alcanceDeFacturas(user, base = alcanceComercial) {
  if (await tieneAccesoFacturacion(user)) return null;
  return base(user);
}
