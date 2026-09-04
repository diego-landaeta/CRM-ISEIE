import * as model from './registro.model.js';
import { listarSchema } from './registro.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

/** El registro, para la pantalla. */
export async function listar(req, res, next) {
  try {
    const parsed = listarSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const r = await model.listar(parsed.data);
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

/** Que fuentes hay y como se llaman, para pintar los filtros. */
export async function fuentes(req, res, next) {
  try {
    const hay = await model.tablasQueHay();
    res.json({
      success: true,
      data: model.NOMBRES_FUENTE.map((n) => ({
        nombre: n,
        titulo: model.FUENTES[n].titulo,
        sistema: model.FUENTES[n].sistema,
        // Se manda tambien la que NO esta, con el aviso. Esconderla dejaria la
        // pantalla enseñando cinco filtros donde deberia haber seis, sin que
        // nadie sepa que falta una migracion.
        disponible: hay.has(n),
      })),
    });
  } catch (err) { next(err); }
}

/** Un campo de CSV: comillas dobladas y todo entre comillas. */
const campo = (v) => {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
};

/**
 * El registro en CSV, que es lo que pide el ticket con «que se pueda descargar».
 *
 * Se descarga LO QUE SE ESTA MIRANDO: los mismos filtros. Una descarga que
 * trajera otra cosa que la pantalla es la forma mas rapida de que alguien mande
 * un informe con datos que no son los que vio.
 *
 * Con BOM porque esto se abre en Excel: sin el, «Cambió» sale «CambiÃ³».
 */
export async function csv(req, res, next) {
  try {
    const parsed = listarSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { filas } = await model.listar({ ...parsed.data, limite: model.TOPE });

    const cabecera = ['Cuándo', 'Fuente', 'Usuario', 'Acción', 'Qué pasó', 'Entidad', 'Id', 'Correcto'];
    const lineas = [cabecera.map(campo).join(';')];
    for (const f of filas) {
      lineas.push([
        new Date(f.cuando).toISOString(),
        model.FUENTES[f.fuente]?.titulo || f.fuente,
        f.usuario || '',
        f.accion,
        f.resumen,
        f.entidad || '',
        f.entidad_id ?? '',
        f.ok ? 'sí' : 'no',
      ].map(campo).join(';'));
    }

    const hoy = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="registro-${parsed.data.vista}-${hoy}.csv"`);
    // Punto y coma como separador y BOM delante: es lo que Excel en español
    // espera. Con coma mete todo en una columna.
    res.send('﻿' + lineas.join('\r\n'));
  } catch (err) { next(err); }
}
