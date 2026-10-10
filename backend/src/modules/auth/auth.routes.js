import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
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
router.patch('/me/email', changePasswordLimiter, verifyToken, authController.updateMyEmail);

export default router;
