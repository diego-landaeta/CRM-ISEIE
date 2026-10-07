/**
 * Menos datos personales en lo que ve Claude (#196, épica #191).
 *
 * Diego: «teléfonos y correos enmascarados por defecto (por ejemplo
 * +34 6** *** 123); el nombre completo solo cuando haga falta».
 *
 *   · Correos y teléfonos: enmascarados en TODAS las herramientas.
 *   · Nombres de clientes: en los listados, «Pedro S.»; completos en la ficha
 *     de un prospecto (`ver_prospecto`), que es cuando hacen falta.
 *   · Los nombres del EQUIPO (gestoras, vendedoras, tutores) no se tocan: no son
 *     datos de clientes y los informes los necesitan para tener sentido.
 *
 * Cuando de verdad haga falta el dato entero (llamar a alguien), la herramienta
 * acepta `datos_completos: true`. Ese parámetro queda en `mcp_auditoria`, así
 * que se ve quién lo pidió y cuándo (Conexión → MCP → Actividad, #195).
 *
 * Se aplica sobre el RESULTADO, por nombre de campo, y no en cada consulta SQL:
 * así cubre también los informes de Reportes, que no son del MCP y devuelven
 * `cliente_email` o `cliente_telefono`, y una herramienta nueva que traiga un
 * `email` sale enmascarada sin que nadie tenga que acordarse.
 *
 * Lo que NO puede tapar: un teléfono escrito a mano dentro de una nota o una
 * interacción (texto libre). Eso sale tal cual.
 */

import { enteroEnv } from './mcp.config.js';

/** «+34 612 345 123» → «+34 6** *** 123». Se dejan los separadores como están. */
export function enmascararTelefono(tel) {
  const s = String(tel);
  const digitos = s.replace(/\D/g, '').length;
  if (digitos < 6) return s.replace(/\d/g, '*');
  // Con prefijo internacional se ven el prefijo y la primera cifra (3); sin
  // él, solo la primera. Y siempre las tres últimas.
  const delante = s.trim().startsWith('+') ? 3 : 1;
  let visto = 0;
  return s.replace(/\d/g, (d) => {
    visto += 1;
    return visto <= delante || visto > digitos - 3 ? d : '*';
  });
}

/** «pedro.s@gmail.com» → «p***@g***.com». */
export function enmascararEmail(email) {
  const s = String(email);
  const at = s.indexOf('@');
  if (at < 1) return '***';
  const local = s.slice(0, at);
  const dominio = s.slice(at + 1);
  const punto = dominio.lastIndexOf('.');
  const nombreDominio = punto > 0 ? dominio.slice(0, punto) : dominio;
  const tld = punto > 0 ? dominio.slice(punto) : '';
  return `${local[0]}***@${nombreDominio[0] || ''}***${tld}`;
}

/** «Pedro Sánchez López» → «Pedro S.». Una sola palabra se queda como está. */
export function abreviarNombre(nombre) {
  const partes = String(nombre).trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return partes[0] || '';
  return `${partes[0]} ${partes[1][0].toUpperCase()}.`;
}

const ES_EMAIL = /(^|_)(email|correo)$/i;
const ES_TELEFONO = /(^|_)(telefono|tel|movil|whatsapp_usuario|whatsapp)$/i;
// Nombres de CLIENTES, por cómo se llaman en las consultas y en los informes.
const ES_CLIENTE = /^(cliente|cliente_nombre|nombre_cliente|lead_nombre|alumno|nombre_alumno)$/i;

/**
 * Aplica la regla a un resultado. `nombresDeLista` dice en qué listas el campo
 * `nombre` es de un cliente (en `buscar_prospectos` lo es; en `mis_proyectos`
 * es el de un campus y no se toca).
 */
export function protegerDatos(datos, { completos = false, nombresDeLista = [] } = {}) {
  if (completos) return datos;
  const recorrer = (v, enListaDeClientes) => {
    if (Array.isArray(v)) return v.map((x) => recorrer(x, enListaDeClientes));
    if (!v || typeof v !== 'object' || v instanceof Date) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && x && ES_EMAIL.test(k) && x.includes('@')) out[k] = enmascararEmail(x);
      // Teléfono: si tiene 6 cifras o más, se escriba como se escriba
      // («612.345.123», «(612) 34-51-23»…). Contar cifras, no buscar un formato.
      else if (typeof x === 'string' && x && ES_TELEFONO.test(k) && x.replace(/\D/g, '').length >= 6) out[k] = enmascararTelefono(x);
      else if (typeof x === 'string' && x && (ES_CLIENTE.test(k) || (enListaDeClientes && k === 'nombre'))) out[k] = abreviarNombre(x);
      else out[k] = recorrer(x, nombresDeLista.includes(k));
    }
    return out;
  };
  return recorrer(datos, false);
}

/**
 * Máximo de filas por respuesta (MCP_MAX_FILAS, 100): ninguna lista de una
 * respuesta pasa de ahí, para que no se pueda volcar una tabla entera de una
 * vez. Devuelve los datos recortados y qué listas se recortaron.
 */
export const maxFilas = () => enteroEnv('MCP_MAX_FILAS', 100);

export function recortarFilas(datos, max = maxFilas()) {
  const recortes = [];
  const recorrer = (v, ruta) => {
    if (Array.isArray(v)) {
      if (v.length > max) recortes.push({ lista: ruta || 'resultado', tenia: v.length, quedan: max });
      return v.slice(0, max).map((x, i) => recorrer(x, `${ruta}[${i}]`));
    }
    if (!v || typeof v !== 'object' || v instanceof Date) return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, recorrer(x, ruta ? `${ruta}.${k}` : k)]));
  };
  return { datos: recorrer(datos, ''), recortes };
}
