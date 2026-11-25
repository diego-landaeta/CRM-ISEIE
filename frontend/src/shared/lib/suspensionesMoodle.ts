import { useAuth } from '@/contexts/AuthContext';
import { SOLO_EN_PRUEBAS } from './enPruebas';

/**
 * Las suspensiones de Moodle en el CRM (gemela de MultiCRM #531): el filtro «Suspendidos en Moodle» de
 * Clientes. Es el espejo de SUSPENSIONES_MOODLE_EN_PRODUCCION del servidor, como
 * `pluginMoodle.ts`: `/auth/me` manda `user.funciones.suspensiones_moodle`. Sin sesión
 * todavía (o con un servidor anterior), lo que se sabe al compilar: en /staging y en local,
 * encendido; en producción (crm.iseie.com), apagado.
 *
 * La ficha no lo necesita: su endpoint ya contesta `disponible: false` si está apagado.
 */
export function suspensionesMoodleEncendidas(delServidor?: boolean | null): boolean {
  if (delServidor === true || delServidor === false) return delServidor;
  return SOLO_EN_PRUEBAS;
}

export function useSuspensionesMoodleEncendidas(): boolean {
  const { user } = useAuth() as { user?: { funciones?: { suspensiones_moodle?: boolean | null } | null } | null };
  return suspensionesMoodleEncendidas(user?.funciones?.suspensiones_moodle);
}
