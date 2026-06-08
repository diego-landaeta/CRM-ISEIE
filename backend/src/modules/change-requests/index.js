import router from './change-request.routes.js';

// Acceso: cualquier usuario autenticado puede crear su RFC. PM/admin/superadmin
// ven todos. Solo PM+ pueden rellenar la parte técnica + firmar.
export default {
  prefix: '/api/change-requests',
  router,
};
