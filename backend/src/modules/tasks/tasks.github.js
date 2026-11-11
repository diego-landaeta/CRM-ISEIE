import crypto from 'crypto';

/*
  El tablero, al día con las issues de GitHub (CRM-ISEIE#435, gemela CRM-ISEIE#435).
  Diego, 11/11/2026: «GitHub manda y el tablero lo refleja». Solo en ese sentido:
  nada del CRM sube a GitHub (los repositorios son públicos).

  Aquí, lo que no toca la base: el interruptor, la firma del webhook y cómo se
  leen las issues y las PR. Lo que escribe está en `tasks.github.sync.js`.
*/

/** El interruptor del `.env`. Apagado de serie: sin él no se monta el webhook ni se importa. */
export function githubTableroActivo(env = process.env) {
  return ['1', 'true', 'si', 'sí'].includes(String(env.GITHUB_TABLERO_ACTIVO || '').trim().toLowerCase());
}

/** La etiqueta de la tarjeta cuando el asignado de GitHub no tiene usuario en el CRM (o no hay). */
export const ETIQUETA_POR_DEFINIR = 'Por definir quién lo hará';
export const COLOR_POR_DEFINIR = 'amber';

/** La marca de los eventos que pone el sistema (`task_events.details.action`). */
export const MARCA_GITHUB = 'github';

/** La rama de pruebas: una PR enlazada a ella lleva la tarea a «En revisión». */
export const RAMA_REVISION = 'staging';

/**
 * ¿La firma `X-Hub-Signature-256` es la del cuerpo EN BRUTO con este secreto?
 * HMAC SHA-256, comparado en tiempo constante. Sin secreto, sin cabecera o con
 * otro formato, no.
 */
export function firmaValida(secreto, cuerpo, cabecera) {
  if (!secreto || typeof cabecera !== 'string' || !cabecera.startsWith('sha256=')) return false;
  const recibida = Buffer.from(cabecera.slice(7), 'hex');
  const esperada = crypto.createHmac('sha256', secreto).update(Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo ?? '')).digest();
  // timingSafeEqual exige el mismo largo; un largo distinto ya es una firma mala.
  if (recibida.length !== esperada.length) return false;
  return crypto.timingSafeEqual(recibida, esperada);
}

/** La firma que pondría GitHub (para las pruebas y para quien quiera probar a mano). */
export function firmar(secreto, cuerpo) {
  return `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
}

const mismaRepo = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * Las issues que una PR dice que cierra o a las que se refiere, de este repositorio.
 *   · en el cuerpo: «Closes #12», «Fixes #3, #4», «Refs diego-landaeta/CRM#7»,
 *     también en castellano («Cierra #12», «Resuelve #3»);
 *   · en la rama: `feat/707-historial…`, `fix/680-webhook…` (el número delante).
 * Las de otro repositorio (`otro/repo#5`) no cuentan.
 */
export function issuesDeLaPr({ body = '', rama = '', repo = '' } = {}) {
  const numeros = new Set();
  const verbo = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?|cierra|cierran|resuelve|resuelven|arregla)\b\s*:?\s*((?:(?:[\w.-]+\/[\w.-]+)?#\d+[\s,y&and]*)+)/gi;
  for (const m of String(body || '').matchAll(verbo)) {
    for (const r of m[1].matchAll(/(?:([\w.-]+\/[\w.-]+))?#(\d+)/g)) {
      if (r[1] && !mismaRepo(r[1], repo)) continue;
      numeros.add(Number(r[2]));
    }
  }
  const enRama = /^(?:[\w.-]+\/)?(\d+)(?:[-_]|$)/.exec(String(rama || ''));
  if (enRama) numeros.add(Number(enRama[1]));
  return [...numeros].filter((n) => Number.isInteger(n) && n > 0);
}

/** ¿Es la copia de otra tarea? («> Misma tarea que …» o «> Misma PR que …»): no crea tarea. */
export function esCopiaDeOtra(body) {
  return /^\s*>\s*Misma (?:tarea|PR) que /.test(String(body || ''));
}

/**
 * La issue de la copia de la empresa de la que nació esta (cabecera del
 * sincronizador: «> Copiada de <copia>#N, abierta por …»; entre # y el número
 * puede ir un U+2060). Devuelve { repo, number } o null.
 */
export function copiaDeLaCabecera(body) {
  const m = /^\s*>\s*Copiada de \**([\w.-]+\/[\w.-]+)\**\s*#⁠?(\d+)/.exec(String(body || '').slice(0, 400));
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** El título de la tarea: «#12 · Título» (sin pasar de 255). */
export function tituloDeLaTarea(issue) {
  return `#${issue.number} · ${String(issue.title || '').trim()}`.slice(0, 255);
}

/** La descripción de la tarea: el cuerpo de la issue, tal cual (ya es público), con un tope. */
export function descripcionDeLaTarea(issue) {
  const cuerpo = String(issue.body || '').replace(/\r\n/g, '\n').trim();
  return cuerpo ? cuerpo.slice(0, 20000) : null;
}

/** Los logins asignados, en minúsculas y en el orden de GitHub. */
export function asignadosDe(issue) {
  const lista = Array.isArray(issue.assignees) && issue.assignees.length
    ? issue.assignees
    : (issue.assignee ? [issue.assignee] : []);
  return [...new Set(lista.map((a) => String(a?.login || '').toLowerCase()).filter(Boolean))];
}

export const urlDeLaIssue = (repo, number) => `https://github.com/${repo}/issues/${number}`;
