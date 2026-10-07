/**
 * Lectura de los ajustes del MCP en el .env, en UN sitio.
 *
 * Antes cada módulo traía su copia (acceso, desbloqueo, alertas) y no
 * coincidían en si 0 valía o no. Ahora:
 *
 *   · enteroEnv(nombre, porDefecto)                → 0 o vacío = el valor por defecto
 *   · enteroEnv(nombre, porDefecto, { cero: true }) → 0 vale, y significa «apagado»
 *   · siNoEnv(nombre, porDefecto)                  → true/false, sí/no, 1/0
 *
 * Se leen en cada llamada, no al arrancar: cambiar el .env y reiniciar basta, y
 * las pruebas pueden tocarlos.
 */

export function enteroEnv(nombre, porDefecto, { cero = false } = {}) {
  const v = process.env[nombre];
  if (v === undefined || String(v).trim() === '') return porDefecto;
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0) return porDefecto;
  if (n === 0 && !cero) return porDefecto;
  return n;
}

const SI = ['1', 'true', 'si', 'sí', 'yes', 'on'];
const NO = ['0', 'false', 'no', 'off'];

export function siNoEnv(nombre, porDefecto) {
  const v = String(process.env[nombre] ?? '').trim().toLowerCase();
  if (SI.includes(v)) return true;
  if (NO.includes(v)) return false;
  return porDefecto;
}
