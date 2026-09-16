import router from './report.routes.js';

// Se sirve en **/api/informes**, que es lo que pide el frontal.
//
// Al pasar las rutas a español se renombraron tambien las llamadas internas
// —las nueve del frontal dicen `/informes/...`— pero el prefijo del servidor se
// quedo en `/api/reports`. Resultado: 404 en todo lo que cuelga de aqui. No solo
// la pantalla de Reportes: tambien el panel de numeros del dashboard, el de
// asesoras y el detalle de metricas. De ahi que «no se vieran los numeros».
//
// `alias` mantiene viva la direccion antigua. No cuesta nada y evita romper
// cualquier integracion o pestaña abierta que siga pidiendo `/api/reports`.
export default {
  prefix: '/api/informes',
  alias: '/api/reports',
  router,
};
