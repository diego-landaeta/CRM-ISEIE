// La versión del CRM que se enseña (menú, login, contraseña, manual, Soporte).
//
// Una sola fuente: la primera versión de Novedades
// (`backend/src/modules/novedades/versiones.js`, `ACTUAL.version`). La pone Vite
// al compilar con `define` (`scripts/versionDeLaApp.js`); no se escribe a mano
// en ninguna pantalla. Diego, 25/11/2026: «el CRM dice 1.0.0, ya no estamos en
// beta». Sin «Beta» al lado.
export const VERSION_APP: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

/** «v3.0.0», o vacío si no hay versión. */
export const ETIQUETA_VERSION: string = VERSION_APP ? `v${VERSION_APP}` : '';
