import { useAuth } from '@/contexts/AuthContext';
import { SOLO_EN_PRUEBAS } from './enPruebas';

/**
 * El plugin del CRM en cada Moodle (#406, gemela de MultiCRM #679): el bloque «Plugin del CRM» de
 * Integraciones › Campus (Moodle) —conectar un campus con un código, ver si avisa,
 * desconectarlo—, poner la nota desde el CRM y responder por el plugin.
 *
 * Es el espejo de PLUGIN_MOODLE_EN_PRODUCCION del servidor: sin aprobar, allí ni
 * siquiera existen las rutas que llaman estas pantallas.
 *
 * Antes era una constante de compilación (SOLO_EN_PRUEBAS) y, para encenderlo en
 * producción, había que cambiar el código y recompilar el frontal. Ahora lo dice el
 * servidor (#517, gemela de MultiCRM #850): `/auth/me` manda
 * `user.funciones.plugin_moodle`, que es lo mismo que
 * deciden sus rutas (`pluginMoodleActivo()`). Basta con PLUGIN_MOODLE_EN_PRODUCCION=1
 * en el `.env` de producción y reiniciar la API.
 *
 * En /staging y en local sigue encendido de entrada, sin esperar a `/auth/me`. En
 * producción (crm.iseie.com), mientras el servidor no diga que sí, apagado: como hasta ahora.
 */
export const PLUGIN_MOODLE_AL_COMPILAR: boolean = SOLO_EN_PRUEBAS;

/** Encendido en /staging y en local, o si el servidor lo tiene aprobado. */
export function pluginMoodleEncendido(delServidor?: boolean | null): boolean {
  return PLUGIN_MOODLE_AL_COMPILAR || delServidor === true;
}

/**
 * El interruptor, para una pantalla: lee `user.funciones.plugin_moodle` de la sesión. Sin
 * sesión todavía (o un servidor anterior a la #850, que no lo manda), lo que se sabe
 * al compilar, que es lo que valía antes.
 */
export function usePluginMoodle(): boolean {
  const { user } = useAuth() as { user?: { funciones?: { plugin_moodle?: boolean | null } | null } | null };
  return pluginMoodleEncendido(user?.funciones?.plugin_moodle);
}
