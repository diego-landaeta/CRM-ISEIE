/**
 * El inventario de permisos (#423, fase 1): cada acción del CRM, qué la protege
 * hoy y quién puede de verdad.
 *
 * Junta las rutas (`rutas.js`, sacadas del código) con las comprobaciones a mano
 * (`manuales.js`) y lo evalúa con la copia congelada de cómo se decidía
 * (`legado.js`). De aquí salen `docs/PERMISOS.md` y `inventario.json`
 * (`npm run permisos:inventario`), y la prueba falla si cualquiera de los dos
 * se queda viejo.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { leerRutas } from './rutas.js';
import { PUERTAS, ALCANCE, YA_CON_PERMISO } from './manuales.js';
import { puedeRuta, pasaRegla, manual, ROLES_DEL_SISTEMA, tieneRol } from './legado.js';
import { claveDe, PROPIA, SOLO_DEL_TUTOR } from './asignacion.js';
import { SECCIONES, POR_CLAVE, ROLES_FIJOS, dependencias } from '../catalogo.js';

export { PUERTAS, ALCANCE, YA_CON_PERMISO };

const CASILLAS = ['factura_manager', 'editar_fechas_factura', 'gestor_colaboraciones', 'usa_mcp'];

/** Una persona de prueba: un rol, sin casillas, sin excepciones. */
export function personaDePrueba(role, extra = {}) {
  return {
    id: 0, role, roles_extra: [], active: true, custom_role: null, excepciones: {}, ajustesRol: [],
    factura_manager: false, editar_fechas_factura: false, gestor_colaboraciones: false,
    usa_mcp: false, usa_whatsapp: null, ...extra,
  };
}

/** Las puertas a mano que se suman, sin condición, a esta ruta. */
function puertasDe(ruta) {
  return PUERTAS.filter((p) => !p.condicion && p.modulo === ruta.modulo && p.controladores.includes(ruta.controlador));
}

/** ¿Entraba esta persona? Guardias de la ruta y puertas a mano, todas. */
export function puedeAntes(u, fila) {
  // Siempre con la fila CONGELADA: los guardias de ahora ya no son los de antes.
  const entrada = ANTES.get(fila.id);
  if (!entrada) return null; // ruta nueva: antes no existía
  if (entrada.tipo === 'condicion') {
    const base = puedeRuta(u, ANTES.get(entrada.id.split(' · ')[0]));
    if (base === null) return null;
    return base && manual[entrada.regla](u);
  }
  const r = puedeRuta(u, entrada);
  if (r === null) return null;
  return r && entrada.puertas.every((id) => manual[PUERTAS.find((p) => p.id === id).regla](u));
}

/**
 * EL INVENTARIO DE ANTES, congelado (#423). Es el de la fase 1 tal cual: cada
 * ruta con los guardias que tenía antes de que se tocara nada. El «antes» se
 * evalúa siempre aquí; el inventario vivo (`construirInventario`) dice qué
 * clave pide cada ruta ahora.
 */
export const ANTES = new Map(
  JSON.parse(fs.readFileSync(fileURLToPath(new URL('./antes-423.json', import.meta.url)), 'utf8')).map((f) => [f.id, f]));

/**
 * ¿Entra con el catálogo? `mapa` es lo que puede la persona ({ clave: bool }),
 * sea de los valores de serie de su rol o de `explicarPermisos`. El corte del
 * colaborador (`verifyToken`) sigue mandando por encima, como siempre.
 */
export function puedeDespues(u, fila, mapa, { comoGuardia = false } = {}) {
  if (fila.tipo === 'condicion') {
    return puedeDespues(u, fila.ruta_base, mapa, { comoGuardia: true }) && tieneClave(u, claveDe(fila), mapa);
  }
  const k = claveDe(fila, { comoGuardia });
  if (fila.publica) return k ? tieneClave(u, k, mapa) && u.active !== false : true;
  if (u.active === false) return false;
  if (!pasaRegla(u, { tipo: 'token' }, fila.ruta)) return false;
  if (k === PROPIA) return true;
  if (!comoGuardia && SOLO_DEL_TUTOR[fila.modulo]?.includes(fila.relativa) && !tieneRol(u, 'tutor')) return false;
  return tieneClave(u, k, mapa);
}

function tieneClave(u, k, mapa) {
  if (u.role === 'superadmin') return true;
  if (k === undefined || k === null) return false;
  return [].concat(k).some((c) => mapa[c] === true);
}

function describirRegla(g) {
  switch (g.tipo) {
    case 'token': return 'sesión';
    case 'roles': return `${g.atajoSoporte ? 'roleGuard' : 'soloRoles'}(${g.roles.join(', ')})${g.atajoSoporte ? ' +superadmin +soporte por el atajo' : ''}`;
    case 'permiso': return `checkPermission(${g.clave})${g.conExtras ? '' : ' sin roles de más'}`;
    case 'permisoAlguno': return `permiso ${g.claves.join(' o ')}`;
    case 'rolOPermiso': return `rol (${g.roles.join(', ')})${g.atajoSoporte ? ' +soporte' : ''} o permiso ${g.clave}`;
    case 'alcance': return `${g.nombre} (campus)`;
    default: return `¿${g.nombre}? sin clasificar`;
  }
}

/** «Quién puede de verdad»: los roles que entran solos, y qué casilla abre la puerta a otros. */
export function quienPuede(fila) {
  const entrada = ANTES.get(fila.id);
  if (!entrada) return '(ruta nueva)';
  if (entrada.publica && entrada.tipo !== 'condicion') return 'cualquiera, sin sesión';
  const roles = ROLES_DEL_SISTEMA.filter((r) => puedeAntes(personaDePrueba(r), entrada) === true);
  const abre = [];
  for (const c of CASILLAS) {
    const conCasilla = ROLES_DEL_SISTEMA.filter((r) => !roles.includes(r)
      && puedeAntes(personaDePrueba(r, { [c]: true }), entrada) === true);
    if (conCasilla.length) abre.push(`${conCasilla.join('/')} con «${c}»`);
  }
  const apagada = roles.filter((r) => puedeAntes(personaDePrueba(r, { usa_whatsapp: false }), entrada) === false);
  const claves = entrada.guardias?.filter((g) => ['permiso', 'permisoAlguno', 'rolOPermiso'].includes(g.tipo)) || [];
  const partes = [roles.length ? roles.join(', ') : 'nadie por su rol'];
  if (abre.length) partes.push(`y ${abre.join(', ')}`);
  if (apagada.length) partes.push(`(salvo con «usa_whatsapp» apagado)`);
  if (claves.length) partes.push('y quien tenga el permiso por rol a medida o excepción');
  return partes.join(' ');
}

/**
 * Todo el inventario: una fila por ruta, y una más por cada acción con
 * condición dentro de una ruta.
 */
export async function construirInventario() {
  const rutas = await leerRutas();
  const filas = [];
  for (const r of rutas) {
    const puertas = puertasDe(r).map((p) => p.id);
    filas.push({
      id: `${r.metodo} ${r.ruta}`,
      tipo: 'ruta',
      modulo: r.modulo,
      metodo: r.metodo,
      ruta: r.ruta,
      relativa: `${r.metodo} ${r.ruta.slice(r.prefijo.length) || '/'}`,
      controlador: r.controlador,
      publica: r.publica,
      guardias: r.guardias,
      puertas,
    });
  }
  for (const p of PUERTAS.filter((x) => x.condicion)) {
    for (const base of filas.filter((f) => f.tipo === 'ruta' && f.modulo === p.modulo && p.controladores.includes(f.controlador))) {
      filas.push({
        id: `${base.id} · ${p.id}`,
        tipo: 'condicion',
        modulo: p.modulo,
        metodo: base.metodo,
        ruta: base.ruta,
        controlador: base.controlador,
        publica: false,
        condicion: p.condicion,
        regla: p.regla,
        puerta: p.id,
        ruta_base: { ...base },
      });
    }
  }
  return filas;
}

const celda = (s) => String(s ?? '').replace(/\|/g, '\\|');

/** La columna «Permiso»: la clave del catálogo que pide, o por qué no pide ninguna. */
function permisoDe(f) {
  const k = claveDe(f);
  if (k === PROPIA) return 'lo de cada uno';
  if (k === null) return '—';
  if (k === undefined) return '¿sin asignar?';
  return [].concat(k).map((c) => `\`${c}\``).join(' o ');
}

/** El catálogo por secciones: lo que se ve en Configuración › Roles. */
function catalogoEnMarkdown() {
  const nombreRol = Object.fromEntries(ROLES_FIJOS.map((r) => [r.clave, r.nombre]));
  const lineas = ['# Catálogo de permisos', '',
    'Cada permiso del CRM, agrupado como el menú (`backend/src/modules/permissions/catalogo.js`).',
    '«De serie» son los roles fijos que lo traen; el superadmin los tiene todos. «Necesita» es',
    'lo que pide para tener sentido (editar pide ver).', ''];
  for (const s of SECCIONES) {
    lineas.push(`## ${s.nombre}`, '');
    for (const r of s.recursos) {
      lineas.push(`### ${r.nombre}`, '', '| Permiso | Clave | Qué deja hacer | De serie | Necesita |', '|---|---|---|---|---|');
      for (const x of r.acciones) {
        const clave = `${r.clave}.${x.accion}`;
        const deSerie = POR_CLAVE[clave].roles.map((k) => nombreRol[k] || k).join(', ') || 'solo superadmin';
        const extra = [x.soloPantalla ? ' (solo pantalla)' : '', x.nunca?.length ? ` · nunca: ${x.nunca.map((k) => nombreRol[k] || k).join(', ')}` : '',
          x.nuncaPrincipal?.length ? ` · nunca si su rol principal es: ${x.nuncaPrincipal.map((k) => nombreRol[k] || k).join(', ')}` : ''].join('');
        const necesita = dependencias(clave).map((d) => `\`${d}\``).join(', ');
        lineas.push(`| ${celda(x.nombre)} | \`${clave}\` | ${celda(x.descripcion + extra)} | ${celda(deSerie)} | ${celda(necesita)} |`);
      }
      lineas.push('');
    }
  }
  return lineas;
}

function protegeHoy(fila) {
  const f = ANTES.get(fila.id);
  if (!f) return '(no existía)';
  if (f.tipo === 'condicion') {
    const p = PUERTAS.find((x) => x.id === f.puerta);
    return `cuando ${f.condicion}: a mano, ${p.donde}`;
  }
  const partes = f.guardias.map(describirRegla);
  for (const id of f.puertas) partes.push(`a mano: ${PUERTAS.find((p) => p.id === id).donde}`);
  return partes.length ? partes.join(' · ') : 'nada (pública)';
}

/** `docs/PERMISOS.md`. Determinista: mismo código, mismo texto. */
export function inventarioEnMarkdown(filas) {
  const porModulo = new Map();
  for (const f of filas) {
    if (!porModulo.has(f.modulo)) porModulo.set(f.modulo, []);
    porModulo.get(f.modulo).push(f);
  }
  const total = filas.filter((f) => f.tipo === 'ruta').length;
  const sinRegla = filas.filter((f) => f.tipo === 'ruta' && f.guardias.some((g) => g.tipo === 'sin_regla'));
  const lineas = [
    '# Permisos del CRM',
    '',
    '> **Generado** con `npm run permisos:inventario` (backend). No se edita a mano:',
    '> sale de recorrer los routers de cada módulo (`modules/permissions/inventario/rutas.js`)',
    '> y de las comprobaciones a mano apuntadas en `inventario/manuales.js`. Una prueba',
    '> falla si el código cambia y esto no.',
    '',
    `${total} rutas en ${porModulo.size} módulos, y ${filas.length - total} acciones con condición dentro de una ruta.`,
    sinRegla.length ? `**${sinRegla.length} rutas con un guardia sin clasificar.**` : 'Ningún guardia sin clasificar.',
    '',
    '**Cómo leerlo.** «Qué la protegía» es lo que había en el código antes de #423 (congelado en `inventario/antes-423.json`): `roleGuard` dejaba pasar',
    'además a superadmin y a soporte; `soloRoles` no. «Quién podía» lo calcula',
    'la copia congelada de esas reglas (`inventario/legado.js`) para cada rol, sin casillas',
    'ni excepciones, y dice qué casilla abre la puerta a quien no entra por su rol. El',
    'alcance —qué campus, qué prospectos— no cambia quién entra y va al final.',
    '«Permiso» es la clave del catálogo que pide la ruta (el catálogo entero, más abajo).',
    '',
    '# Inventario: cada ruta y cada acción',
    '',
  ];
  for (const [modulo, fs] of porModulo) {
    lineas.push(`## ${modulo}`, '', '| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |', '|---|---|---|---|---|');
    for (const f of fs) {
      const accion = f.tipo === 'condicion' ? `${f.controlador} · ${f.condicion}` : (f.controlador || '(anónima)');
      lineas.push(`| ${celda(accion)} | \`${f.metodo} ${celda(f.ruta)}\` | ${celda(protegeHoy(f))} | ${celda(quienPuede(f))} | ${celda(permisoDe(f))} |`);
    }
    lineas.push('');
  }
  lineas.push(...catalogoEnMarkdown());
  lineas.push('## Dentro del código, que ya preguntan a un permiso', '', '| Módulo | Dónde | Qué decide |', '|---|---|---|');
  for (const a of YA_CON_PERMISO) lineas.push(`| ${celda(a.modulo)} | ${celda(a.donde)} | ${celda(a.que)} |`);
  lineas.push('');
  lineas.push('## Alcance: sobre qué datos (no son permisos)', '', '| Módulo | Dónde | Qué decide |', '|---|---|---|');
  for (const a of ALCANCE) lineas.push(`| ${celda(a.modulo)} | ${celda(a.donde)} | ${celda(a.que)} |`);
  lineas.push('');
  return lineas.join('\n');
}

/** Lo que se guarda en `inventario.json`: sin la ruta base repetida. */
export function inventarioEnJson(filas) {
  return JSON.stringify(filas.map(({ ruta_base: _base, ...f }) => f), null, 1) + '\n';
}
