import router, { publicRouter } from './cobros-externos.routes.js';

// Registro automático de cobros: PayPal y extractos del banco (#766).
export default {
  prefix: '/api/cobros-externos',
  router,
  publicMount: {
    prefix: '/api/paypal-webhook',
    router: publicRouter,
  },
};
