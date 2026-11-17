import * as P from '../../shared/services/email-plantilla.service.js';
import { CRM_CORREOS } from '../../shared/config/crm.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { marcaDeLosCampus, remitenteDe } from '../../shared/services/marca.service.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './facturacion-auditoria.model.js';
import { leerConfig } from './facturacion-auditoria.config.js';

/*
  El correo de «facturación pausada» (#765), con la plantilla común y la marca:
  la del campus si todo lo encontrado es de uno, la de su empresa si son varios
  de la misma, y la del CRM si mezcla empresas.

  Va a los administradores activos y a FACTURACION_AUDITORIA_CORREOS. Uno por
  pausa (clave de idempotencia): reiniciar el servidor no lo repite.
*/

const NOMBRES = {
  numero_repetido: 'Números repetidos en una serie',
  datos_fiscales: 'Facturas sin datos fiscales obligatorios',
  cobro_sin_factura: 'Cobros sin factura',
};

/** Hasta cuántas incidencias de cada tipo se escriben en el correo. */
const MAX_POR_TIPO = 25;

export function correoDeLaPausa({ marca, incidencias, resumen }) {
  const bloques = [
    P.parrafo('La auditoría de facturación ha encontrado errores y ha <strong>pausado la emisión de facturas nuevas</strong>. '
      + 'Los cobros que entren mientras tanto quedan en cola y se facturarán en orden de cobro al reanudar.'),
    P.tarjetas(Object.entries(NOMBRES).map(([t, etiqueta]) => ({ etiqueta, valor: String(resumen[t] || 0) }))),
  ];
  for (const [tipo, titulo] of Object.entries(NOMBRES)) {
    const de = incidencias.filter((i) => i.tipo === tipo);
    if (!de.length) continue;
    bloques.push(P.seccion(titulo));
    for (const i of de.slice(0, MAX_POR_TIPO)) bloques.push(P.parrafo(`· ${P.esc(i.texto)}`));
    if (de.length > MAX_POR_TIPO) bloques.push(P.nota(`Y ${de.length - MAX_POR_TIPO} más: la lista entera está en el CRM.`));
  }
  bloques.push(
    P.parrafo('La auditoría <strong>no corrige nada</strong>. Cuando esté arreglado, pulsa «Marcar como solucionado» en Facturación: '
      + 'se vuelve a auditar y solo se reanuda si sale limpia.'),
    P.boton({ texto: 'Abrir Facturación', url: P.enlace(CRM_CORREOS.rutas.facturas) }),
    P.nota(`Se audita desde el ${P.esc(String(resumen.desde || '').split('-').reverse().join('/'))}; `
      + `un cobro o una factura sin datos cuenta como error a partir de ${P.esc(String(resumen.dias))} días.`),
  );
  return P.correo({
    proyecto: marca || CRM_CORREOS.marca || { nombre: CRM_CORREOS.nombre },
    titulo: 'Facturación pausada por la auditoría',
    resumen: `${incidencias.length} error(es) · no se emiten facturas nuevas hasta que se resuelva`,
    bloques,
  });
}

export async function avisarDeLaPausa({ pausa, incidencias, resumen, cfg = leerConfig() }) {
  const admins = await model.correosDeAdministradores();
  const para = [...new Set([...admins, ...cfg.correos.map((c) => c.toLowerCase())])];
  if (!para.length) {
    logger.warn({ pausaId: pausa.id }, 'auditoría de facturación: no hay a quién mandar el correo');
    return { sent: false, reason: 'SIN_DESTINATARIOS' };
  }
  const campus = [...new Set(incidencias.flatMap((i) => i.project_ids || []))];
  const marca = await marcaDeLosCampus(campus).catch(() => null);
  const correo = correoDeLaPausa({ marca, incidencias, resumen });
  return sendEmail({
    to: para.join(','),
    subject: `Facturación pausada · ${marca?.nombre || CRM_CORREOS.nombre}`,
    ...correo,
    ...remitenteDe(marca),
    tags: ['facturacion-auditoria', `pausa-${pausa.id}`],
    clave: `facturacion-pausada-${pausa.id}`,
  });
}
