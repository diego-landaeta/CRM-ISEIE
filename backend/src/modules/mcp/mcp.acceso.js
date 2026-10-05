import crypto from 'crypto';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * Quien puede usar el MCP y que puede ver. Aqui NO hay SQL: son reglas puras,
 * para poder probarlas sin base.
 *
 * LA REGLA DE DIEGO
 *
 *   «Si yo estoy en X empresa solo ver los datos de ahi. Si solo soy de un
 *    campus solo de ese campus. No puedo ver ni consultar datos de otros campus.»
 *
 * En el CRM la empresa es la sociedad (`projects.sociedad_emisora_id`) y el
 * campus es el proyecto. Una persona esta en los campus de `user_projects`, y
 * con eso ya esta en sus empresas: no hay que guardar la empresa aparte.
 *
 * POR QUE NO SE REUTILIZA `proyectosDelAmbito`
 *
 * Ese helper se fia del `projectId`/`issuerId` que manda quien pregunta y no
 * mira `user_projects`. En las pantallas del CRM hay un menu que ya solo
 * enseña los campus propios; aqui quien elige es un modelo de lenguaje, y lo
 * que pida se trata como entrada de fuera. Por eso el ambito sale SIEMPRE de
 * la persona, y lo que pida Claude solo puede ESTRECHARLO, nunca ensancharlo.
 */

/** Roles que entran sin casilla, por lo que dijo Diego. */
export const ROLES_CON_ACCESO = ['superadmin', 'admin'];

/** Roles que pueden encender o apagar la casilla de otra persona. */
export const ROLES_QUE_ADMINISTRAN = ['superadmin', 'admin'];

/**
 * Roles a los que NO se les puede dar la casilla. Un tutor es externo: ve sus
 * alumnos por su pantalla, no el CRM.
 */
export const ROLES_SIN_MCP = ['tutor'];

/**
 * Caducidad y rotación de las URLs (#194). Se lee del .env en cada llamada.
 *
 *   MCP_TOKEN_DIAS          días que vive una URL desde que se crea (90).
 *                           0 = no caducan (lo que había hasta la #194).
 *   MCP_TOKEN_AVISO_DIAS    días antes de caducar en que se avisa por correo (7).
 *   MCP_TOKEN_SIN_USO_DIAS  días sin usarse tras los que se revoca sola (30).
 *                           0 = no se revocan por falta de uso.
 *
 * Hasta el 03/10 las URLs no caducaban (decidido con Diana el 28/09). La #194
 * de Diego lo cambia: la URL es la llave, y una llave que no caduca ni se usa
 * es justo la que alguien puede tener sin que nadie lo note.
 */
const dias = (v, def) => {
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : def;
};

export function configRotacion() {
  return {
    diasDeVida: dias(process.env.MCP_TOKEN_DIAS, 90) || null,
    diasAviso: dias(process.env.MCP_TOKEN_AVISO_DIAS, 7),
    diasSinUso: dias(process.env.MCP_TOKEN_SIN_USO_DIAS, 30) || null,
  };
}

/** Días que vive una URL nueva; null = no caduca. */
export const diasDeVidaToken = () => configRotacion().diasDeVida;

/** Maximo de tokens vivos por persona: uno por equipo, no una coleccion. */
export const MAX_TOKENS_VIVOS = 5;

export function puedeUsarMcp(user) {
  if (!user || !user.active) return false;
  if (ROLES_CON_ACCESO.includes(user.role)) return true;
  if (ROLES_SIN_MCP.includes(user.role)) return false;
  return user.usa_mcp === true;
}

/**
 * Quien no es super admin ni admin solo ve LO SUYO dentro de sus campus: sus
 * prospectos, sus ventas, sus facturas. Es la misma regla que ya aplican
 * Reportes (`asesoraDelInforme`) y el listado de prospectos a una gestora.
 */
export function soloLoSuyo(user) {
  return !ROLES_CON_ACCESO.includes(user.role);
}

/**
 * El ambito de una persona, a partir de sus proyectos ya leidos de la base.
 *
 * `proyectos` = [{ id, nombre, sociedad_id, sociedad_nombre }]. Los de prueba y
 * los inactivos ya vienen filtrados por el modelo.
 */
export function construirAmbito(user, proyectos) {
  return {
    userId: user.id,
    nombre: user.nombre,
    role: user.role,
    soloLoSuyo: soloLoSuyo(user),
    proyectos,
    projectIds: proyectos.map((p) => Number(p.id)),
  };
}

/**
 * Los proyectos sobre los que se ejecuta UNA consulta.
 *
 * Sin nada: todos los de la persona. Con un campus: ese, si es suyo. Con una
 * empresa: los campus de esa empresa que son suyos. Si pide algo que no es
 * suyo NO se le devuelve vacio en silencio: se le dice que no, para que Claude
 * no conteste «no hay ventas» cuando lo que pasa es que no puede verlas.
 */
export function acotarProyectos(ambito, { proyecto_id, sociedad_id } = {}) {
  let ids = ambito.projectIds;

  if (sociedad_id != null) {
    const sid = Number(sociedad_id);
    ids = ambito.proyectos.filter((p) => Number(p.sociedad_id) === sid).map((p) => Number(p.id));
    if (!ids.length) {
      throw new AppError(`No tienes acceso a la empresa ${sociedad_id}. Usa «mis_proyectos» para ver las tuyas.`, 403, 'MCP_FUERA_DE_AMBITO');
    }
  }

  if (proyecto_id != null) {
    const pid = Number(proyecto_id);
    if (!ids.includes(pid)) {
      throw new AppError(`No tienes acceso al campus ${proyecto_id}. Usa «mis_proyectos» para ver los tuyos.`, 403, 'MCP_FUERA_DE_AMBITO');
    }
    ids = [pid];
  }

  if (!ids.length) {
    throw new AppError('No tienes ningun campus asignado en el CRM.', 403, 'MCP_SIN_PROYECTOS');
  }
  return ids;
}

/**
 * El dueño a imponer en la consulta: la propia persona si solo ve lo suyo,
 * nadie si ve todo su campus. No se acepta de fuera.
 */
export function responsableImpuesto(ambito) {
  return ambito.soloLoSuyo ? ambito.userId : null;
}

// ─── Tokens ───────────────────────────────────────────────────────────────

const PREFIJO = 'crm_mcp_';

/** Un token nuevo: se enseña UNA vez y se guarda solo su huella. */
export function generarToken() {
  const token = PREFIJO + crypto.randomBytes(32).toString('base64url');
  return { token, hash: huella(token), prefijo: token.slice(0, PREFIJO.length + 4) };
}

export function huella(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Solo se buscan en la base cadenas con pinta de token nuestro. */
export function pareceToken(token) {
  return typeof token === 'string' && token.startsWith(PREFIJO) && token.length >= PREFIJO.length + 40 && token.length <= 128;
}
