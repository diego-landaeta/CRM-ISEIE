import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { abrir } from './helpers/migracion222Aparte.js';

/**
 * #423, fase 5 · «Nadie gana ni pierde acceso», con gente variada de verdad.
 *
 * Se da de alta un equipo de prueba con todo lo que puede complicarlo —cada
 * casilla, roles de más, roles a medida activos y desactivados (con y sin
 * roles de más), excepciones sobre claves que ya se miraban y sobre claves que
 * no—, se pasa la migración 239 y se compara cada persona, acción por acción,
 * con `comparar()` de `scripts/comparar-permisos.mjs`: lo mismo que se pasa
 * contra producción. Toda diferencia tiene que estar explicada por un cambio
 * de `cambios-aprobados.js`.
 *
 * QA de Diego (22/10):
 *   - punto 4: el «antes» se lee ANTES de pasar la 239 (como --simular), y el
 *     que se rehace con la 239 ya pasada tiene que salir igual;
 *   - punto 9: la 239 se pasa sobre copias temporales de las tablas con solo
 *     este equipo (helpers/migracion222Aparte.js), no sobre la base compartida.
 */

const { comparar, leerPersonas, leerPersonasAntesDeLa222 } = await import('../scripts/comparar-permisos.mjs');

const MARCA = `CMP423_${Date.now().toString(36)}`;
let m;
const q = (sql, p) => m.q(sql, p);
const ids = { users: [], roles: [] };
let n = 0;

async function persona(role, { extra = [], custom = null, casillas = {}, excepciones = {} } = {}) {
  n += 1;
  const c = { factura_manager: false, editar_fechas_factura: false, gestor_colaboraciones: false, usa_mcp: false, usa_whatsapp: true, ...casillas };
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra, custom_role_id,
                        factura_manager, editar_fechas_factura, gestor_colaboraciones, usa_mcp, usa_whatsapp)
     VALUES ($1, $2, 'x', $3, $4::user_role[], $5, $6, $7, $8, $9, $10) RETURNING id`,
    [`${MARCA} ${n}`, `p${n}_${MARCA.toLowerCase()}@test.local`, role, extra, custom,
      c.factura_manager, c.editar_fechas_factura, c.gestor_colaboraciones, c.usa_mcp, c.usa_whatsapp]);
  ids.users.push(u.id);
  for (const [k, v] of Object.entries(excepciones)) {
    const [r, a] = k.split('.');
    await q('INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, $2, $3, $4)', [u.id, r, a, v]);
  }
  return u.id;
}

async function rolAMedida(base, permisos, activo = true) {
  const [r] = await q(`INSERT INTO custom_roles (label, base_role, permissions, active) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} ${base} ${ids.roles.length}`, base, JSON.stringify(permisos), activo]);
  ids.roles.push(r.id);
  return r.id;
}

let resultado;
let antes;
let antesRehecho;

beforeAll(async () => {
  m = await abrir();
  // Cada rol, con y sin cada casilla.
  for (const role of ['admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador']) {
    await persona(role);
    for (const k of ['factura_manager', 'editar_fechas_factura', 'gestor_colaboraciones', 'usa_mcp']) await persona(role, { casillas: { [k]: true } });
    await persona(role, { casillas: { usa_whatsapp: false } });
  }
  // Roles de más.
  await persona('gestor', { extra: ['tutor'] });
  await persona('gestor', { extra: ['admin'] });
  await persona('tutor', { extra: ['gestor'] });
  await persona('colaborador', { extra: ['gestor'] });
  await persona('soporte', { extra: ['admin'] });
  // Punto 6: WhatsApp y el MCP los decide el rol principal.
  await persona('tutor', { extra: ['admin'] });
  await persona('project_manager', { extra: ['gestor'] });
  await persona('colaborador', { extra: ['admin'] });
  // Roles a medida: activo, desactivado, y con roles de más.
  const activo = await rolAMedida('gestor', { 'tasks.close': true, 'leads.delete': true, 'leads.export': true });
  const apagado = await rolAMedida('gestor', { 'diplomas.view': true }, false);
  await persona('gestor', { custom: activo });
  await persona('gestor', { custom: apagado });
  await persona('gestor', { custom: activo, extra: ['admin'] });
  // Excepciones sobre claves que ya se miraban, y sobre claves que no.
  await persona('admin', { excepciones: { 'leads.delete': false } });
  await persona('gestor', { excepciones: { 'leads.delete': true, 'diplomas.view': true } });
  await persona('gestor', { excepciones: { 'facturas_colaborador.ver_todas': true } });
  await persona('gestor', { excepciones: { 'users.view': true, 'reports.view': true } }); // no surtían efecto
  await persona('admin', { excepciones: { 'tasks.close': false } });
  // Punto 6: a una gestora, lo de tareas no le abría el tablero (la 239 lo archiva).
  await persona('gestor', { excepciones: { 'tasks.view_own': true, 'tasks.close': true } });
  // Claves que antes solo miraba la pantalla (punto 5): se quedan y ahora valen
  // también en el servidor (cambio `pantalla-y-servidor`).
  await persona('gestor', { excepciones: { 'leads.assign': true, 'leads.export': true } });
  await persona('admin', { excepciones: { 'products.delete': false } });

  // El «antes», tal cual, antes de pasar nada (lo que hace --simular).
  antes = await leerPersonas(m.cliente);
  await m.pasar();
  await m.pasar(); // dos veces: no cambia nada
  antesRehecho = await leerPersonasAntesDeLa222(m.cliente);
  resultado = await comparar({ antes, despues: await leerPersonas(m.cliente) });
}, 120000);

// Las tablas eran copias temporales: se borran y la base compartida no se entera.
afterAll(async () => { await m?.cerrar(); });

describe('antes y después de #423, persona por persona (#423)', () => {
  it('el «antes» es el de antes de la 239: lo que ella archiva cuenta en el «antes» (punto 4)', () => {
    const g = antes.find((p) => p.excepciones['reports.view'] === true);
    expect(g).toBeTruthy();
    const despues = resultado.personas.find((p) => p.id === g.id);
    // La 239 la archivó, y el «antes» la sigue teniendo.
    expect(despues.excepciones['reports.view']).toBeUndefined();
  });

  it('sin --simular (la 239 ya pasada), el «antes» rehecho sale igual que el leído antes (punto 4)', () => {
    const solo = (lista) => lista.filter((p) => ids.users.includes(p.id))
      .map((p) => ({ id: p.id, excepciones: Object.fromEntries(Object.entries(p.excepciones).sort()), rol: p.custom_role?.permissions || null }));
    expect(solo(antesRehecho)).toEqual(solo(antes));
  });

  it('compara a todo el equipo de prueba', () => {
    const suyas = resultado.personas.filter((p) => ids.users.includes(p.id));
    expect(suyas.length).toBe(ids.users.length);
  });

  it('lo que solo miraba la pantalla y ahora mira también el servidor sale en la lista (punto 5)', () => {
    const ids5 = resultado.diferencias.filter((d) => ids.users.includes(d.persona.id) && d.cambio?.id === 'pantalla-y-servidor')
      .map((d) => `${d.persona.role} ${d.antes ? 'pierde' : 'gana'} ${d.fila.id}`);
    expect(ids5.some((x) => x.startsWith('gestor gana') && x.includes('/leads'))).toBe(true);
    expect(ids5.some((x) => x.startsWith('admin pierde') && x.includes('/products'))).toBe(true);
  });

  it('un rol de más no da WhatsApp ni el MCP: los decide el rol principal (punto 6)', () => {
    const conRolDeMas = resultado.diferencias.filter((d) => ids.users.includes(d.persona.id)
      && d.persona.roles_extra.length > 0 && ['whatsapp', 'mcp'].includes(d.fila.modulo));
    expect(conRolDeMas.map((d) => `${[d.persona.role, ...d.persona.roles_extra].join('+')} · ${d.fila.id}`)).toEqual([]);
  });

  it('toda diferencia la explica un cambio aprobado', () => {
    const sin = resultado.sinExplicar.filter((d) => ids.users.includes(d.persona.id))
      .map((d) => `${[d.persona.role, ...d.persona.roles_extra].join('+')} ${JSON.stringify(d.persona.excepciones)} · ${d.fila.id}: ${d.antes} → ${d.despues}`);
    expect(sin).toEqual([]);
  });

  it('las casillas no cambian nada: quien las tenía puede lo mismo', () => {
    const conCasilla = resultado.diferencias.filter((d) => ids.users.includes(d.persona.id)
      && d.persona.role !== 'superadmin' && d.persona.roles_extra.length === 0 && !d.persona.custom_role
      && (d.persona.factura_manager || d.persona.editar_fechas_factura || d.persona.gestor_colaboraciones || d.persona.usa_mcp || d.persona.usa_whatsapp === false)
      && !['roles-sin-soporte', 'admin-roles-entero', 'roles-a-medida-sin-soporte', 'excepciones-sin-soporte', 'rol-de-otros-con-permiso', 'cola-entera'].includes(d.cambio?.id));
    expect(conCasilla.map((d) => `${d.persona.role} · ${d.fila.id}`)).toEqual([]);
  });
});
