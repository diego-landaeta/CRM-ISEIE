import router from './informe-mensual.routes.js';

// El informe mensual de ventas y el envío a la gestoría (#772). El trabajo que
// lo manda está en jobs/informeMensualJob.js; aquí, las descargas.
export default {
  prefix: '/api/informe-mensual',
  router,
};
