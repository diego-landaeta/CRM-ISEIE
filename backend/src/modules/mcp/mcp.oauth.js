import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { huella, pareceToken, puedeUsarMcp } from './mcp.acceso.js';
import * as model from './mcp.model.js';

/**
 * Inicio de sesión OAuth para Claude (02/10/2026).
 *
 * POR QUE EXISTE
 *
 * La llave del MCP va dentro de la URL personal (`/api/mcp/u/crm_mcp_…`) y con
 * eso basta en Claude Desktop y en muchas cuentas de claude.ai. Pero algunas
 * cuentas —la de Diego, del plan gratuito— al pulsar «Connect» exigen además
 * iniciar sesión por OAuth: buscan `/.well-known/oauth-protected-resource`,
 * luego `/.well-known/oauth-authorization-server` y luego `POST /register`, y
 * al dar 404 enseñan «Couldn't register with … sign-in service». El CRM
 * contestaba bien al MCP; lo que no tenia era este inicio de sesión.
 *
 * QUE HACE
 *
 * Un OAuth minimo, sin pantalla ni contraseña: autoriza a quien traiga una URL
 * personal VALIDA. Tener la URL ya es tener el acceso, asi que esto no abre
 * ninguna puerta nueva; solo traduce esa llave al idioma que pide Claude, y de
 * paso la saca de la URL: despues viaja en la cabecera `Authorization` (#193).
 *
 *   1. Datos del recurso (RFC 9728) y del servidor de autorizacion (RFC 8414).
 *   2. Registro dinamico (RFC 7591): sin guardar nada; un identificador cualquiera.
 *   3. /authorize: comprueba que la URL del parametro `resource` es una URL
 *      personal viva y de alguien que puede usar Claude, y devuelve un codigo
 *      CIFRADO (lleva la llave dentro) que caduca en 5 minutos.
 *   4. /token: el codigo, con su verificador PKCE, se cambia por la llave. El
 *      refresco vuelve a mirar que la URL siga viva: anularla en el CRM corta
 *      tambien lo conectado por aqui.
 *
 * Dos limites que no se pueden saltar:
 *   · PKCE S256 obligatorio: quien intercepte el codigo no puede canjearlo.
 *   · Solo se vuelve a direcciones de Claude (o a la maquina local, para Claude
 *     Code): nadie puede usar esto para mandarse el codigo a su propia web.
 *
 * Las rutas `/.well-known/…` viven en la RAIZ del dominio: nginx las trae aqui
 * y pasa el prefijo del entorno en `X-Forwarded-Prefix` (/crm, /testeo…).
 */

const DURACION_CODIGO_MS = 5 * 60 * 1000;
const DURACION_ACCESO_S = 30 * 24 * 3600;
const DURACION_REFRESCO_MS = 365 * 24 * 3600 * 1000;

/** A donde se puede devolver el codigo: Claude, o la maquina local (Claude Code). */
const VUELTAS_PERMITIDAS = [
  /^https:\/\/claude\.ai\//,
  /^https:\/\/claude\.com\//,
  /^https:\/\/[a-z0-9-]+\.claude\.ai\//,
  /^https:\/\/[a-z0-9-]+\.claude\.com\//,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//,
];
export function vueltaPermitida(uri) {
  return typeof uri === 'string' && uri.length <= 500 && VUELTAS_PERMITIDAS.some((rx) => rx.test(uri));
}

// ── Cifrado de codigos y refrescos (AES-256-GCM, clave derivada del JWT) ───
function clave() {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET no está configurado');
  return crypto.createHash('sha256').update(`mcp-oauth:${base}`).digest();
}
export function sellar(datos) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const cuerpo = Buffer.concat([cifra.update(JSON.stringify(datos), 'utf8'), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), cuerpo]).toString('base64url');
}
export function abrir(texto) {
  try {
    const b = Buffer.from(String(texto || ''), 'base64url');
    if (b.length < 29) return null;
    const descifra = crypto.createDecipheriv('aes-256-gcm', clave(), b.subarray(0, 12));
    descifra.setAuthTag(b.subarray(12, 28));
    const claro = Buffer.concat([descifra.update(b.subarray(28)), descifra.final()]).toString('utf8');
    return JSON.parse(claro);
  } catch {
    return null;
  }
}

const sha256url = (texto) => crypto.createHash('sha256').update(String(texto)).digest('base64url');

/** La direccion publica del CRM en este entorno: https://360crm.tech/crm, …/testeo… */
export function basePublica(req) {
  const prefijo = String(req.get('x-forwarded-prefix') || '').replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}${prefijo}`;
}

/** La llave de una URL personal: lo que va detras de /api/mcp/u/. */
export function secretoDe(resource) {
  const m = /\/api\/mcp\/u\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(String(resource || ''));
  return m && pareceToken(m[1]) ? m[1] : null;
}

/** ¿Esta llave sirve hoy? Misma regla que la puerta del MCP (`verificarTokenMcp`). */
async function llaveViva(secreto) {
  if (!pareceToken(secreto)) return false;
  const vivo = await model.findTokenVivo(huella(secreto));
  if (!vivo) return false;
  const user = await model.findUserById(vivo.user_id);
  return puedeUsarMcp(user);
}

function metadatosServidor(req) {
  const emisor = `${basePublica(req)}/api/mcp/oauth`;
  return {
    issuer: emisor,
    authorization_endpoint: `${emisor}/authorize`,
    token_endpoint: `${emisor}/token`,
    registration_endpoint: `${emisor}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['crm'],
  };
}

function errorOAuth(res, status, error, descripcion) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).json({ error, error_description: descripcion });
}

function volverCon(res, redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  return res.redirect(302, url.toString());
}

const router = Router();

// Poco trafico legitimo: una conexion son 4 o 5 peticiones. Corta el que pruebe
// llaves a ciegas contra /authorize.
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'temporarily_unavailable', error_description: 'Demasiadas peticiones. Espera un minuto.' },
}));

// 1. Los datos del recurso. Llega desde
//    /.well-known/oauth-protected-resource/<prefijo>/api/mcp/u/<llave> (nginx).
//    La llave se tapa en la URL antes de nada, como en la puerta del MCP.
router.get('/recurso/mcp/u/:secreto', (req, res) => {
  const secreto = req.params.secreto;
  req.url = req.url.replace(secreto, '***');
  req.originalUrl = req.originalUrl.replace(secreto, '***');
  if (!pareceToken(secreto)) return res.status(404).json({ error: 'not_found' });
  const base = basePublica(req);
  res.set('Cache-Control', 'no-store');
  return res.json({
    resource: `${base}/api/mcp/u/${secreto}`,
    authorization_servers: [`${base}/api/mcp/oauth`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['crm'],
    resource_name: 'CRM',
  });
});

// 2. Los datos del servidor de autorizacion, por las tres puertas habituales.
router.get('/metadatos', (req, res) => res.json(metadatosServidor(req)));
router.get('/.well-known/oauth-authorization-server', (req, res) => res.json(metadatosServidor(req)));
router.get('/.well-known/openid-configuration', (req, res) => res.json(metadatosServidor(req)));

// 3. Registro: se acepta a cualquiera que vuelva a Claude. No se guarda nada.
router.post('/register', (req, res) => {
  const vueltas = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
  if (!vueltas.length || !vueltas.every(vueltaPermitida)) {
    return errorOAuth(res, 400, 'invalid_redirect_uri', 'Solo se aceptan direcciones de vuelta de Claude.');
  }
  return res.status(201).json({
    client_id: `crm-${crypto.randomBytes(12).toString('hex')}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof req.body?.client_name === 'string' ? req.body.client_name.slice(0, 100) : 'Claude',
    redirect_uris: vueltas,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
});

// 4. Autorizar: sin pantalla. La URL personal del parametro `resource` es la llave.
router.get('/authorize', async (req, res, next) => {
  try {
    const q = req.query;
    const vuelta = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
    // Sin una vuelta de Claude no se redirige a ningun sitio: se contesta aqui.
    if (!vueltaPermitida(vuelta)) {
      return errorOAuth(res, 400, 'invalid_request', 'La dirección de vuelta no es de Claude.');
    }
    const state = typeof q.state === 'string' ? q.state : undefined;
    if (q.response_type !== 'code') {
      return volverCon(res, vuelta, { error: 'unsupported_response_type', state });
    }
    if (typeof q.code_challenge !== 'string' || q.code_challenge.length < 43 || q.code_challenge_method !== 'S256') {
      return volverCon(res, vuelta, { error: 'invalid_request', error_description: 'Hace falta PKCE con S256.', state });
    }
    const secreto = secretoDe(q.resource);
    if (!secreto) {
      return volverCon(res, vuelta, {
        error: 'invalid_target',
        error_description: 'Usa la URL personal que da el CRM en Conexión → MCP.',
        state,
      });
    }
    if (!(await llaveViva(secreto))) {
      return volverCon(res, vuelta, {
        error: 'access_denied',
        error_description: 'Esa URL no vale: está anulada o tu usuario no tiene acceso a Claude. Genera otra en el CRM.',
        state,
      });
    }
    const codigo = sellar({
      t: 'codigo', s: secreto, cc: q.code_challenge, ru: vuelta,
      cid: typeof q.client_id === 'string' ? q.client_id : '', exp: Date.now() + DURACION_CODIGO_MS,
    });
    return volverCon(res, vuelta, { code: codigo, state });
  } catch (err) { next(err); }
});

// 5. Canjear el codigo (o refrescar) por la llave.
router.post('/token', async (req, res, next) => {
  try {
    const b = req.body || {};
    const respuesta = (secreto) => {
      res.set('Cache-Control', 'no-store');
      return res.json({
        access_token: secreto,
        token_type: 'Bearer',
        expires_in: DURACION_ACCESO_S,
        refresh_token: sellar({ t: 'refresco', s: secreto, exp: Date.now() + DURACION_REFRESCO_MS }),
        scope: 'crm',
      });
    };

    if (b.grant_type === 'authorization_code') {
      const c = abrir(b.code);
      if (!c || c.t !== 'codigo' || c.exp < Date.now()) return errorOAuth(res, 400, 'invalid_grant', 'Código no válido o caducado.');
      if (b.redirect_uri && b.redirect_uri !== c.ru) return errorOAuth(res, 400, 'invalid_grant', 'La dirección de vuelta no coincide.');
      if (typeof b.code_verifier !== 'string' || sha256url(b.code_verifier) !== c.cc) {
        return errorOAuth(res, 400, 'invalid_grant', 'El verificador PKCE no coincide.');
      }
      if (!(await llaveViva(c.s))) return errorOAuth(res, 400, 'invalid_grant', 'La URL del CRM ya no es válida.');
      return respuesta(c.s);
    }

    if (b.grant_type === 'refresh_token') {
      const r = abrir(b.refresh_token);
      if (!r || r.t !== 'refresco' || r.exp < Date.now()) return errorOAuth(res, 400, 'invalid_grant', 'Refresco no válido o caducado.');
      if (!(await llaveViva(r.s))) return errorOAuth(res, 400, 'invalid_grant', 'La URL del CRM ya no es válida.');
      return respuesta(r.s);
    }

    return errorOAuth(res, 400, 'unsupported_grant_type', 'Solo authorization_code y refresh_token.');
  } catch (err) { next(err); }
});

export default router;
