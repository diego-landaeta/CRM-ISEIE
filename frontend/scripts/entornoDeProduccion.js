// El build de producción se para si le falta su configuración.
//
// POR QUÉ (Diego, 22/10/2026: «¿por qué en ISEIE dejaron de aparecer los
// ranking de las gestoras para los admin?»). No lo quitó ningún commit ni
// ninguna fusión: el código del ranking no cambió entre la 2.2.15 y la 2.2.17.
// Lo quitó el BUILD. `frontend/.env.production` no está en git (lo ignora el
// .gitignore) y solo vivía en el clon principal. El 22/10 los frontales de
// producción se compilaron en worktrees (`wt-prod-iseie`, `wt-prod-360`), que no
// lo tienen, y Vite compiló sin decir nada con todo apagado:
//   · ISEIE: VITE_PROCESO_EN_PRUEBAS sin poner → `PROCESO_EN_PRUEBAS` = false →
//     fuera «Cómo voy» (el podio y el ranking de gestoras) del Dashboard,
//     Prospectos y Clientes, y con él todo lo del proceso aprobado el 29/09
//     (pestaña Proceso, agenda, Seguimiento de fin de mes, Feedback, Novedades…).
//   · Los dos CRM: VITE_BETA_MODE sin poner → el menú dejó de marcar como
//     «Próximamente» lo que no está abierto en producción.
// Un build al que le falta la configuración no puede salir en silencio.
//
// LA LISTA de lo obligatorio es `.env.production.example`, que sí está en git:
// toda variable que aparece allí tiene que estar definida (en `.env.production`,
// `.env.production.local`, `.env`, `.env.local` o en el entorno), aunque sea
// vacía. Lo que vale cada una no se comprueba: eso lo decide Diego.
//
// Solo mira `vite build` en modo production. Los de staging (`--mode staging`)
// usan su `.env.staging`, que sí está en git, y `npm run dev` y las pruebas no
// pasan por aquí. En la CI (CI=true) solo avisa: allí se compila para ver que
// compila, no para publicar.
import fs from 'node:fs';
import path from 'node:path';

const FICHEROS = ['.env', '.env.local', '.env.production', '.env.production.local'];

/** Las claves (`VITE_X=`) de un fichero .env. Las líneas comentadas no cuentan. */
export function clavesDe(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/))
    .filter(Boolean)
    .map((m) => m[1]);
}

function leer(ruta) {
  try { return fs.readFileSync(ruta, 'utf8'); } catch { return null; }
}

/**
 * Lanza un error si es un build de producción y falta alguna variable de
 * `.env.production.example`. Devuelve qué ha comprobado, para las pruebas.
 */
export function comprobarEntornoDeProduccion({
  command, mode, cwd = process.cwd(), entorno = process.env, avisar = console.warn,
} = {}) {
  if (command !== 'build' || mode !== 'production') return { comprobado: false, faltan: [] };
  const ejemplo = leer(path.join(cwd, '.env.production.example'));
  if (ejemplo == null) return { comprobado: false, faltan: [] };

  const definidas = new Set(Object.keys(entorno || {}));
  for (const f of FICHEROS) {
    for (const k of clavesDe(leer(path.join(cwd, f)))) definidas.add(k);
  }
  const faltan = [...new Set(clavesDe(ejemplo))].filter((k) => !definidas.has(k));
  if (faltan.length === 0) return { comprobado: true, faltan };

  const mensaje = [
    `Build de producción SIN su configuración: faltan ${faltan.join(', ')}.`,
    `No hay ${path.join(cwd, '.env.production')} (no está en git; los worktrees no lo traen).`,
    'Cópialo del clon principal o créalo desde .env.production.example antes de compilar.',
    'Sin él, Vite apaga en silencio lo que esas variables encienden (el 22/10/2026 se fue así el ranking de gestoras de ISEIE).',
  ].join('\n  ');
  if (entorno && entorno.CI) {
    avisar(`[entornoDeProduccion] ${mensaje}`);
    return { comprobado: true, faltan, soloAviso: true };
  }
  throw new Error(mensaje);
}
