import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyToken, soloRoles } from '../../shared/middleware/auth.js';
import { urlPersonal, verificarTokenMcp } from './mcp.auth.js';
import { atenderPeticion, metodoNoPermitido } from './mcp.server.js';
import { huella } from './mcp.acceso.js';
import * as ctrl from './mcp.controller.js';
import oauth from './mcp.oauth.js';

const router = Router();

// ─── Panel del CRM (JWT normal) ───────────────────────────────────────────
// Va ANTES que `POST /` para que «/panel» no lo atienda la puerta del MCP.
const panel = Router();
panel.use(verifyToken);
panel.get('/', ctrl.estado);
panel.post('/tokens', ctrl.crearToken);
panel.delete('/tokens/:id', ctrl.revocarToken);
// Código de desbloqueo para Claude (#192).
panel.post('/codigo', ctrl.crearCodigo);
// `soloRoles` y no `roleGuard`: roleGuard deja pasar a soporte, y Diego dijo
// super admin y admin.
panel.get('/personas', soloRoles('superadmin', 'admin'), ctrl.personas);
panel.patch('/personas/:id', soloRoles('superadmin', 'admin'), ctrl.cambiarAcceso);
router.use('/panel', panel);

// ─── Inicio de sesión OAuth para Claude (sin JWT: lo usa Claude) ─────────
// Para las cuentas de Claude que al pulsar «Connect» exigen OAuth. Ver
// mcp.oauth.js. Va antes que `POST /` por la misma razon que el panel.
router.use('/oauth', oauth);

// ─── El MCP (token personal) ──────────────────────────────────────────────
// 60 preguntas por minuto y token: de sobra para una conversacion, y corta un
// bucle que se quede preguntando sin parar. Se cuenta por token y no por IP:
// detras de Claude pueden venir muchas personas desde la misma IP.
const limite = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Sin cabecera (peticion que va a ser rechazada) se cuenta por IP, con el
  // helper de la libreria para que una IPv6 no se salte el limite cambiando
  // de direccion dentro de su bloque.
  keyGenerator: (req) => {
    const llave = req.mcpTokenDeUrl || req.headers.authorization;
    return llave ? huella(llave) : ipKeyGenerator(req.ip);
  },
  message: { jsonrpc: '2.0', error: { code: -32029, message: 'Demasiadas consultas. Espera un minuto.' }, id: null },
});

router.post('/', limite, verificarTokenMcp, atenderPeticion);
router.get('/', metodoNoPermitido);
router.delete('/', metodoNoPermitido);

// La URL personal, para «Agregar conector personalizado» de Claude Desktop y
// claude.ai. `urlPersonal` va PRIMERO: tapa el secreto antes que nada pueda
// escribirlo en un registro, y el limite cuenta por token igual que arriba.
router.post('/u/:secreto', urlPersonal, limite, verificarTokenMcp, atenderPeticion);
router.get('/u/:secreto', urlPersonal, metodoNoPermitido);
router.delete('/u/:secreto', urlPersonal, metodoNoPermitido);

export default router;
