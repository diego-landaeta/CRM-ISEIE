import router, { publicRouter } from './feedback.routes.js';

// «¿Por qué has desistido?» (#169) y su panel (#170).
export default {
  prefix: '/api/feedback',
  router,
  publicMount: {
    prefix: '/api/f', // la encuesta: /api/f/<token>
    router: publicRouter,
  },
};
