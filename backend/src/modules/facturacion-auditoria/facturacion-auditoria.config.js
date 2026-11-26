/**
 * La auditoría de facturación cada 2 horas (#765, Automatizaciones 2/9).
 *
 * Todo sale del .env y se lee en cada uso: cambiar algo no exige reiniciar
 * (salvo encenderla, que arranca la tarea programada).
 *
 *   FACTURACION_AUDITORIA_ACTIVA    interruptor. Apagado de serie: apagado, el
 *                                   CRM factura exactamente como hoy.
 *   FACTURACION_AUDITORIA_DIAS      días que puede estar un cobro sin factura
 *                                   (y una factura sin sus datos fiscales).
 *                                   9 de serie: los 7 del formulario más 2.
 *   FACTURACION_AUDITORIA_DESDE     desde qué fecha se audita (AAAA-MM-DD). Sin
 *                                   ella, desde el día de la primera vuelta.
 *   FACTURACION_AUDITORIA_CORREOS   a quién más avisar, además de los
 *                                   administradores, separados por comas.
 *   FACTURACION_AUDITORIA_PAUSAR    0 = MODO AVISO: audita y lo apunta (se ve
 *                                   en Facturas › Facturación automática y
 *                                   avisa en la campana cuando deja de salir
 *                                   limpia), pero NO pausa la facturación ni
 *                                   manda el correo de la pausa. De serie, 1.
 *                                   Para encenderla las primeras semanas sin
 *                                   parar a nadie por una costumbre (24/11:
 *                                   en el 360 salen facturas a mano sin NIF).
 *
 * Nada de esto va en el código: el repositorio es público.
 */

const encendido = (v) => ['true', '1', 'si', 'sí', 'on', 'yes'].includes(String(v ?? '').trim().toLowerCase());

const entero = (v, porDefecto, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
};

/** «2026-11-17» si es una fecha de verdad; si no, null. */
export function fechaValida(v) {
  const t = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

/** Cada cuánto pasa la auditoría. */
export const CADA_MS = 2 * 60 * 60 * 1000;

/** Días sin factura de serie: los 7 que tiene el alumno para el formulario, más 2. */
export const DIAS_DE_SERIE = 9;

export function leerConfig(env = process.env) {
  return {
    activa: encendido(env.FACTURACION_AUDITORIA_ACTIVA),
    dias: entero(env.FACTURACION_AUDITORIA_DIAS, DIAS_DE_SERIE, 1, 365),
    desde: fechaValida(env.FACTURACION_AUDITORIA_DESDE),
    // Pausa salvo que se diga que no: lo de serie es lo que se aprobó en #765.
    pausar: !['0', 'false', 'no', 'off'].includes(String(env.FACTURACION_AUDITORIA_PAUSAR ?? '').trim().toLowerCase()),
    correos: String(env.FACTURACION_AUDITORIA_CORREOS || '')
      .split(',').map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
  };
}

export const auditoriaActiva = (env = process.env) => leerConfig(env).activa;
