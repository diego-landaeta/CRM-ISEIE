import router, { publicRouter } from './widget.routes.js';

export default {
  prefix: '/api/widget',
  router,
  publicMount: {
    prefix: '/api/w',  // ej: /api/w/whatsapp/4.js
    router: publicRouter,
  },
};
