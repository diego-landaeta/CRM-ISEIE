import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as gh from './tasks.github.service.js';

/*
  «Configurar tablero › GitHub» (CRM-ISEIE#435). Cada ruta pide `tasks.github`
  (tasks.routes.js), que de serie solo tiene el superadmin.
*/

const REPO = z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, 'El repositorio va como «dueño/nombre»').max(140);
// Los logins de GitHub: letras, números y guiones, hasta 39.
const LOGIN = z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'Ese no es un login de GitHub');

const configSchema = z.object({
  repo: REPO.optional(),
  team_id: z.number().int().positive().nullable().optional(),
  supervisor_id: z.number().int().positive().nullable().optional(),
  copia_repo: z.union([REPO, z.literal('')]).nullable().optional(),
}).strict();

// Los secretos: se escriben y nunca se leen. '' lo borra.
const secretosSchema = z.object({
  webhook_secret: z.union([z.string().trim().min(16, 'El secreto del webhook, de 16 caracteres o más').max(200), z.literal('')]).optional(),
  token: z.union([z.string().trim().min(20, 'Eso no parece un token de GitHub').max(400), z.literal('')]).optional(),
}).strict();

const usuarioSchema = z.object({ user_id: z.number().int().positive() }).strict();

function validar(schema, datos) {
  const r = schema.safeParse(datos ?? {});
  if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos no válidos', 400, 'VALIDATION_ERROR');
  return r.data;
}

export async function githubEstado(req, res, next) {
  try { res.json({ success: true, data: await gh.estado() }); } catch (err) { next(err); }
}

export async function githubConfig(req, res, next) {
  try { res.json({ success: true, data: await gh.guardarConfig(validar(configSchema, req.body), req.user) }); } catch (err) { next(err); }
}

export async function githubSecretos(req, res, next) {
  try {
    const datos = validar(secretosSchema, req.body);
    if (datos.webhook_secret === undefined && datos.token === undefined) throw new AppError('Nada que guardar', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await gh.guardarSecretos(datos, req) });
  } catch (err) { next(err); }
}

export async function githubPonerUsuario(req, res, next) {
  try {
    const login = validar(LOGIN, req.params.login);
    const { user_id } = validar(usuarioSchema, req.body);
    res.json({ success: true, data: await gh.ponerUsuario(login, user_id, req.user) });
  } catch (err) { next(err); }
}

export async function githubQuitarUsuario(req, res, next) {
  try {
    res.json({ success: true, data: await gh.quitarUsuario(validar(LOGIN, req.params.login)) });
  } catch (err) { next(err); }
}
