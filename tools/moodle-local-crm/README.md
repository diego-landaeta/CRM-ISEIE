# local_crm · el plugin del CRM para Moodle — vive en Campus-Moodle

**El plugin ya no está en este repo.** Desde #1037 hay una sola copia, la que manda: la
carpeta [`local_crm/`](https://github.com/molinangel/Campus-Moodle/tree/main/local_crm) del
repo **molinangel/Campus-Moodle**. Allí están el código, `empaquetar.sh`, las pruebas en
Docker, el historial de versiones y, en el README del repo, la versión instalada en cada
campus.

Aquí había una copia de la **1.10.9**, idéntica archivo por archivo al commit `3d2712a` de
Campus-Moodle, mientras los campus ya iban por la 1.11.x. Dos copias que se separan acaban
en que se arregla o se publica la que no es.

## Qué queda en el CRM

Lo que es del CRM, no del plugin:

- `backend/src/modules/consultas/` (`consultas.plugin.js`, `consultas.webhook.js`): los
  avisos de cada campus (`/api/moodle-avisos`), los códigos de «Conectar campus» y lo que se
  sirve en `/api/moodle-avisos/plugin/ultima`.
- `backend/scripts/publicar-plugin-moodle.mjs` (`npm run plugin:publicar`): firma una
  versión con la clave privada del CRM.

## Publicar una versión firmada (en el servidor del CRM)

1. En Campus-Moodle, la versión está fusionada en `main`, con `version` y `release`
   subidos en `crm/version.php`.
2. En el servidor, un clon de Campus-Moodle al día:

   ```bash
   git clone git@github.com:molinangel/Campus-Moodle.git   # la primera vez
   git -C Campus-Moodle pull                                # las siguientes
   ```

3. Desde `backend/` del CRM, con `PLUGIN_FIRMA_CLAVE_ARCHIVO` apuntando a la clave privada,
   como siempre:

   ```bash
   PLUGIN_MOODLE_ORIGEN=/ruta/a/Campus-Moodle/local_crm npm run plugin:publicar
   # o: npm run plugin:publicar -- /ruta/a/Campus-Moodle/local_crm
   ```

   Dice de qué carpeta y de qué commit sale lo que firma (y si lleva cambios sin commit), y
   deja el ZIP firmado y `manifiesto.json` en `backend/plugin-moodle/` (o
   `PLUGIN_MOODLE_DIR`).

Si `PLUGIN_MOODLE_ORIGEN` no apunta a la carpeta del plugin (con `crm/version.php` y
`empaquetar.sh`), el script se para y no publica nada. Sin `PLUGIN_MOODLE_ORIGEN`, usa esta
carpeta si alguien ha copiado aquí el contenido de `local_crm/` de Campus-Moodle: el
`.gitignore` lo deja fuera del repo, así que no vuelve a haber dos copias.
