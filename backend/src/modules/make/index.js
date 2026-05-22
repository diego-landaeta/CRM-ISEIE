import router from './make.routes.js';
import publicRouter from './make.public.routes.js';

// Admin (CRUD): /api/make-webhooks/*  (requiere JWT)
// Publico (ingesta): /api/webhooks/make/:slug  (X-Make-Secret)
//
// IMPORTANTE: este modulo expone DOS routers:
//   - `router` (default export): rutas admin con JWT, se monta en /api/make-webhooks
//   - `publicMount.router`: rutas publicas sin auth (validan X-Make-Secret), se
//     montan en /api/webhooks. El registro en app.js debe hacer ambos.
//
// El router publico DEBE registrarse ANTES de cualquier middleware que pinche
// JSON sin tolerar payloads externos, y obligatoriamente sin verifyToken.
export default {
  prefix: '/api/make-webhooks',
  router,
  // export adicional consumido por app.js para registrar las rutas publicas
  publicMount: { prefix: '/api/webhooks', router: publicRouter },
};
