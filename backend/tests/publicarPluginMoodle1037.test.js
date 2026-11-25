import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { origenDelPlugin, esCarpetaDelPlugin, REPO_DEL_PLUGIN } from '../scripts/origen-plugin-moodle.mjs';

/**
 * #1037: el plugin `local_crm` vive solo en molinangel/Campus-Moodle y en el CRM no hay copia.
 * `npm run plugin:publicar` tiene que seguir firmando una versión, ahora desde la carpeta
 * `local_crm` de un clon de Campus-Moodle (PLUGIN_MOODLE_ORIGEN), y pararse si no la encuentra
 * en vez de publicar otra cosa.
 *
 * El plugin de mentira trae un `empaquetar.sh` que solo escribe un «ZIP» que empieza por PK:
 * aquí se prueba el script del CRM (origen, versión, firma y manifiesto), no el empaquetador,
 * que es de Campus-Moodle.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(aqui, '../scripts/publicar-plugin-moodle.mjs');

let tmp;
function pluginDeMentira(dir, { release = '9.8.7', version = 2099010100 } = {}) {
  fs.mkdirSync(path.join(dir, 'crm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'crm', 'version.php'), [
    '<?php',
    "$plugin->component = 'local_crm';",
    `$plugin->version   = ${version};`,
    '$plugin->requires  = 2024042200;',
    `$plugin->release   = '${release}';`,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'empaquetar.sh'), [
    '#!/bin/sh',
    'set -e',
    'cd "$(dirname "$0")"',
    `printf 'PK\\003\\004plugin-de-prueba' > local_crm-${release}.zip`,
    '',
  ].join('\n'));
  return dir;
}

// Lo justo para que no herede un PLUGIN_* del entorno de quien lanza los tests.
function entorno(env) {
  const base = { PATH: process.env.PATH, PLUGIN_MOODLE_ORIGEN: '' };
  if (process.env.SYSTEMROOT) base.SYSTEMROOT = process.env.SYSTEMROOT;
  return { ...base, ...env };
}

function publicar(env, argumentos = []) {
  return spawnSync(process.execPath, [SCRIPT, ...argumentos], { encoding: 'utf8', env: entorno(env) });
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-1037-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(tmp, 'privada.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(tmp, 'publica.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('#1037 · de dónde sale el plugin', () => {
  it('con PLUGIN_MOODLE_ORIGEN en la carpeta local_crm, esa', () => {
    const dir = pluginDeMentira(path.join(tmp, 'Campus-Moodle', 'local_crm'));
    expect(origenDelPlugin({ origen: dir, carpetaDelCrm: path.join(tmp, 'vacia') })).toEqual({ dir });
  });

  it('lo pedido manda aunque haya una copia en tools/moodle-local-crm', () => {
    const pedido = pluginDeMentira(path.join(tmp, 'pedido'));
    const copia = pluginDeMentira(path.join(tmp, 'copia-en-el-crm'));
    expect(origenDelPlugin({ origen: pedido, carpetaDelCrm: copia })).toEqual({ dir: pedido });
  });

  it('si lo pedido no es la carpeta del plugin, se para: no cae en la copia del CRM', () => {
    const copia = pluginDeMentira(path.join(tmp, 'copia-2'));
    const r = origenDelPlugin({ origen: path.join(tmp, 'Campus-Moodle'), carpetaDelCrm: copia });
    expect(r.dir).toBeUndefined();
    expect(r.error).toMatch(/no es la carpeta del plugin/);
  });

  it('sin pedir nada, la copia traída a tools/moodle-local-crm', () => {
    const copia = pluginDeMentira(path.join(tmp, 'copia-3'));
    expect(origenDelPlugin({ origen: '', carpetaDelCrm: copia })).toEqual({ dir: copia });
  });

  it('sin pedir nada y sin copia, dice dónde está el plugin y cómo publicarlo', () => {
    const r = origenDelPlugin({ origen: undefined, carpetaDelCrm: path.join(tmp, 'solo-readme') });
    expect(r.error).toContain(REPO_DEL_PLUGIN);
    expect(r.error).toContain('PLUGIN_MOODLE_ORIGEN=');
  });

  it('en el repo, tools/moodle-local-crm ya no lleva el plugin, solo el README que apunta a Campus-Moodle', () => {
    const carpeta = path.resolve(aqui, '../../tools/moodle-local-crm');
    const readme = fs.readFileSync(path.join(carpeta, 'README.md'), 'utf8');
    expect(readme).toContain(REPO_DEL_PLUGIN);
    expect(readme).toContain('PLUGIN_MOODLE_ORIGEN=');
    // Y si alguien trae aquí una copia para publicar, git no la recoge.
    const ignorar = fs.readFileSync(path.join(carpeta, '.gitignore'), 'utf8');
    expect(ignorar).toMatch(/^\/\*$/m);
    expect(ignorar).toMatch(/^!\/README\.md$/m);
  });

  it('esCarpetaDelPlugin pide crm/version.php y empaquetar.sh', () => {
    const dir = path.join(tmp, 'a-medias');
    fs.mkdirSync(path.join(dir, 'crm'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'crm', 'version.php'), '<?php');
    expect(esCarpetaDelPlugin(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, 'empaquetar.sh'), '#!/bin/sh');
    expect(esCarpetaDelPlugin(dir)).toBe(true);
    expect(esCarpetaDelPlugin(undefined)).toBe(false);
  });
});

describe('#1037 · npm run plugin:publicar desde Campus-Moodle', () => {
  it('firma la versión de la carpeta pedida y deja ZIP y manifiesto que la firma valida', () => {
    const origen = pluginDeMentira(path.join(tmp, 'cm-publicar', 'local_crm'), { release: '1.11.4', version: 2026112400 });
    const destino = path.join(tmp, 'plugin-moodle');
    const r = publicar({
      PLUGIN_MOODLE_ORIGEN: origen,
      PLUGIN_FIRMA_CLAVE_ARCHIVO: path.join(tmp, 'privada.pem'),
      PLUGIN_MOODLE_DIR: destino,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Plugin de ${origen}`);
    expect(r.stdout).toContain('local_crm 1.11.4 (2026112400) publicado');

    const manifiesto = JSON.parse(fs.readFileSync(path.join(destino, 'manifiesto.json'), 'utf8'));
    expect(manifiesto).toMatchObject({
      componente: 'local_crm', version: 2026112400, release: '1.11.4', requires: 2024042200, archivo: 'local_crm.zip',
    });
    const zip = fs.readFileSync(path.join(destino, 'local_crm.zip'));
    const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
    expect(manifiesto.sha256).toBe(sha256);
    // Lo mismo que comprueba el plugin en el campus: componente|versión|huella.
    const valida = crypto.verify(
      'sha256',
      Buffer.from(`local_crm|2026112400|${sha256}`),
      fs.readFileSync(path.join(tmp, 'publica.pem')),
      Buffer.from(manifiesto.firma, 'base64'),
    );
    expect(valida).toBe(true);
    // El ZIP de trabajo no se queda en el clon de Campus-Moodle.
    expect(fs.existsSync(path.join(origen, 'local_crm-1.11.4.zip'))).toBe(false);
  });

  it('con PLUGIN_MOODLE_ORIGEN equivocado no publica nada', () => {
    const destino = path.join(tmp, 'plugin-moodle-no');
    const r = publicar({
      PLUGIN_MOODLE_ORIGEN: path.join(tmp, 'no-existe'),
      PLUGIN_FIRMA_CLAVE_ARCHIVO: path.join(tmp, 'privada.pem'),
      PLUGIN_MOODLE_DIR: destino,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no es la carpeta del plugin/);
    expect(fs.existsSync(destino)).toBe(false);
  });

  it('el argumento hace lo mismo que PLUGIN_MOODLE_ORIGEN', () => {
    const origen = pluginDeMentira(path.join(tmp, 'cm-argumento', 'local_crm'), { release: '1.11.5', version: 2026112401 });
    const destino = path.join(tmp, 'plugin-moodle-arg');
    const r = publicar({
      PLUGIN_FIRMA_CLAVE_ARCHIVO: path.join(tmp, 'privada.pem'),
      PLUGIN_MOODLE_DIR: destino,
    }, [origen]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(destino, 'manifiesto.json'), 'utf8')).release).toBe('1.11.5');
  });
});
