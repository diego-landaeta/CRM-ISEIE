// Los permisos de serie de cada rol fijo y la lista de recursos.
//
// Desde #423 no es una tabla escrita a mano: sale del catálogo
// (`catalogo.js`), que es el único sitio donde se registra un permiso. Los
// nombres se quedan porque los importan varios módulos.
//
// `superadmin: null` = acceso total, se resuelve antes de mirar esto.
import { valoresPorDefecto, recursos } from './catalogo.js';

export const SYSTEM_ROLE_DEFAULTS = valoresPorDefecto();

export const ALL_RESOURCES = recursos();
