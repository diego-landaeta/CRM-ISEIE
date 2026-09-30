import { describe, it, expect } from 'vitest';
import { tieneAccesoMcp } from '@/shared/components/layout/Sidebar';

/*
  Conexión → MCP en el menú. Diego, 28/09: «Roles únicamente que tendrán acceso
  a Claude: súper admin, admin, personas que se le puedes colocar».

  El menú sigue la misma regla que el servidor (`puedeUsarMcp`). Ofrecer en el
  menú lo que la API va a negar es peor que no ofrecerlo.
*/
describe('quién ve Conexión → MCP en el menú', () => {
  it('súper admin y admin, por su rol', () => {
    expect(tieneAccesoMcp('superadmin', {})).toBe(true);
    expect(tieneAccesoMcp('admin', {})).toBe(true);
  });

  it('el resto, solo si se le ha puesto la casilla', () => {
    expect(tieneAccesoMcp('gestor', { usa_mcp: false })).toBe(false);
    expect(tieneAccesoMcp('gestor', { usa_mcp: true })).toBe(true);
    expect(tieneAccesoMcp('project_manager', { usa_mcp: true })).toBe(true);
  });

  it('soporte NO lo ve sin casilla, aunque en el resto del menú lo vea todo', () => {
    expect(tieneAccesoMcp('soporte', {})).toBe(false);
    expect(tieneAccesoMcp('soporte', { usa_mcp: true })).toBe(true);
  });

  it('un tutor nunca', () => {
    expect(tieneAccesoMcp('tutor', { usa_mcp: true })).toBe(false);
  });

  it('sin datos de la persona, no', () => {
    expect(tieneAccesoMcp('gestor', undefined)).toBe(false);
  });
});
