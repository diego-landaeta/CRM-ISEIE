import router, { publicRouter } from './diploma-confirmacion.routes.js';

// Confirmación de datos del diploma (#768). Apagada de serie
// (DIPLOMA_CONFIRMACION_ACTIVA): montada, pero sin el interruptor no hace nada.
export default {
  prefix: '/api/diploma-confirmacion',
  router,
  publicMount: {
    prefix: '/api/cd', // la página del alumno: /api/cd/<token>
    router: publicRouter,
  },
};
