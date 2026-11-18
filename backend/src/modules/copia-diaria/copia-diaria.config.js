import os from 'node:os';
import path from 'node:path';

/**
 * La copia diaria de la base (Diego, 11/11/2026): «que el mismo CRM mande el
 * backup de las DB a mí y a Ángel todos los días».
 *
 * Todo sale del .env y se lee en cada vuelta: cambiar algo no exige reiniciar.
 * Nada de esto va en el código: el repositorio es público, y los correos de
 * quien la recibe y la contraseña del zip son lo primero que no puede estar ahí.
 *
 *   COPIA_DIARIA_ACTIVA          interruptor. Apagado de serie.
 *   COPIA_DIARIA_CLAVE           contraseña del zip (AES-256). Sin ella no se hace nada.
 *   COPIA_DIARIA_PARA            a quién, separados por comas.
 *   COPIA_DIARIA_HORA            "03:30" de serie.
 *   COPIA_DIARIA_ZONA            "Europe/Madrid" de serie.
 *   COPIA_DIARIA_CARPETA         dónde se guardan. De serie ~/copias-crm/<base>.
 *   COPIA_DIARIA_GUARDAR         cuántas se guardan. 7 de serie.
 *   COPIA_DIARIA_MAX_ADJUNTO_MB  hasta cuánto va adjunta. 10 de serie.
 *   COPIA_DIARIA_ENLACE_HORAS    cuánto dura el enlace. 48 de serie.
 *   COPIA_DIARIA_PG_DUMP         el pg_dump a usar. "pg_dump" de serie.
 *   COPIA_DIARIA_URL_PUBLICA     la API vista desde fuera, para el enlace. De serie
 *                                API_PUBLIC_BASE_URL o CRM_BASE_URL + /api.
 */

/** La clave más corta que se acepta. Una corta se rompe por fuerza bruta: el zip viaja por correo. */
export const CLAVE_MINIMA = 16;

const encendido = (v) => ['true', '1', 'si', 'sí', 'on', 'yes'].includes(String(v ?? '').trim().toLowerCase());

const entero = (v, porDefecto, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
};

/** "03:30" → 210 (minutos desde medianoche). Lo que no se entienda, las 03:30. */
export function minutoDelDia(texto) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(texto ?? '').trim());
  if (!m) return 3 * 60 + 30;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? h * 60 + min : 3 * 60 + 30;
}

/** La base de la conexión de la app, la de `shared/config/db.js`. */
export function baseDeLaConexion(env = process.env) {
  try {
    return decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

/** La dirección pública de la API: la que va en el enlace del correo. */
export function apiPublica(env = process.env) {
  const fija = String(env.COPIA_DIARIA_URL_PUBLICA || env.API_PUBLIC_BASE_URL || '').trim();
  if (fija) return fija.replace(/\/+$/, '');
  try {
    const base = new URL(env.CRM_BASE_URL || 'http://localhost:5173/crm');
    return `${base.origin}${base.pathname.replace(/\/+$/, '')}/api`;
  } catch {
    return null;
  }
}

export function leerConfig(env = process.env) {
  const base = baseDeLaConexion(env);
  // Fuera de la carpeta web y con la base en el nombre: en el servidor del 360
  // conviven producción y /testeo, y cada una guarda lo suyo sin pisarse.
  const carpeta = String(env.COPIA_DIARIA_CARPETA || '').trim()
    || path.join(os.homedir(), 'copias-crm', base || 'crm');
  return {
    activa: encendido(env.COPIA_DIARIA_ACTIVA),
    clave: String(env.COPIA_DIARIA_CLAVE || ''),
    para: String(env.COPIA_DIARIA_PARA || '').split(',').map((s) => s.trim()).filter(Boolean),
    minuto: minutoDelDia(env.COPIA_DIARIA_HORA || '03:30'),
    zona: String(env.COPIA_DIARIA_ZONA || 'Europe/Madrid').trim(),
    carpeta: path.resolve(carpeta),
    guardar: entero(env.COPIA_DIARIA_GUARDAR, 7, 1, 60),
    maxAdjuntoBytes: entero(env.COPIA_DIARIA_MAX_ADJUNTO_MB, 10, 1, 15) * 1024 * 1024,
    enlaceHoras: entero(env.COPIA_DIARIA_ENLACE_HORAS, 48, 1, 168),
    pgDump: String(env.COPIA_DIARIA_PG_DUMP || 'pg_dump').trim(),
    base,
    conexion: env.DATABASE_URL || null,
    apiPublica: apiPublica(env),
  };
}

/** Por qué no se puede hacer la copia con esta configuración, o null si se puede. */
export function queFalta(cfg) {
  if (!cfg.clave) return 'falta COPIA_DIARIA_CLAVE: sin contraseña no se hace ni se manda nada';
  if (cfg.clave.length < CLAVE_MINIMA) return `COPIA_DIARIA_CLAVE es demasiado corta (mínimo ${CLAVE_MINIMA} caracteres): no se hace ni se manda nada`;
  if (!cfg.para.length) return 'falta COPIA_DIARIA_PARA: no hay a quién mandarla';
  if (!cfg.conexion || !cfg.base) return 'falta DATABASE_URL: no se sabe qué base copiar';
  return null;
}
