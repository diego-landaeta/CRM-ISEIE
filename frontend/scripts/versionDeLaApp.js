// La versión que enseña el CRM, sacada de Git al compilar (11/11/2026).
//
// POR QUÉ. El menú decía «BETA 2.2.0» con producción en la v2.5.24. El número
// estaba escrito a mano en `betaConfig.ts` (`BETA_VERSION`) y nadie lo cambiaba
// al sacar una versión: se quedó en la 2.2.0 del 16/10 en `main` y en la 2.6.0
// en `staging`. Las versiones ya tienen su sitio —la etiqueta `vX.Y.Z` en `main`
// y el título del pull request de la versión, «v2.5.24 · …»—; de ahí sale.
//
// QUÉ NÚMERO. El más alto entre:
//   · las etiquetas `vX.Y.Z` del repositorio, y
//   · el título del último commit si empieza por «vX.Y.Z ·» (la fusión de la
//     versión, que se compila antes de poner la etiqueta).
// Si no hay Git ni etiquetas (una copia sin historia), la `version` del
// `package.json`. Y si se quiere forzar uno, APP_VERSION en el entorno.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** a > b → positivo; a < b → negativo. */
export function compararVersiones(a, b) {
  const pa = SEMVER.exec(a).slice(1).map(Number);
  const pb = SEMVER.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** La versión más alta de una lista de etiquetas y del título del último commit. */
export function versionMasAlta({ etiquetas = [], asunto = '' } = {}) {
  const candidatas = etiquetas.map((t) => String(t).trim()).filter((t) => SEMVER.test(t));
  const m = /^v(\d+\.\d+\.\d+)\s*·/.exec(String(asunto || '').trim());
  if (m) candidatas.push(m[1]);
  if (!candidatas.length) return null;
  return candidatas.sort(compararVersiones).at(-1).replace(/^v/, '');
}

function gitPorDefecto(cwd) {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

export function versionDeLaApp({ cwd = process.cwd(), env = process.env, git = gitPorDefecto(cwd) } = {}) {
  const forzada = String(env.APP_VERSION || '').trim().replace(/^v/, '');
  if (SEMVER.test(forzada)) return forzada;
  try {
    const etiquetas = git(['tag', '--list', 'v[0-9]*']).split(/\r?\n/);
    const asunto = git(['log', '-1', '--format=%s']);
    const v = versionMasAlta({ etiquetas, asunto });
    if (v) return v;
  } catch { /* sin Git: al paquete */ }
  try {
    const paquete = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return String(paquete.version || '').replace(/^v/, '');
  } catch {
    return '';
  }
}
