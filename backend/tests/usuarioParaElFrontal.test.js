// Lo que el login le dice al frontal de quien entra tiene que ser lo mismo que
// `/auth/me`, roles añadidos incluidos (Diego, 23/10/2026: «a Yolanda no le salen
// las funciones»). Yolanda es gestora y además tutora; sin `roles_extra` en el
// login entraba como «solo gestora» hasta recargar la página.
//
// Prueba sin base de datos: el modelo se sustituye, solo se mira la forma.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/modules/auth/auth.model.js', () => ({}));
const { usuarioParaElFrontal } = await import('../src/modules/auth/auth.service.js');

describe('usuarioParaElFrontal', () => {
  const fila = {
    id: 11, nombre: 'Yolanda', email: 'y@example.com', role: 'gestor', roles_extra: ['tutor'],
    custom_role_id: null, avatar_url: null, factura_manager: true, editar_fechas_factura: true,
    gestor_colaboraciones: false, usa_mcp: true, password_hash: 'no-debe-salir', set_password_token: 'tampoco',
  };

  it('lleva los roles añadidos (lo que faltaba)', () => {
    expect(usuarioParaElFrontal(fila).roles_extra).toEqual(['tutor']);
  });

  it('lleva las casillas de facturación y el resto, como /auth/me', () => {
    expect(usuarioParaElFrontal(fila)).toMatchObject({
      id: 11, role: 'gestor', custom_role_id: null,
      factura_manager: true, editar_fechas_factura: true, gestor_colaboraciones: false, usa_mcp: true,
    });
  });

  it('nunca la contraseña ni el token de alta', () => {
    const u = usuarioParaElFrontal(fila);
    expect(u).not.toHaveProperty('password_hash');
    expect(u).not.toHaveProperty('set_password_token');
  });

  it('sin roles añadidos (o en texto de Postgres) da una lista vacía, no se rompe', () => {
    expect(usuarioParaElFrontal({ ...fila, roles_extra: null }).roles_extra).toEqual([]);
    expect(usuarioParaElFrontal({ ...fila, roles_extra: undefined }).roles_extra).toEqual([]);
  });
});
