import { describe, it, expect } from 'vitest';
import { tieneAccesoMcp } from '@/shared/components/layout/Sidebar';
import { crearCan } from '@/shared/hooks/usePermission';

/*
  Conexión → MCP en el menú. Diego, 28/09: «Roles únicamente que tendrán acceso
  a Claude: súper admin, admin, personas que se le puedes colocar».

  El menú sigue la misma regla que el servidor: desde #423, el permiso «Usar el
  MCP» del catálogo. Aquí, con el mapa que le daría el servidor a cada persona
  (su rol, y la casilla de antes convertida en excepción como hace la 222).
  Ofrecer en el menú lo que la API va a negar es peor que no ofrecerlo.
*/
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { excepcionesDeCasillas } = await import('../../../backend/src/modules/permissions/casillas.js');

const can = (role, extra = {}) => {
  const p = { role, ...extra };
  return crearCan(p, resolverPermisos({ role, excepciones: excepcionesDeCasillas(p) }).mapa);
};

describe('quién ve Conexión → MCP en el menú', () => {
  it('súper admin y admin, por su rol', () => {
    expect(tieneAccesoMcp(can('superadmin'))).toBe(true);
    expect(tieneAccesoMcp(can('admin'))).toBe(true);
  });

  it('el resto, solo si se le ha dado «Usar el MCP» (antes, la casilla)', () => {
    expect(tieneAccesoMcp(can('gestor', { usa_mcp: false }))).toBe(false);
    expect(tieneAccesoMcp(can('gestor', { usa_mcp: true }))).toBe(true);
    expect(tieneAccesoMcp(can('project_manager', { usa_mcp: true }))).toBe(true);
  });

  it('soporte NO lo ve sin el permiso, aunque en el resto del menú lo vea casi todo', () => {
    expect(tieneAccesoMcp(can('soporte'))).toBe(false);
    expect(tieneAccesoMcp(can('soporte', { usa_mcp: true }))).toBe(true);
  });

  it('un tutor nunca: su rol no puede tenerlo', () => {
    expect(tieneAccesoMcp(can('tutor', { usa_mcp: true }))).toBe(false);
  });

  it('sin mapa todavía, no', () => {
    expect(tieneAccesoMcp(crearCan({ role: 'gestor' }, null))).toBe(false);
    expect(tieneAccesoMcp(undefined)).toBe(false);
  });
});
