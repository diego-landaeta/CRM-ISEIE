import router, { publicRouter } from './factura-automatica.routes.js';

// Factura automática con formulario de datos fiscales (#452). Apagada de serie
// (FACTURA_AUTOMATICA_ACTIVA): montada, pero sin el interruptor no hace nada.
export default {
  prefix: '/api/factura-automatica',
  router,
  publicMount: {
    prefix: '/api/fd', // el formulario: /api/fd/<token>
    router: publicRouter,
  },
};
