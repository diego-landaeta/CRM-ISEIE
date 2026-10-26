import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { abrir } from './helpers/migracion222Aparte.js';
import { tareasSinEfectoAntes } from '../src/modules/permissions/inventario/en-uso-antes.js';

/**
 * #423, QA de Diego (22/10) · punto 6: «una gestora con tasks.view_own gana el
 * tablero». Antes de #423 las rutas de Tareas solo dejaban pasar a superadmin,
 * admin y colaborador (roles de más incluidos); `tasks.*` se miraba DENTRO. A
 * una gestora, lo guardado en `tasks.*` no le abría nada. La 239 lo dejaba
 * quieto («clave en uso») y el catálogo se lo abría. Ahora lo archiva, como lo
 * demás que no surtía efecto. A quien sí pasaba la puerta, se le queda.
 */

let m;
const U = {};

async function persona(nombre, role, extra = []) {
  const [u] = await m.q(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra, usa_whatsapp)
     VALUES ($1, $2, 'x', $3, $4::user_role[], true) RETURNING id, role::text AS role, roles_extra::text[] AS roles_extra`,
    [nombre, `${nombre.replace(/\W/g, '')}@tareas423.test`, role, extra]);
  return u;
}

const dar = (u, clave, valor) => {
  const [r, a] = clave.split('.');
  return m.q('INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, $2, $3, $4)', [u.id, r, a, valor]);
};

beforeAll(async () => {
  m = await abrir();
  U.gestora = await persona('Gestora con tareas', 'gestor');
  U.gestoraAdmin = await persona('Gestora y admin', 'gestor', ['admin']);
  U.admin = await persona('Admin sin cerrar', 'admin');
  U.colaborador = await persona('Colaborador', 'colaborador');
  U.soporte = await persona('Soporte con tareas', 'soporte');
  U.deLaFicha = await persona('Gestora de la ficha nueva', 'gestor');
  await dar(U.gestora, 'tasks.view_own', true);
  await dar(U.gestora, 'tasks.close', true);
  await dar(U.gestoraAdmin, 'tasks.manage', false);
  await dar(U.admin, 'tasks.close', false);
  await dar(U.colaborador, 'tasks.create', true);
  await dar(U.soporte, 'tasks.view_all', true);
  // Dado DESPUÉS de #423, desde la ficha: es una decisión de alguien, no de antes.
  await dar(U.deLaFicha, 'tasks.view_own', true);
  await m.q(`INSERT INTO permisos_registro (destino_tipo, usuario_id, clave, antes, despues, origen, motivo)
             VALUES ('usuario', $1, 'tasks.view_own', 'como su rol', 'sí', 'ficha_usuario', 'prueba')`, [U.deLaFicha.id]);

  const [gestorBase] = await m.q(`INSERT INTO custom_roles (label, base_role, permissions, active)
    VALUES ('Gestora con tablero', 'gestor', '{"tasks.view_own": true, "leads.export": true}', true) RETURNING id`);
  const [adminBase] = await m.q(`INSERT INTO custom_roles (label, base_role, permissions, active)
    VALUES ('Admin sin cerrar', 'admin', '{"tasks.close": false}', true) RETURNING id`);
  U.rolGestor = gestorBase.id;
  U.rolAdmin = adminBase.id;

  await m.pasar();
  await m.pasar(); // dos veces: no repite nada
}, 60000);

afterAll(async () => { await m?.cerrar(); });

const suyas = (u) => m.q(`SELECT resource || '.' || action AS clave, allowed FROM user_permission_overrides WHERE user_id = $1 ORDER BY 1`, [u.id]);
const archivadas = (u) => m.q(`SELECT clave, valor FROM permisos_inertes_archivo WHERE usuario_id = $1 ORDER BY 1`, [u.id]);

describe('la 239 y las tareas (#423, punto 6)', () => {
  it('a la gestora, lo de tareas no le abría el tablero: se archiva', async () => {
    expect(await suyas(U.gestora)).toEqual([]);
    expect(await archivadas(U.gestora)).toEqual([
      { clave: 'tasks.close', valor: true },
      { clave: 'tasks.view_own', valor: true },
    ]);
  });

  it('a soporte, igual: tampoco pasaba la puerta', async () => {
    expect(await suyas(U.soporte)).toEqual([]);
    expect(await archivadas(U.soporte)).toEqual([{ clave: 'tasks.view_all', valor: true }]);
  });

  it('a quien sí entraba (admin, colaborador, o admin como rol de más) se le queda', async () => {
    expect(await suyas(U.admin)).toEqual([{ clave: 'tasks.close', allowed: false }]);
    expect(await suyas(U.colaborador)).toEqual([{ clave: 'tasks.create', allowed: true }]);
    expect(await suyas(U.gestoraAdmin)).toEqual([{ clave: 'tasks.manage', allowed: false }]);
  });

  it('lo dado desde la ficha nueva no se toca', async () => {
    expect(await suyas(U.deLaFicha)).toEqual([{ clave: 'tasks.view_own', allowed: true }]);
  });

  it('roles a medida: el de base gestora pierde lo de tareas, no lo demás; el de base admin, nada', async () => {
    const [g] = await m.q('SELECT permissions FROM custom_roles WHERE id = $1', [U.rolGestor]);
    const [a] = await m.q('SELECT permissions FROM custom_roles WHERE id = $1', [U.rolAdmin]);
    expect(g.permissions).toEqual({ 'leads.export': true });
    expect(a.permissions).toEqual({ 'tasks.close': false });
  });

  it('la regla de JS (menú, comparación) dice lo mismo que la migración', async () => {
    for (const u of Object.values(U).filter((x) => typeof x === 'object' && x !== U.deLaFicha)) {
      const roles = [u.role, ...u.roles_extra];
      const deTareas = (await archivadas(u)).filter((x) => x.clave.startsWith('tasks.'));
      expect(deTareas.length > 0, `${roles.join('+')}`).toBe(tareasSinEfectoAntes('tasks.view_own', roles) && deTareas.length > 0);
      if (!tareasSinEfectoAntes('tasks.view_own', roles)) expect(deTareas).toEqual([]);
    }
  });
});
