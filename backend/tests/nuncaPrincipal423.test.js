import { describe, it, expect, beforeAll } from 'vitest';

/**
 * #423, QA de Diego (22/10) · punto 6. Antes de #423, WhatsApp y el MCP los
 * decidía el rol PRINCIPAL: un tutor (o un project manager, para WhatsApp) con
 * otro rol de más seguía sin ellos (`chat.controller.js · usuarioObjetivo`,
 * `mcp.acceso.js · puedeUsarMcp`). Con «los roles de más cuentan en todo» los
 * ganaba sin que nadie lo aprobara. `nuncaPrincipal` lo deja como estaba.
 *
 * Y de serie igual: un rol de más no sumaba nada en WhatsApp ni en el MCP
 * (una gestora que además es admin no supervisaba el WhatsApp de otras):
 * `soloPrincipal`.
 *
 * Se prueban todas las parejas rol principal + rol de más contra las reglas
 * congeladas de antes, en cada ruta de WhatsApp y del MCP.
 */

process.env.LOG_LEVEL = 'silent';
const inv = await import('../src/modules/permissions/inventario/index.js');
const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
const { POR_CLAVE, vetada } = await import('../src/modules/permissions/catalogo.js');

const ROLES = ['admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador'];
let filas;

beforeAll(async () => {
  filas = (await inv.construirInventario()).filter((f) => inv.ANTES.has(f.id) && ['whatsapp', 'mcp'].includes(f.modulo));
}, 60000);

function diferencias(role, extra) {
  const p = inv.personaDePrueba(role, { roles_extra: extra });
  const { mapa } = resolverPermisos({ role, roles_extra: extra });
  return filas.filter((f) => inv.puedeAntes(p, f) !== inv.puedeDespues(p, f, mapa))
    .map((f) => `${f.id}: ${inv.puedeAntes(p, f)} → ${inv.puedeDespues(p, f, mapa)}`);
}

describe('WhatsApp y MCP los sigue decidiendo el rol principal (#423, punto 6)', () => {
  it('hay rutas de los dos módulos que comparar', () => {
    expect(filas.some((f) => f.modulo === 'whatsapp')).toBe(true);
    expect(filas.some((f) => f.modulo === 'mcp')).toBe(true);
  });

  it('un tutor con otro rol de más no gana WhatsApp ni MCP', () => {
    for (const extra of ROLES.filter((r) => r !== 'tutor')) {
      expect(diferencias('tutor', [extra]), `tutor + ${extra}`).toEqual([]);
    }
  });

  it('un project manager o un colaborador con otro rol de más no gana WhatsApp', () => {
    for (const role of ['project_manager', 'colaborador']) {
      for (const extra of ROLES.filter((r) => r !== role)) {
        const wa = diferencias(role, [extra]).filter((d) => d.includes('/api/whatsapp') || d.includes('/api/chat'));
        expect(wa, `${role} + ${extra}`).toEqual([]);
      }
    }
  });

  it('ninguna pareja de roles cambia en WhatsApp ni en el MCP: un rol de más no suma (`soloPrincipal`)', () => {
    // Una gestora que además es admin no supervisa el WhatsApp de otras ni usa el MCP sin
    // la casilla: antes, tampoco.
    for (const role of ROLES) {
      for (const extra of ROLES.filter((r) => r !== role)) {
        expect(diferencias(role, [extra]), `${role} + ${extra}`).toEqual([]);
      }
    }
  });

  it('la gestora que además es tutora conserva su WhatsApp (el rol principal manda)', () => {
    const { mapa } = resolverPermisos({ role: 'gestor', roles_extra: ['tutor'] });
    expect(mapa['whatsapp.usar']).toBe(true);
  });

  it('ni con excepción: `vetada` corta por el rol principal', () => {
    expect(vetada(POR_CLAVE['mcp.usar'], 'tutor', ['admin'])).toBe(true);
    expect(vetada(POR_CLAVE['whatsapp.usar'], 'project_manager', ['gestor'])).toBe(true);
    expect(vetada(POR_CLAVE['whatsapp.usar'], 'gestor', ['tutor'])).toBe(false);
    const { mapa, origenes } = resolverPermisos({ role: 'tutor', roles_extra: ['gestor'], excepciones: { 'mcp.usar': true, 'whatsapp.usar': true } });
    expect(mapa['mcp.usar']).toBe(false);
    expect(mapa['whatsapp.usar']).toBe(false);
    expect(origenes['mcp.usar'].tipo).toBe('nunca');
  });
});
