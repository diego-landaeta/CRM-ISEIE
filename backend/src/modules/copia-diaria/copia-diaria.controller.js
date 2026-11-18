import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { leerConfig } from './copia-diaria.config.js';
import { firmaValida } from './copia-diaria.enlace.js';
import { rutaParaDescargar } from './copia-diaria.service.js';
import { descargaSchema } from './copia-diaria.validation.js';

const NO_VALE = () => new AppError('El enlace no vale o ha caducado', 403, 'FORBIDDEN');

// GET /api/copia-diaria/descarga/:fichero?exp=&sig= — la copia CIFRADA, con el
// enlace firmado del correo. Sin sesión: la firma es la llave. Con la copia
// apagada no se sirve nada.
export async function descargar(req, res, next) {
  try {
    const cfg = leerConfig();
    if (!cfg.activa) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    const p = descargaSchema.safeParse({ ...req.query, fichero: req.params.fichero });
    if (!p.success || !firmaValida(p.data.fichero, p.data.exp, p.data.sig)) throw NO_VALE();
    const ruta = await rutaParaDescargar(p.data.fichero, cfg);
    if (!ruta) throw new AppError('Esta copia ya no está en el servidor', 404, 'NOT_FOUND');
    const { size } = await fs.promises.stat(ruta);
    logger.info({ fichero: p.data.fichero, ip: req.ip }, 'Copia diaria: descarga');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${p.data.fichero}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(fs.createReadStream(ruta), res);
  } catch (err) {
    if (res.headersSent) { res.destroy(err); return; }
    next(err);
  }
}
