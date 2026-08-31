import { logger } from '../utils/logger.js';
import { logError } from '../../modules/status/status.model.js';

// Clasificamos los errores en 3 categorias para que el frontend pueda mostrar
// mensajes mas utiles que un "project_id error" generico.
function classifyError(err, statusCode) {
  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();

  // Errores de validacion (Zod) o campos faltantes
  if (
    code === 'VALIDATION_ERROR' ||
    code === 'MISSING_PROJECT' ||
    code === 'INVALID_ID' ||
    code === 'INVALID_REASON' ||
    /requerido|required|invalido|invalid|faltant/.test(msg)
  ) {
    return 'validation';
  }
  if (code === 'INVALID_CREDENTIALS' || code === 'ACCOUNT_DISABLED' || statusCode === 401 || statusCode === 403) {
    return 'auth';
  }
  if (code === 'PROJECT_NOT_FOUND' || code === 'LEAD_NOT_FOUND' || code === 'USER_NOT_FOUND' || code === 'BLOCK_NOT_FOUND' || statusCode === 404) {
    return 'not_found';
  }
  if (statusCode >= 500) return 'system';
  return 'business';
}

export function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Error interno del servidor';
  const errorType = classifyError(err, statusCode);

  // Una referencia corta por cada fallo interno. Va al registro Y a la pantalla,
  // asi que cuando alguien dice «no me deja guardar» trae consigo el dato con el
  // que encontrar su error exacto, en vez de una frase que le vale a todos.
  const ref = statusCode >= 500 ? Math.random().toString(36).slice(2, 8).toUpperCase() : null;

  if (!err.isOperational) {
    logger.error({ err, ref, path: req.path, method: req.method }, 'Unhandled error');
  } else if (statusCode >= 400 && statusCode < 500) {
    // Los rechazos tambien se escriben. Antes solo se guardaban los 5xx, y por
    // eso el dia que doce gestoras no pudieron crear un prospecto no habia ni
    // una linea que lo dijera: el servidor contestaba «falta el telefono» y
    // nadie podia verlo desde fuera. Sin datos personales: ruta, motivo y quien.
    logger.warn({
      path: req.path,
      method: req.method,
      status: statusCode,
      code: err.code || null,
      motivo: err.message,
      userId: req.user?.userId || null,
    }, 'Peticion rechazada');
  }

  // Guardar errores 5xx en status_errors para el panel de soporte
  if (statusCode >= 500) {
    logError({
      method: req.method,
      path: req.path,
      status_code: statusCode,
      message: ref ? `[${ref}] ${err.message}` : err.message,
      stack: err.stack,
      user_id: req.user?.userId || null,
    }).catch(() => {}); // silencioso — no bloquear la respuesta
  }

  // Mensaje legible segun el tipo de error: ayuda al usuario a saber si es algo
  // que puede arreglar (validation, completar campo) o un problema del sistema.
  let displayMessage = message;
  if (errorType === 'validation') {
    displayMessage = message; // ya viene descriptivo de Zod
  } else if (errorType === 'system') {
    // A quien administra se le dice QUE ha fallado. Es informacion tecnica, pero
    // se la damos a quien puede hacer algo con ella: si no, un fallo de la base
    // llega como «reintenta en unos segundos» y se reintenta para siempre.
    // Al resto, la referencia — con eso se encuentra el error entero.
    const mandaAqui = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    displayMessage = mandaAqui
      ? `${err.message} (ref ${ref})`
      : `Error del sistema. Pasa esta referencia a soporte: ${ref}.`;
  }

  res.status(statusCode).json({
    success: false,
    error: displayMessage,
    error_type: errorType, // 'validation' | 'auth' | 'not_found' | 'business' | 'system'
    ...(err.code && { code: err.code }),
    ...(ref && { ref }),
  });
}
