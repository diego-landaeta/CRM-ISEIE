import router, { publicRouter } from './stripe-payments.routes.js';

export default {
  prefix: '/api/stripe-payments',
  router,
  publicMount: {
    prefix: '/api/stripe-webhook',
    router: publicRouter,
  },
};
