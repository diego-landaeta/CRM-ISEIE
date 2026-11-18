import router, { publicRouter } from './monitask.routes.js';

// Monitask en el CRM (#236): qué hace cada colaborador y el cotejo con sus facturas.
// Siempre montado: cada ruta contesta 404 con MONITASK_ACTIVO apagado.
export default {
  prefix: '/api/monitask',
  router,
  publicMount: {
    prefix: '/api/monitask/oauth',
    router: publicRouter,
  },
};
