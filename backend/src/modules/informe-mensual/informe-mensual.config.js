/**
 * El informe mensual y el envío a la gestoría (#772, Automatizaciones 9/9).
 *
 * Todo sale del .env y se lee en cada vuelta: cambiar algo no exige reiniciar.
 * Las direcciones NO van en el código: el repositorio es público.
 *
 *   INFORME_MENSUAL_ACTIVO          interruptor del ENVÍO. Apagado de serie. Apagado,
 *                                   el informe y el ZIP se bajan a mano igual.
 *   INFORME_MENSUAL_PARA            la gestoría, separados por comas. Vale para
 *                                   todas las empresas que no tengan la suya.
 *   INFORME_MENSUAL_PARA_<SERIE>    la gestoría de UNA empresa, por su serie de
 *                                   facturación (INFORME_MENSUAL_PARA_CEDIA) o
 *                                   por su id (INFORME_MENSUAL_PARA_3).
 *   INFORME_MENSUAL_ADMINISTRACION  administración: recibe el de todas.
 *   INFORME_MENSUAL_EMPRESAS        solo estas (series o ids, por comas). Vacío:
 *                                   las que tengan facturas o ventas en el mes.
 *   INFORME_MENSUAL_DIA             día del mes en que sale el del mes anterior. 1 de serie.
 *   INFORME_MENSUAL_HORA            "09:00" de serie, hora de Madrid.
 *   INFORME_MENSUAL_MAX_ADJUNTO_MB  hasta cuánto va adjunto. 10 de serie.
 *   INFORME_MENSUAL_ENLACE_HORAS    cuánto dura el enlace de descarga si no cabe. 168 (7 días).
 */

const encendido = (v) => ['true', '1', 'si', 'sí', 'on', 'yes'].includes(String(v ?? '').trim().toLowerCase());

const entero = (v, porDefecto, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
};

const lista = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** "09:00" → 540 (minutos desde medianoche). Lo que no se entienda, las 09:00. */
export function minutoDelDia(texto) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(texto ?? '').trim());
  if (!m) return 9 * 60;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? h * 60 + min : 9 * 60;
}

/** La parte de la variable que nombra a una empresa: «CEDIA», «ICTESS», o su id. */
export const sufijo = (texto) => String(texto ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function leerConfig(env = process.env) {
  return {
    activo: encendido(env.INFORME_MENSUAL_ACTIVO),
    para: lista(env.INFORME_MENSUAL_PARA),
    administracion: lista(env.INFORME_MENSUAL_ADMINISTRACION),
    empresas: lista(env.INFORME_MENSUAL_EMPRESAS).map(sufijo),
    // Hasta el 28: todos los meses lo tienen.
    dia: entero(env.INFORME_MENSUAL_DIA, 1, 1, 28),
    minuto: minutoDelDia(env.INFORME_MENSUAL_HORA || '09:00'),
    zona: String(env.APP_TIMEZONE || 'Europe/Madrid').trim(),
    // Brevo admite 20 MB por correo, con el adjunto en base64 (+33 %).
    maxAdjuntoBytes: entero(env.INFORME_MENSUAL_MAX_ADJUNTO_MB, 10, 1, 14) * 1024 * 1024,
    enlaceHoras: entero(env.INFORME_MENSUAL_ENLACE_HORAS, 168, 1, 720),
    env,
  };
}

/** ¿Va esta empresa? Sin lista, todas; con lista, por serie o por id. */
export function empresaIncluida(cfg, empresa) {
  if (!cfg.empresas.length) return true;
  return cfg.empresas.includes(sufijo(empresa.serie)) || cfg.empresas.includes(String(empresa.id));
}

/**
 * A quién va el de una empresa: su gestoría (la suya, o la general) y
 * administración, sin repetir. Vacío = no se manda.
 */
export function destinatarios(cfg, empresa) {
  const propia = [empresa.serie && `INFORME_MENSUAL_PARA_${sufijo(empresa.serie)}`, `INFORME_MENSUAL_PARA_${empresa.id}`]
    .filter(Boolean).map((k) => lista(cfg.env[k])).find((l) => l.length);
  const gestoria = propia || cfg.para;
  const todos = [...gestoria, ...cfg.administracion];
  const vistos = new Set();
  return todos.filter((e) => {
    const k = e.toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
