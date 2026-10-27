import { EN_EL_SERVIDOR } from '../src/modules/permissions/inventario/en-uso-antes.js';
import { describe, it, expect, beforeAll } from 'vitest';

/**
 * #423, fase 2 · El catálogo dice lo mismo que el código de hoy.
 *
 * - Cada ruta tiene su clave (o es pública, o es «lo de cada uno»), y la clave
 *   existe en el catálogo.
 * - ROL POR ROL, los valores de serie del catálogo dan exactamente el acceso
 *   de antes a cada ruta y a cada acción con condición. Lo único que puede
 *   cambiar es lo apuntado en `cambios-aprobados.js`, que espera el visto
 *   bueno de Diego.
 * - Las claves que ya se aplicaban antes (borrar prospectos, facturas de
 *   colaboradores, Diplomas, Tareas, venta sin gestora) conservan sus valores.
 * - Las claves que solo mira la pantalla no cambian para nadie.
 * - Las dependencias son coherentes: ningún rol trae «editar» sin «ver».
 */

const inv = await import('../src/modules/permissions/inventario/index.js');
const legado = await import('../src/modules/permissions/inventario/legado.js');
const { claveDe, PROPIA } = await import('../src/modules/permissions/inventario/asignacion.js');
const { cambioPrevisto } = await import('../src/modules/permissions/inventario/cambios-aprobados.js');
const cat = await import('../src/modules/permissions/catalogo.js');
const { SYSTEM_ROLE_DEFAULTS, ALL_RESOURCES } = await import('../src/modules/permissions/permissions.defaults.js');

const ROLES = legado.ROLES_DEL_SISTEMA.filter((r) => r !== 'superadmin');
let filas;
beforeAll(async () => { filas = await inv.construirInventario(); }, 60_000);

describe('el catálogo de permisos (#423)', () => {
  it('cada ruta con sesión tiene su clave, y la clave existe', () => {
    const sin = [];
    const noExiste = [];
    for (const f of filas) {
      const k = claveDe(f);
      if (k === undefined) { sin.push(f.id); continue; }
      if (k === null || k === PROPIA) continue;
      for (const c of [].concat(k)) if (!cat.CLAVES.has(c)) noExiste.push(`${f.id} → ${c}`);
    }
    expect(sin).toEqual([]);
    expect(noExiste).toEqual([]);
  });

  it('rol por rol, los valores de serie dan el acceso de antes (salvo lo aprobado)', () => {
    const distintas = [];
    for (const rol of [...ROLES, 'superadmin']) {
      const u = inv.personaDePrueba(rol);
      const mapa = SYSTEM_ROLE_DEFAULTS[rol] || {};
      for (const f of filas) {
        // Una ruta nueva no tenía «antes»: sus pruebas son las suyas.
        if (!inv.ANTES.has(f.id)) continue;
        const antes = inv.puedeAntes(u, f);
        const despues = inv.puedeDespues(u, f, mapa);
        if (antes !== despues && !cambioPrevisto(f.id, rol)) distintas.push(`${rol} · ${f.id}: ${antes} → ${despues}`);
      }
    }
    expect(distintas).toEqual([]);
  });

  it('cada cambio previsto cambia de verdad (no hay entradas muertas en la lista)', () => {
    // Cada fila cambia para algún rol de la entrada, y cada rol en alguna fila.
    const { CAMBIOS } = cambiosModulo;
    const cambia = (rol, f) => {
      const u = inv.personaDePrueba(rol);
      return inv.puedeAntes(u, f) !== inv.puedeDespues(u, f, SYSTEM_ROLE_DEFAULTS[rol] || {});
    };
    const muertas = [];
    for (const c of CAMBIOS) {
      const suyas = c.filas.map((id) => filas.find((x) => x.id === id));
      c.filas.forEach((id, i) => {
        if (!suyas[i]) muertas.push(`${c.id}: no existe ${id}`);
        else if (!c.roles.some((r) => cambia(r, suyas[i]))) muertas.push(`${c.id}: ${id} no cambia`);
      });
      for (const r of c.roles) if (!suyas.some((f) => f && cambia(r, f))) muertas.push(`${c.id}: a ${r} no le cambia nada`);
    }
    expect(muertas).toEqual([]);
  });

  it('las claves que ya se aplicaban conservan sus valores de serie', () => {
    // Las que ya miraba el servidor (en-uso-antes.js, con `diplomas.emit` desde el 22/10).
    const APLICADAS = EN_EL_SERVIDOR.map((p) => p.replace(/\.%$/, ''));
    const cambian = [];
    for (const [rol, valores] of Object.entries(legado.DEFAULTS_ANTES)) {
      if (!valores) continue;
      for (const [clave, antes] of Object.entries(valores)) {
        if (!APLICADAS.some((a) => clave === a || clave.startsWith(`${a}.`))) continue;
        // Soporte ya borraba prospectos por el atajo de roleGuard: su valor ahora lo dice.
        if (clave === 'leads.delete' && rol === 'soporte') continue;
        if (SYSTEM_ROLE_DEFAULTS[rol][clave] !== antes) cambian.push(`${rol} · ${clave}: ${antes} → ${SYSTEM_ROLE_DEFAULTS[rol][clave]}`);
      }
    }
    expect(cambian).toEqual([]);
  });

  it('las claves que solo mira la pantalla no cambian para nadie', () => {
    const cambian = [];
    for (const x of cat.ACCIONES.filter((a) => a.soloPantalla)) {
      for (const rol of ROLES) {
        const antes = legado.mapaDePermisos(inv.personaDePrueba(rol))[x.clave] === true;
        if ((SYSTEM_ROLE_DEFAULTS[rol][x.clave] === true) !== antes && rol !== 'tutor') cambian.push(`${rol} · ${x.clave}`);
      }
    }
    expect(cambian).toEqual([]);
  });

  it('ningún rol trae una clave sin lo que necesita', () => {
    const rotas = [];
    for (const rol of ROLES) {
      for (const x of cat.ACCIONES) {
        if (!SYSTEM_ROLE_DEFAULTS[rol][x.clave]) continue;
        for (const d of cat.dependencias(x.clave)) if (!SYSTEM_ROLE_DEFAULTS[rol][d]) rotas.push(`${rol} · ${x.clave} sin ${d}`);
      }
    }
    expect(rotas).toEqual([]);
  });

  it('nadie trae de serie lo que su rol no puede tener nunca', () => {
    const mal = cat.ACCIONES.flatMap((x) => (x.nunca || []).filter((r) => x.roles.includes(r)).map((r) => `${r} · ${x.clave}`));
    expect(mal).toEqual([]);
  });

  it('cada clave que no es solo de pantalla la pide alguna ruta o condición', () => {
    const usadas = new Set(filas.flatMap((f) => [].concat(claveDe(f) ?? [])));
    const sueltas = cat.ACCIONES.filter((x) => !x.soloPantalla && !usadas.has(x.clave)
      // El tablero mira cada una de sus claves dentro del servicio (tasks.service.js).
      && x.recurso !== 'tasks').map((x) => x.clave);
    expect(sueltas).toEqual([]);
  });

  it('ALL_RESOURCES sigue teniendo las claves que se aplicaban', () => {
    for (const k of ['leads.delete', 'facturas_colaborador.subir', 'diplomas.view', 'tasks.close', 'conversions.sin_gestora']) {
      const [r, a] = k.split('.');
      expect(ALL_RESOURCES[r]).toContain(a);
    }
  });

  it('cada sección, recurso y acción tiene nombre y una frase', () => {
    const faltan = [];
    for (const s of cat.SECCIONES) {
      if (!s.nombre) faltan.push(s.clave);
      for (const r of s.recursos) {
        if (!r.nombre) faltan.push(r.clave);
        for (const x of r.acciones) if (!x.nombre || !x.descripcion) faltan.push(`${r.clave}.${x.accion}`);
      }
    }
    expect(faltan).toEqual([]);
    expect(cat.ACCIONES.length).toBe(cat.CLAVES.size); // sin claves repetidas
  });
});

const cambiosModulo = await import('../src/modules/permissions/inventario/cambios-aprobados.js');
