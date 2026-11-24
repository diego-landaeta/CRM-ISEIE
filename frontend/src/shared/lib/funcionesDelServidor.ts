import { useAuth } from '@/contexts/AuthContext';
import { SOLO_EN_PRUEBAS } from './enPruebas';

/**
 * ¿El SERVIDOR tiene encendida esta función? Lo dice `/auth/me` en
 * `user.funciones` (links_pago, plugin_moodle, monitask…), que sale de los
 * interruptores del `.env`. Encender o apagar es tocar el `.env` y reiniciar la
 * API, sin recompilar el frontal.
 *
 * Si el servidor es anterior y no manda esa clave, como estaba: solo en pruebas.
 */
export function funcionEncendida(user: unknown, clave: string): boolean {
  const valor = (user as { funciones?: Record<string, unknown> } | null | undefined)?.funciones?.[clave];
  return typeof valor === 'boolean' ? valor : SOLO_EN_PRUEBAS;
}

export function useFuncionEncendida(clave: string): boolean {
  const { user } = useAuth();
  return funcionEncendida(user, clave);
}
