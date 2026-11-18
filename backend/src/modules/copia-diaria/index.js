import router from './copia-diaria.routes.js';

// La copia diaria de la base (11/11/2026). Solo el enlace de descarga: el
// trabajo que la hace está en jobs/copiaDiariaJob.js.
export default {
  prefix: '/api/copia-diaria',
  router,
};
