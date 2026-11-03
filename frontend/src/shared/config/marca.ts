/**
 * El nombre del CRM, tal como lo ve quien lo usa (#367).
 *
 * Estaba escrito a mano en siete sitios (la cabecera, la pestaña, el acceso, la
 * contraseña, el aviso para instalarlo, el chat y el manual) y decía «MultiCRM»,
 * que era el nombre del proyecto y no la marca. Aquí se cambia una vez.
 *
 * Es lo ÚNICO que cambia entre los dos CRM: en uno «360 CRM» y en el otro «CRM ISEIE».
 * `index.html` y `public/manifest.webmanifest` no pueden importar nada y llevan
 * el nombre escrito; una prueba comprueba que dicen lo mismo que esta constante.
 */
export const MARCA = 'CRM ISEIE';
