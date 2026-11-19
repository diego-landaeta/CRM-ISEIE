import { useAuth } from '@/contexts/AuthContext';
import { SOLO_EN_PRUEBAS } from './enPruebas';

/**
 * ¿Se ven los links de pago (#407, gemela de CRM#680)? Lo decide el SERVIDOR, no la compilación.
 *
 * Antes iban detrás de `SOLO_EN_PRUEBAS`: en producción no salían nunca, aunque el
 * servidor tuviera los links encendidos. Ahora `/auth/me` dice si el servidor los
 * tiene encendidos (`user.funciones.links_pago`, que sale de
 * `LINKS_PAGO_EN_PRODUCCION` en producción y vale «sí» en /staging y en local).
 * Encenderlos o apagarlos en producción es tocar el `.env` y reiniciar la API,
 * sin volver a compilar el frontal.
 *
 * Esto solo dice si el servidor los tiene; quién los usa lo dicen después los
 * permisos `links_pago.*` (crear, ver todos, configurar).
 *
 * Si el servidor es anterior y no lo manda, se queda como estaba: solo en pruebas.
 */
export function linksPagoEncendidos(user: unknown): boolean {
  const valor = (user as { funciones?: { links_pago?: unknown } } | null | undefined)?.funciones?.links_pago;
  return typeof valor === 'boolean' ? valor : SOLO_EN_PRUEBAS;
}

export function useLinksPagoEncendidos(): boolean {
  const { user } = useAuth();
  return linksPagoEncendidos(user);
}
