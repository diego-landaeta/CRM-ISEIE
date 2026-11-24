#!/usr/bin/env node
/*
  PUBLICAR UNA VERSIÓN DEL PLUGIN DEL CRM PARA MOODLE (#679)

  Empaqueta el plugin (`crm/`), calcula su huella (SHA-256) y la FIRMA con la clave privada
  del CRM. Deja en `PLUGIN_MOODLE_DIR` (por defecto `backend/plugin-moodle/`) el ZIP y
  `manifiesto.json`, que es lo que sirve `/api/moodle-avisos/plugin/ultima`.
  Cada campus lo comprueba a diario y solo instala lo que trae una firma válida.

  El plugin vive en molinangel/Campus-Moodle, carpeta `local_crm` (#1037): en el CRM no
  hay copia. Se publica desde un clon de ese repo:

    PLUGIN_MOODLE_ORIGEN=/ruta/a/Campus-Moodle/local_crm npm run plugin:publicar
    npm run plugin:publicar -- /ruta/a/Campus-Moodle/local_crm      (lo mismo)

  Variables:
    PLUGIN_FIRMA_CLAVE_ARCHIVO  ruta a la clave PRIVADA (PEM, RSA). Nunca en el repo.
    PLUGIN_MOODLE_ORIGEN        la carpeta `local_crm` de Campus-Moodle. Sin ella, se usa
                                `tools/moodle-local-crm` si alguien ha traído ahí el plugin
                                (origen-plugin-moodle.mjs).
    PLUGIN_MOODLE_DIR           dónde dejar el ZIP y el manifiesto (opcional).

  La clave pública que la comprueba va dentro del plugin (`classes/claves.php`).
  Generar un par nuevo:
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out privada.pem
    openssl pkey -in privada.pem -pubout -out publica.pem
*/
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { origenDelPlugin } from './origen-plugin-moodle.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const destino = path.resolve(process.env.PLUGIN_MOODLE_DIR || path.resolve(aqui, '../plugin-moodle'));

function salir(mensaje) { console.error(`✖ ${mensaje}`); process.exit(1); }

const archivoClave = process.env.PLUGIN_FIRMA_CLAVE_ARCHIVO;
if (!archivoClave || !fs.existsSync(archivoClave)) salir('Falta PLUGIN_FIRMA_CLAVE_ARCHIVO (la clave privada del CRM para firmar el plugin).');

const pedido = process.argv[2] || process.env.PLUGIN_MOODLE_ORIGEN;
const origen = origenDelPlugin({ origen: pedido, carpetaDelCrm: path.resolve(aqui, '../../tools/moodle-local-crm') });
if (origen.error) salir(origen.error);
const raizPlugin = origen.dir;
// Para saber después qué se firmó: la carpeta y, si es un clon de Campus-Moodle, su commit
// y si lleva cambios sin commit (solo en pantalla; el manifiesto no cambia).
let commit = '';
if (pedido) {
  try {
    const git = (...a) => execFileSync('git', ['-C', raizPlugin, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    commit = git('log', '-1', '--format=%h %cs');
    if (git('status', '--porcelain', '--', '.')) commit += ', con cambios sin commit';
  } catch { /* no es un clon de git: no pasa nada */ }
}
console.log(`Plugin de ${raizPlugin}${commit ? ` (commit ${commit})` : ''}`);

const versionPhp = fs.readFileSync(path.join(raizPlugin, 'crm/version.php'), 'utf8');
const version = Number(/\$plugin->version\s*=\s*(\d+)/.exec(versionPhp)?.[1]);
const release = /\$plugin->release\s*=\s*'([^']+)'/.exec(versionPhp)?.[1];
const requires = Number(/\$plugin->requires\s*=\s*(\d+)/.exec(versionPhp)?.[1]) || null;
if (!version || !release) salir('No se ha podido leer la versión de crm/version.php.');

// El ZIP, con el mismo empaquetador que se usa a mano (raíz «crm», ZIP de verdad).
// Se niega si el plugin lleva la clave pública de PRUEBAS LOCALES (salvo PERMITIR_CLAVE_PRUEBAS=1):
// el motivo lo dice él mismo, aquí solo se sale sin la traza de Node.
try {
  execFileSync('bash', ['empaquetar.sh'], { cwd: raizPlugin, stdio: 'inherit' });
} catch {
  salir('empaquetar.sh no ha generado el ZIP (el motivo, justo encima).');
}
const zipOrigen = path.join(raizPlugin, `local_crm-${release}.zip`);
if (!fs.existsSync(zipOrigen)) salir(`No se ha generado ${zipOrigen}.`);
const zip = fs.readFileSync(zipOrigen);
if (zip.subarray(0, 2).toString() !== 'PK') salir('El paquete no es un ZIP.');

const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
// Lo que se firma: componente, versión y huella. El plugin lo recompone y lo comprueba.
const mensaje = `local_crm|${version}|${sha256}`;
const firma = crypto.sign('sha256', Buffer.from(mensaje), fs.readFileSync(archivoClave)).toString('base64');

fs.mkdirSync(destino, { recursive: true });
const archivo = 'local_crm.zip';
fs.writeFileSync(path.join(destino, archivo), zip);
const manifiesto = { componente: 'local_crm', version, release, requires, sha256, firma, archivo, publicado: new Date().toISOString() };
fs.writeFileSync(path.join(destino, 'manifiesto.json'), `${JSON.stringify(manifiesto, null, 2)}\n`);
fs.unlinkSync(zipOrigen);
console.log(`✔ local_crm ${release} (${version}) publicado en ${destino}`);
console.log(`  sha256 ${sha256}`);
