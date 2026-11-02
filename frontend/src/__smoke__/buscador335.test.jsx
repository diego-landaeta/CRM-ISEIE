// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * El buscador (Ctrl K) · gemela de CRM#591 (ISEIE #335).
 *
 * Las páginas salen del menú con su mismo filtro, y cada tipo de resultado
 * solo con su permiso efectivo: el de /auth/me con sus excepciones, no el
 * nombre del rol. Y cada resultado lleva a una ruta que existe en App.jsx.
 */
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));

import { crearCan } from '@/shared/hooks/usePermission';
import {
  paginasDelBuscador, queBusca, numeroDeVenta, terminoDeFactura,
  destinoDePersona, destinoDeProducto, destinoDeVenta, destinoDeFactura, destinoDeTarea, destinoDeUsuario,
} from '@/shared/components/ui/CommandPalette';

const permisos = (claves) => Object.fromEntries(claves.map((k) => [k, true]));
const perfil = (role, claves) => {
  const user = { id: 1, role, roles_extra: [] };
  return { user, can: crearCan(user, permisos(claves)) };
};
const rutas = (p) => paginasDelBuscador(p).map((x) => x.to);

const GESTORA = perfil('gestor', ['leads.view', 'leads.create', 'clients.view', 'products.view', 'conversions.view', 'facturas.view']);
const COLABORADOR = perfil('colaborador', ['tasks.view_own', 'facturas_colaborador.subir']);
const TUTOR = perfil('tutor', ['leads.view', 'products.view', 'tutores.mis_cursos']);
const SUPER = { user: { id: 9, role: 'superadmin', roles_extra: [] }, can: crearCan({ id: 9, role: 'superadmin' }, { '*': true }) };

describe('qué busca cada perfil', () => {
  it('una gestora: personas, clientes, productos, ventas y facturas; ni usuarios ni tareas', () => {
    expect(queBusca(GESTORA)).toMatchObject({
      personas: true, clientes: true, productos: true, ventas: true, facturas: true, usuarios: false, tareas: false,
    });
  });

  it('un colaborador: solo sus tareas, nada de personas', () => {
    expect(queBusca(COLABORADOR)).toMatchObject({ personas: false, productos: false, ventas: false, tareas: true, usuarios: false });
  });

  it('un tutor no busca personas ni productos aunque el catálogo le dé leads.view (Diego, 02/11)', () => {
    expect(queBusca(TUTOR)).toMatchObject({ personas: false, productos: false });
  });

  it('una excepción cuenta: una gestora con users.view encuentra usuarios; sin facturas.view, no facturas', () => {
    const conUsuarios = perfil('gestor', ['leads.view', 'users.view']);
    expect(queBusca(conUsuarios).usuarios).toBe(true);
    expect(queBusca(conUsuarios).facturas).toBe(false);
  });
});

describe('las páginas salen del menú', () => {
  it('a una gestora no le salen Contabilidad ni Nóminas', () => {
    const r = rutas(GESTORA);
    expect(r).toContain('/leads');
    expect(r).not.toContain('/payroll');
    expect(r).not.toContain('/accounting/payable');
  });

  it('a un colaborador, solo lo suyo: su tablero y nada de Prospectos', () => {
    const r = rutas(COLABORADOR);
    expect(r).toContain('/tareas');
    expect(r).not.toContain('/leads');
  });

  it('al superadmin le salen las pantallas nuevas del menú', () => {
    const r = rutas(SUPER);
    expect(r).toContain('/accounting/facturas-colaboradores');
    expect(r.length).toBeGreaterThan(20);
  });
});

describe('cada resultado lleva a una ruta que existe', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../App.jsx'), 'utf8');
  const existe = (to) => {
    const ruta = to.split('?')[0];
    return [...app.matchAll(/path="([^"]+)"/g)].some(([, p]) => new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(ruta));
  };
  it.each([
    destinoDePersona({ id: 5, status: 'nuevo' }),
    destinoDePersona({ id: 5, status: 'convertido' }),
    destinoDeProducto({ id: 3 }),
    destinoDeVenta({ id: 8 }),
    destinoDeFactura({ conversion_id: 8 }),
    destinoDeFactura({}),
    destinoDeTarea({ id: 2 }),
    destinoDeUsuario({}),
  ])('%s', (to) => expect(existe(to)).toBe(true));
});

describe('números', () => {
  it('una venta por su número y una factura sin la «F-»', () => {
    expect(numeroDeVenta('#1234')).toBe('1234');
    expect(numeroDeVenta('ana')).toBeNull();
    expect(terminoDeFactura('F-2026/0641')).toBe('2026/0641');
  });
});
