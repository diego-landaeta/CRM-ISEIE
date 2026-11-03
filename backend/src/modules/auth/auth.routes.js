import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as authController from './auth.controller.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});

// POST /api/auth/login — email + password → accessToken + refreshToken cookie
router.post('/login', loginLimiter, authController.login);

// POST /api/auth/refresh — refreshToken cookie → nuevo accessToken + rotacion cookie
router.post('/refresh', authController.refresh);

// POST /api/auth/logout — revoca refreshToken + limpia cookie
router.post('/logout', verifyToken, authController.logout);

// El freno de la recuperacion (#37): «limite de intentos, para que no se pueda
// usar como ametralladora».
//
// Es UNO PROPIO y no el del login, por dos razones:
//
//   - `skipSuccessfulRequests` del login no vale aqui. Alli un acierto es
//     entrar y deja de contar con razon; aqui TODA peticion contesta 200 —esa
//     es justamente la gracia— asi que con esa opcion no frenaria ni una.
//   - y es mas estrecho a proposito: nadie pide su contraseña cinco veces en un
//     cuarto de hora, pero quien barre correos para ver cuales existen si.
const recuperacionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas peticiones. Intenta de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});

// POST /api/auth/forgot-password — correo → enlace para poner una nueva
router.post('/forgot-password', recuperacionLimiter, authController.forgotPassword);

// POST /api/auth/set-password — token unico → establecer contrasena
// Intentos de poner la contraseña con el enlace: 8 cada 15 minutos por IP, como en
// CRM-ISEIE. El enlace lleva un token; sin límite, se podía probar a ciegas.
const setPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});

// POST /api/auth/login — email + password → accessToken + refreshToken cookie
router.post('/login', loginLimiter, authController.login);

// POST /api/auth/refresh — refreshToken cookie → nuevo accessToken + rotacion cookie
router.post('/refresh', authController.refresh);

// POST /api/auth/logout — revoca refreshToken + limpia cookie
router.post('/logout', verifyToken, authController.logout);

// POST /api/auth/set-password — token unico → establecer contrasena
router.post('/set-password', setPasswordLimiter, authController.setPassword);

// GET /api/auth/me — datos del usuario autenticado + proyectos
router.get('/me', verifyToken, authController.me);

// POST /api/auth/change-password — usuario cambia su propia contrasena
router.post('/change-password', changePasswordLimiter, verifyToken, authController.changePassword);

// PATCH /api/auth/me — usuario edita su propio perfil (nombre)
router.patch('/me', verifyToken, authController.updateMyProfile);

// PATCH /api/auth/me/email — el propio correo, solo un tutor (#246). Con el mismo
// límite de intentos que el cambio de contraseña: también toca la credencial.
// La sesión ANTES que el permiso: sin `req.user`, `puede` siempre da 401.
router.patch('/me/email', changePasswordLimiter, verifyToken, puede('cuenta.cambiar_correo'), authController.updateMyEmail);

export default router;
