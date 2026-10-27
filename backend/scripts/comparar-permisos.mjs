// Qué puede hacer cada persona activa, acción por acción: antes y después de
// #423. Diego: «tiene que salir idéntico; lo que cambie a propósito, en una
// lista aparte para que yo lo apruebe uno a uno».
//
//   node scripts/comparar-permisos.mjs                 compara (base ya migrada)
//   node scripts/comparar-permisos.mjs --simular       pasa la 238 y la 239 dentro de
//                                                      una transacción, compara y
//                                                      DESHACE: no cambia nada
//   node scripts/comparar-permisos.mjs --solo-antes [--guardar foto.json]
//                                                      lo de antes, sin comparar
//   --detalle                                          cada diferencia, una a una
//   --guion cambios.sql                                con --simular: además pasa ese
//                                                      SQL (los cambios de datos del día
//                                                      de producción, p. ej. la cuenta de
//                                                      Diego a superadmin) dentro de la
//                                                      misma transacción, que se deshace
//
// «Antes» son las reglas de antes, congeladas (inventario/legado.js) sobre el
// inventario congelado (inventario/antes-423.json), con los permisos de cada
// persona TAL COMO ERAN antes de la 239 (QA de Diego, punto 4):
//   - con --simular, leídos de la base ANTES de pasar la 238 y la 239;
//   - sin él (la 239 ya pasada), rehechos deshaciendo lo que la 239 dejó
//     apuntado: lo archivado vuelve y lo que puso por las casillas se quita.
// «Después», el resolver de verdad (resolver.js) con lo que hay en la base.
// Una diferencia o la explica
// un cambio de `inventario/cambios-aprobados.js` o es un fallo: el script sale
// con código 1.
//
// Sin --simular abre la conexión en solo lectura. Usa DATABASE_URL.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import 'dotenv/config';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };

const inv = await import('../src/modules/permissions/inventario/index.js');
const { perfilDesdeFilas } = await import('../src/modules/permissions/inventario/legado.js');
const { cambioPrevisto, CAMBIOS, CAMBIOS_POR_DATOS, CAMBIOS_DE_MENU, CAMBIOS_DE_REGLA } = await import('../src/modules/permissions/inventario/cambios-aprobados.js');
const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
const { soloEnLaPantallaAntes } = await import('../src/modules/permissions/inventario/en-uso-antes.js');

/** Sin lo guardado sobre claves que antes solo miraba la pantalla. */
const sinPantalla = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !soloEnLaPantallaAntes(k)));

/** Todas las personas activas, con lo de antes (casillas, excepciones) y lo de ahora. */
export async function leerPersonas(client) {
  const { rows: users } = await client.query(`
    SELECT u.id, u.nombre, u.email, u.role::text AS role, COALESCE(u.roles_extra::text[], '{}') AS roles_extra,
           u.active, u.custom_role_id,
           COALESCE(u.factura_manager, false) AS factura_manager,
           COALESCE(u.editar_fechas_factura, false) AS editar_fechas_factura,
           COALESCE(u.gestor_colaboraciones, false) AS gestor_colaboraciones,
           COALESCE((to_jsonb(u) ->> 'usa_mcp')::boolean, false) AS usa_mcp,
           (to_jsonb(u) ->> 'usa_whatsapp')::boolean AS usa_whatsapp
      FROM users u WHERE u.active = true ORDER BY u.id`);
  const { rows: roles } = await client.query('SELECT id, label, base_role, permissions, active FROM custom_roles');
  const { rows: exc } = await client.query('SELECT user_id, resource, action, allowed FROM user_permission_overrides');
  const hay197 = (await client.query(`SELECT to_regclass('public.role_permission_overrides') AS t`)).rows[0].t;
  const ajustes = hay197 ? (await client.query('SELECT role, resource, action, allowed FROM role_permission_overrides')).rows : [];
  return users.map((u) => perfilDesdeFilas(u, {
    customRole: roles.find((r) => r.id === u.custom_role_id) || null,
    excepciones: exc.filter((e) => e.user_id === u.id),
    ajustesRol: ajustes,
  }));
}

/**
 * Las personas como estaban ANTES de la 239, con la 239 ya pasada: se le
 * devuelve a cada una lo que la 239 archivó (`permisos_inertes_archivo`) y se
 * le quita lo que puso por las casillas (`permisos_registro`, origen
 * 'migracion_239'). `null` si la 239 no está pasada (entonces, --simular).
 */
export async function leerPersonasAntesDeLa222(client) {
  const hay = (await client.query(`SELECT to_regclass('permisos_registro') AS r, to_regclass('permisos_inertes_archivo') AS a`)).rows[0];
  if (!hay.r || !hay.a) return null;
  const pasada = (await client.query(`SELECT 1 FROM permisos_registro WHERE origen = 'migracion_239' LIMIT 1`)).rows.length > 0;
  if (!pasada) return null;
  const personas = await leerPersonas(client);
  const { rows: puestas } = await client.query(
    `SELECT usuario_id, clave FROM permisos_registro WHERE origen = 'migracion_239' AND destino_tipo = 'usuario' AND antes = 'como su rol'`);
  const { rows: archivo } = await client.query('SELECT de_donde, usuario_id, custom_role_id, clave, valor FROM permisos_inertes_archivo');
  return personas.map((p) => {
    const excepciones = { ...p.excepciones };
    for (const x of puestas) if (x.usuario_id === p.id) delete excepciones[x.clave];
    for (const x of archivo) if (x.de_donde === 'excepcion' && x.usuario_id === p.id) excepciones[x.clave] = x.valor;
    let customRole = p.custom_role;
    if (customRole) {
      const vuelven = archivo.filter((x) => x.de_donde === 'rol_medida' && x.custom_role_id === customRole.id);
      if (vuelven.length) {
        customRole = { ...customRole, permissions: { ...(customRole.permissions || {}), ...Object.fromEntries(vuelven.map((x) => [x.clave, x.valor])) } };
      }
    }
    return { ...p, excepciones, custom_role: customRole };
  });
}

/** El mapa de ahora de una persona, con alguna parte deshecha para explicar diferencias. */
function mapaDeAhora(p, variante = null) {
  let custom = p.custom_role && variante === 'rolAMedidaActivo' ? { ...p.custom_role, active: true } : p.custom_role;
  if (custom && variante === 'sinClavesDePantalla') custom = { ...custom, permissions: sinPantalla(custom.permissions) };
  return resolverPermisos({
    role: p.role,
    roles_extra: variante === 'sinRolesDeMas' ? [] : p.roles_extra,
    customRole: custom,
    excepciones: variante === 'sinClavesDePantalla' ? sinPantalla(p.excepciones) : p.excepciones,
    ajustesRol: p.ajustesRol,
  }).mapa;
}

/**
 * Compara a todas las personas: `antes`, como estaban antes de la 239;
 * `despues`, como están con ella. Devuelve las diferencias, cada una con el
 * cambio aprobado que la explica (o ninguno).
 */
export async function comparar({ antes: personasAntes, despues: personas }) {
  const filas = (await inv.construirInventario()).filter((f) => inv.ANTES.has(f.id));
  const deAntes = new Map(personasAntes.map((p) => [p.id, p]));
  const diferencias = [];
  for (const p of personas) {
    const pa = deAntes.get(p.id) || p;
    const mapa = mapaDeAhora(p);
    const variantes = {};
    const despuesSin = (fila) => (v) => inv.puedeDespues(p, fila, (variantes[v] ||= mapaDeAhora(p, v)));
    for (const fila of filas) {
      const antes = inv.puedeAntes(pa, fila);
      const despues = inv.puedeDespues(p, fila, mapa);
      if (antes === despues) continue;
      const porRol = [p.role, ...p.roles_extra].map((r) => cambioPrevisto(fila.id, r)).find(Boolean);
      const porDatos = porRol ? null : CAMBIOS_POR_DATOS.find((c) => c.explica({ persona: p, personaAntes: pa, fila, antes, despues, despuesSin: despuesSin(fila) }));
      diferencias.push({ persona: p, personaAntes: pa, fila, antes, despues, cambio: porRol || porDatos || null });
    }
  }
  return { personas, filas, diferencias, sinExplicar: diferencias.filter((d) => !d.cambio) };
}

function informe({ personas, filas, diferencias, sinExplicar }, detalle) {
  const L = [];
  L.push(`${personas.length} personas activas · ${filas.length} acciones · ${personas.length * filas.length} comprobaciones`);
  L.push(`${diferencias.length} diferencias · ${diferencias.length - sinExplicar.length} explicadas por un cambio aprobado · ${sinExplicar.length} SIN EXPLICAR`);
  L.push('');
  const porCambio = new Map();
  for (const d of diferencias) {
    const k = d.cambio?.id || '(sin explicar)';
    if (!porCambio.has(k)) porCambio.set(k, { gana: 0, pierde: 0, personas: new Set() });
    const x = porCambio.get(k);
    x[d.despues ? 'gana' : 'pierde'] += 1;
    x.personas.add(d.persona.email);
  }
  L.push('Por cambio:');
  for (const [k, x] of porCambio) {
    const c = [...CAMBIOS, ...CAMBIOS_POR_DATOS].find((y) => y.id === k);
    L.push(`  ${k}: ${x.personas.size} personas · ${x.gana} acciones de más · ${x.pierde} de menos${c ? ` — ${c.que}` : ''}`);
  }
  // El menú no es una ruta: sus cambios van aparte, pero en la misma lista para Diego.
  L.push('');
  L.push('Cambios del menú (ninguno de acceso: lo que sale ya respondía, lo que se va daba 403):');
  for (const c of CAMBIOS_DE_MENU) {
    L.push(`  ${c.id} — ${c.que}`);
    for (const [perfil, lineas] of Object.entries(c.perfiles)) L.push(`    ${perfil}: ${lineas.join(', ')}`);
  }
  L.push('');
  L.push('Reglas nuevas sobre lo que se manda (la ruta sigue abierta; no salen en la comparación):');
  for (const c of CAMBIOS_DE_REGLA) L.push(`  ${c.id} — ${c.que}`);
  if (detalle || sinExplicar.length) {
    L.push('');
    L.push(detalle ? 'Cada diferencia:' : 'Las que no explica ningún cambio:');
    for (const d of detalle ? diferencias : sinExplicar) {
      L.push(`  ${d.persona.email} (${[d.persona.role, ...d.persona.roles_extra].join('+')}) · ${d.fila.id}: ${d.antes ? 'podía' : 'no podía'} → ${d.despues ? 'puede' : 'no puede'}${d.cambio ? `  [${d.cambio.id}]` : ''}`);
    }
  }
  return L.join('\n');
}

const sinTransaccion = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let codigo = 0;
  let antesDeLa222 = null;
  try {
    if (opcion('--simular')) {
      await client.query('BEGIN');
      // El «antes», de la base tal cual, ANTES de pasar nada.
      antesDeLa222 = await leerPersonas(client);
      for (const m of ['238_permisos_registro.sql', '239_permisos_casillas_a_excepciones.sql']) {
        await client.query(sinTransaccion(fs.readFileSync(path.resolve(aqui, '../migrations', m), 'utf8')));
      }
      const guion = opcion('--guion');
      if (typeof guion === 'string') {
        await client.query(sinTransaccion(fs.readFileSync(path.resolve(guion), 'utf8')));
        console.log(`(con el guion ${path.basename(guion)}, también dentro de la transacción)`);
      }
      console.log('(simulación: el «antes» leído ANTES de pasar la 238 y la 239, dentro de una transacción que se deshace al acabar)\n');
    } else {
      await client.query('BEGIN TRANSACTION READ ONLY');
      antesDeLa222 = await leerPersonasAntesDeLa222(client);
      if (antesDeLa222) {
        console.log('(el «antes», rehecho deshaciendo la 239: lo archivado vuelve, lo de las casillas se quita)\n');
      } else {
        console.log('La 239 no está pasada en esta base: usa --simular para ver qué cambiaría.\n');
        antesDeLa222 = await leerPersonas(client);
      }
    }
    if (opcion('--solo-antes')) {
      const filas = (await inv.construirInventario()).filter((f) => inv.ANTES.has(f.id));
      const personas = antesDeLa222;
      const m = {};
      console.log(`${personas.length} personas activas · ${filas.length} acciones\n`);
      for (const p of personas) {
        m[p.id] = Object.fromEntries(filas.map((f) => [f.id, inv.puedeAntes(p, f)]));
        console.log(`${String(p.id).padEnd(5)} ${[p.role, ...p.roles_extra].join('+').padEnd(16)} ${String(Object.values(m[p.id]).filter(Boolean).length).padStart(4)} acciones   ${p.email}`);
      }
      const guardar = opcion('--guardar');
      if (typeof guardar === 'string') fs.writeFileSync(guardar, JSON.stringify({ cuando: new Date().toISOString(), matriz: m }, null, 1));
    } else {
      const r = await comparar({ antes: antesDeLa222, despues: await leerPersonas(client) });
      console.log(informe(r, Boolean(opcion('--detalle'))));
      codigo = r.sinExplicar.length ? 1 : 0;
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
  process.exit(codigo);
}
