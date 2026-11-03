import router, { publico } from './consultas.routes.js';

export default {
  prefix: '/api/consultas',
  router,
  publicMount: { prefix: '/api/adjunto-consulta', router: publico },
};
