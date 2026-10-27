import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './facturas-colaborador.controller.js';
import * as facturas from './facturas.controller.js';
import { TOPE_BYTES } from './facturas.service.js';

const router = Router();

// ─── El enlace del colaborador: sin usuario, con límite de intentos por IP ───

const limite = (max) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Prueba de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});

// El tipo de verdad se mira después, por los primeros bytes (`tipoReal`).
const recibir = (campo) => function recibirArchivoSubido(req, res, next) {
  // Pocos campos y cortos (revisión del 10/10): la subida trae el importe, el número y el
  // desglose (horas o líneas); el pago, las facturas, la fecha, la forma y la referencia.
  multer({ storage: multer.memoryStorage(), limits: { fileSize: TOPE_BYTES, files: 1, fields: 4, fieldSize: 10_000, parts: 6 } })
    .single(campo)(req, res, (err) => {
      if (!err) return next();
      // «El justificante…» cuando es el del pago: «el archivo» se leía como el de la factura.
      const que = campo === 'justificante' ? 'El justificante' : 'El archivo';
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(`${que} pasa de 10 MB`, 400, 'FILE_TOO_LARGE'));
      // El desglose por proyecto es el campo más largo: si pasa del límite, decirlo, no «el archivo».
      if (err.code === 'LIMIT_FIELD_VALUE') {
        return next(new AppError('El desglose es demasiado largo: acorta los encargos o júntalos en menos', 400, 'VALIDATION_ERROR'));
      }
      return next(new AppError(`No se pudo leer ${que === 'El justificante' ? 'el justificante' : 'el archivo'}`, 400, 'INVALID_FILE'));
    });
};
const recibirArchivo = recibir('archivo');

router.get('/enlace/:token', limite(60), facturas.verEnlace);
// El formato del código se mira ANTES de leer el archivo: con cualquier cadena se
// cargaban hasta 10 MB en memoria (revisión del 10/10).
const codigoConFormato = (req, res, next) => (/^[A-Za-z0-9_-]{40,60}$/.test(String(req.params.token || ''))
  ? next() : next(new AppError('Este enlace no existe o ya no es válido', 404, 'NOT_FOUND')));
router.post('/enlace/:token', limite(20), codigoConFormato, recibirArchivo, facturas.subir);
// El archivo guardado en disco (sin R2), con enlace firmado de 15 min (revisión del 10/10).
router.get('/archivo-local/:id', limite(60), facturas.archivoLocal);
router.get('/justificante-local/:id', limite(60), facturas.justificanteLocal);

// ─── «Mi factura»: el colaborador con usuario en el CRM, solo lo suyo ───
// Son las únicas de este módulo que puede pedir el rol colaborador
// (`RUTAS_DEL_COLABORADOR`, shared/utils/roles.js).

router.get('/mias', verifyToken, puede('facturas_colaborador.subir'), facturas.mias);
router.post('/mias/:id', verifyToken, puede('facturas_colaborador.subir'), limite(20), recibirArchivo, facturas.subirMia);
router.get('/mias/:id/archivo', verifyToken, puede('facturas_colaborador.subir'), facturas.archivoMio);

// ─── Administración: la lista de colaboradores ───
// El permiso se mira en el servidor; qué empresas ve cada uno lo acota el servicio.

router.get('/empresas', verifyToken, puede('facturas_colaborador.ver_todas', 'facturas_colaborador.gestionar'), ctrl.empresas);
router.get('/colaboradores', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.listar);
router.post('/colaboradores', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.crear);
router.get('/colaboradores/:id', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.ver);
router.patch('/colaboradores/:id', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.editar);
router.post('/colaboradores/:id/baja', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.darDeBaja);
router.post('/colaboradores/:id/alta', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.volverDeAlta);
router.get('/colaboradores/:id/registro', verifyToken, puede('facturas_colaborador.gestionar'), ctrl.registro);

// ─── Administración: las facturas del mes ───

router.get('/mes', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.delMes);
// Enviadas, Por pagar, Pagadas e Historial, y el coste por campus (segunda parte).
router.get('/facturas', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.deLaVista);
router.get('/coste-por-campus', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.costePorCampus);
router.get('/zip', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.zip);
router.get('/facturas/:id/archivo', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.archivo);
router.get('/facturas/:id/registro', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.registro);
// El desglose de la factura (segunda parte): «Administración lo ve todo».
router.get('/facturas/:id/desglose', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.desglose);
router.post('/facturas/:id/anular', verifyToken, puede('facturas_colaborador.anular'), facturas.anular);
router.post('/facturas/:id/reenviar', verifyToken, puede('facturas_colaborador.gestionar'), facturas.reenviar);

// ─── El pago (segunda parte): una o varias, con el justificante si se quiere ───

router.post('/facturas/pagar', verifyToken, puede('facturas_colaborador.pagar'), recibir('justificante'), facturas.pagar);
router.post('/facturas/:id/deshacer-pago', verifyToken, puede('facturas_colaborador.pagar'), facturas.deshacerPago);
router.get('/facturas/:id/justificante', verifyToken, puede('facturas_colaborador.ver_todas'), facturas.justificante);

export default router;
