/*
  DE DÓNDE SALE EL PLUGIN QUE SE PUBLICA (#1037)

  Desde el 24/11/2026 el plugin `local_crm` vive en UN solo sitio: la carpeta `local_crm/`
  del repo molinangel/Campus-Moodle. En el CRM ya no hay copia (`tools/moodle-local-crm`
  solo guarda un README con el enlace), así que `npm run plugin:publicar` tiene que saber
  dónde está:

    1. `PLUGIN_MOODLE_ORIGEN` (o el primer argumento): la carpeta `local_crm` de un clon de
       Campus-Moodle. Si se da y no es esa carpeta, se para: nunca se publica otra cosa
       en su lugar.
    2. Si no se da: `tools/moodle-local-crm`, por si alguien ha traído ahí la versión a
       publicar (está en el .gitignore, no se versiona).

  Es «la carpeta del plugin» la que tiene `crm/version.php` y `empaquetar.sh`.
*/
import fs from 'node:fs';
import path from 'node:path';

export const REPO_DEL_PLUGIN = 'molinangel/Campus-Moodle';

export function esCarpetaDelPlugin(dir) {
  return Boolean(dir)
    && fs.existsSync(path.join(dir, 'crm', 'version.php'))
    && fs.existsSync(path.join(dir, 'empaquetar.sh'));
}

/**
 * @param {{ origen?: string, carpetaDelCrm: string }} opciones
 *   origen: lo que se ha pedido (PLUGIN_MOODLE_ORIGEN o el argumento); carpetaDelCrm:
 *   `tools/moodle-local-crm` del repo.
 * @returns {{ dir: string } | { error: string }}
 */
export function origenDelPlugin({ origen, carpetaDelCrm }) {
  if (origen && origen.trim()) {
    const dir = path.resolve(origen.trim());
    if (esCarpetaDelPlugin(dir)) return { dir };
    return {
      error: `${dir} no es la carpeta del plugin: falta crm/version.php o empaquetar.sh. `
        + `Tiene que ser la carpeta local_crm de un clon de ${REPO_DEL_PLUGIN}.`,
    };
  }
  if (esCarpetaDelPlugin(carpetaDelCrm)) return { dir: carpetaDelCrm };
  return {
    error: `No hay plugin que publicar. El plugin vive en ${REPO_DEL_PLUGIN} (carpeta local_crm). `
      + 'Clónalo (o haz git pull en la rama que se publica) y repite con '
      + 'PLUGIN_MOODLE_ORIGEN=/ruta/a/Campus-Moodle/local_crm npm run plugin:publicar',
  };
}
