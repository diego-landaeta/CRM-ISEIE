import { logger } from '../utils/logger.js';
import { apuntarActividad } from '../../modules/asignacion/asignacion.model.js';

/*
  LO QUE HACE UNA GESTORA Y NO GUARDA QUIÉN LO HIZO (CRM#513, 27/10/2026).

  Para la asignación por actividad («cualquier cosa que haga en el CRM»):
  crear un lead, una venta, un cobro, una matrícula, una factura, un paso del
  proceso, mandar un correo a un prospecto… se apuntan en `actividad_crm` al
  terminar bien la petición (2xx), con quién y cuándo.

  Lo que ya deja su rastro con autor NO va aquí, porque allí se aplican las
  reglas de Carlos: notas e interacciones (nota corta o repetida no cuenta),
  cambios de estado (los deshechos no cuentan), recordatorios y ediciones de un
  prospecto (solo apuntan cambios reales).

  Nunca frena la petición: se apunta después de contestar, y si falla, se avisa
  en el registro y ya.
*/

const ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Consultas por POST, descargas y marcas de «leído»: no son trabajo con un prospecto.
const NO_CUENTA = /\/(export|exportar|preview|vista-previa|vista|buscar|search|check-duplicate|pdf|descargar|leido|leidos|read|simular)(\/|$)/i;

const REGLAS = [
  { re: /^\/api\/leads\/?$/, metodos: ['POST'], accion: 'crear_lead' },
  { re: /^\/api\/leads\/bulk\/?$/, metodos: ['POST'], accion: 'crear_lead' },
  { re: /^\/api\/leads\/\d+\/send-email\/?$/, metodos: ['POST'], accion: 'email' },
  { re: /^\/api\/leads\/\d+\/products(\/\d+)?\/?$/, accion: 'producto' },
  { re: /^\/api\/leads\/\d+\/merge\/?$/, metodos: ['POST'], accion: 'edicion' },
  { re: /^\/api\/(conversions|ventas|sales)(\/|$)/, accion: 'venta' },
  { re: /^\/api\/matriculas(\/|$)/, accion: 'matricula' },
  { re: /^\/api\/invoices(\/|$)/, accion: 'factura' },
  { re: /^\/api\/proceso(\/|$)/, accion: 'proceso' },
];

/** La acción que se apunta para esta petición, o null. Pura, para probarla. */
export function accionDe(metodo, ruta) {
  if (!ESCRITURA.has(metodo)) return null;
  const camino = String(ruta || '').split('?')[0];
  if (NO_CUENTA.test(camino)) return null;
  const r = REGLAS.find((x) => x.re.test(camino) && (!x.metodos || x.metodos.includes(metodo)));
  return r ? r.accion : null;
}

export function registrarActividad(req, res, next) {
  if (!ESCRITURA.has(req.method)) return next();
  res.on('finish', () => {
    try {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const userId = req.user?.userId;
      if (!userId) return;
      const accion = accionDe(req.method, req.originalUrl);
      if (!accion) return;
      apuntarActividad(userId, accion, `${req.method} ${req.originalUrl.split('?')[0]}`)
        .catch((err) => logger.warn({ err: err.message }, 'actividad_crm: no se pudo apuntar'));
    } catch { /* nunca frena nada */ }
  });
  next();
}

export default registrarActividad;
