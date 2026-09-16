import router from './sales.routes.js';
// El prefijo esta en español porque es lo que pide el frontal. Al pasar las
// rutas a español se renombraron las llamadas y NO los prefijos del servidor:
// esas pantallas llevaban desde entonces pidiendo a una direccion que no
// contestaba. Mismo caso que reportes -> informes.
//
// `alias` mantiene viva la direccion antigua: no cuesta nada y evita romper
// integraciones o pestañas abiertas.

export default { prefix: '/api/ventas',
  alias: '/api/sales', router };
