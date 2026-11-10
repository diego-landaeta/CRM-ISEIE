// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

/**
 * El buscador (Ctrl K) · gemela de CRM#591 (ISEIE #335).
 *
 * Las páginas salen del menú con su mismo filtro, y cada tipo de resultado
 * solo con su permiso efectivo: el de /auth/me con sus excepciones, no el
 * nombre del rol. Y cada resultado lleva a una ruta que existe en App.jsx.
 */
// Para el buscador montado (al final): como en la app, el usuario y el
// proyecto son estado, y los permisos pasan por el `crearCan` de verdad.
const { AUTH, PROYECTO, get } = vi.hoisted(() => ({
  AUTH: { user: { id: 1, role: 'superadmin', roles_extra: [] }, permissions: { '*': true }, logout: () => {} },
  PROYECTO: { activeProject: { id: 7, nombre: 'ISEIE' }, projects: [{ id: 7, nombre: 'ISEIE' }] },
  get: (() => { const f = (...a) => f.impl(...a); f.calls = []; f.impl = () => Promise.resolve({ success: true, data: [] }); return f; })(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => AUTH }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => PROYECTO }));
vi.mock('@/shared/api/client', () => ({ default: { get: (url) => { get.calls.push(url); return get.impl(url); } } }));

import { crearCan } from '@/shared/hooks/usePermission';
import { CERTIFEX_PANEL } from '@/shared/lib/certifexPanel';
import CommandPalette, {
  paginasDelBuscador, queBusca, numeroDeVenta, terminoDeFactura, nombreDelMes,
  destinoDePersona, destinoDeProducto, destinoDeVenta, destinoDeFactura, destinoDeTarea, destinoDeUsuario,
  destinoDeTutor, destinoDeFacturaColaborador, destinoDeDiploma, destinoDeCursoMoodle,
} from '@/shared/components/ui/CommandPalette';

const permisos = (claves) => Object.fromEntries(claves.map((k) => [k, true]));
const perfil = (role, claves) => {
  const user = { id: 1, role, roles_extra: [] };
  return { user, can: crearCan(user, permisos(claves)) };
};
const rutas = (p) => paginasDelBuscador(p).map((x) => x.to);

const GESTORA = perfil('gestor', ['leads.view', 'leads.create', 'clients.view', 'products.view', 'conversions.view', 'facturas.view']);
const COLABORADOR = perfil('colaborador', ['tasks.view_own', 'facturas_colaborador.subir']);
// Lo que el catálogo le da hoy al tutor (CRM#591, d99cfb0f): 5 permisos, solo lo suyo.
const TUTOR = perfil('tutor', ['tutores.mis_cursos', 'consultas.atender', 'novedades.view', 'mensajes.usar', 'cuenta.cambiar_correo']);
const ADMIN = perfil('admin', ['leads.view', 'users.view', 'tutores.gestionar', 'facturas_colaborador.ver_todas', 'diplomas.view', 'moodle.view']);
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

  it('un tutor no busca personas, productos, ventas ni facturas: el catálogo ya no se los da (Diego, 03/11)', () => {
    expect(queBusca(TUTOR)).toMatchObject({ personas: false, productos: false, ventas: false, facturas: false });
  });

  it('sin excepción por rol: a un tutor al que se le da leads.view, el buscador le busca personas', () => {
    expect(queBusca(perfil('tutor', ['leads.view'])).personas).toBe(true);
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
    destinoDeTutor({ id: 5, nombre: 'Tomás Ruiz' }),
    destinoDeFacturaColaborador({ id: 2, colaborador_id: 7, periodo: '2026-10' }),
    destinoDeDiploma({ nexpediente: 'E-1', alumno: 'Ana', revocada: false }),
    destinoDeCursoMoodle({ id: 40, nombre: 'Logopedia' }, 1753),
  ])('%s', (to) => expect(existe(to)).toBe(true));
});

describe('tutores, facturas de colaboradores, diplomas y cursos de Moodle (CRM#591)', () => {
  const tipos = (p) => {
    const b = queBusca(p);
    return { tutores: b.tutores, facturasColaborador: b.facturasColaborador, diplomas: b.diplomas, cursosMoodle: b.cursosMoodle };
  };

  it('administración los busca; gestora, colaborador y tutor, no', () => {
    expect(tipos(SUPER)).toEqual({ tutores: true, facturasColaborador: true, diplomas: CERTIFEX_PANEL, cursosMoodle: true });
    expect(tipos(ADMIN)).toEqual({ tutores: true, facturasColaborador: true, diplomas: CERTIFEX_PANEL, cursosMoodle: true });
    const nada = { tutores: false, facturasColaborador: false, diplomas: false, cursosMoodle: false };
    for (const p of [GESTORA, COLABORADOR, TUTOR]) expect(tipos(p)).toEqual(nada);
  });

  it('manda el permiso: a una gestora que gestiona colaboraciones le salen los tutores', () => {
    expect(queBusca(perfil('gestor', ['tutores.gestionar'])).tutores).toBe(true);
  });

  it('cada resultado abre su pantalla ya filtrada, con las rutas de ISEIE', () => {
    expect(destinoDeTutor({ nombre: 'Tomás Ruiz' })).toBe('/tutores?buscar=Tom%C3%A1s%20Ruiz');
    expect(destinoDeFacturaColaborador({ colaborador_id: 7, periodo: '2026-10' }))
      .toBe('/accounting/facturas-colaboradores?vista=historial&colaborador=7&periodo=2026-10');
    expect(destinoDeDiploma({ alumno: 'Ana Gómez', revocada: true })).toBe('/matriculas/diplomas?pestana=revocados&buscar=Ana%20G%C3%B3mez');
    expect(destinoDeDiploma({ alumno: 'Ana', revocada: false })).toContain('pestana=enviados');
    expect(destinoDeCursoMoodle({ nombre: 'Voz' }, 1753)).toBe('/conexion/moodle/1753?estado=todos&q=Voz');
  });

  it('las pantallas de destino leen ese filtro de la dirección', () => {
    const leer = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    expect(leer('modules/tutores/pages/TutoresPage.tsx')).toMatch(/get\('buscar'\)/);
    expect(leer('modules/facturas-colaborador/components/ListaDeFacturas.tsx')).toMatch(/params\.get\('colaborador'\)/);
    expect(leer('modules/certifex/pages/CertifexDiplomasPage.tsx')).toMatch(/params\.get\('buscar'\)/);
  });

  it('el mes de una factura, dicho como en su pantalla', () => {
    expect(nombreDelMes('2026-10')).toBe('Octubre 2026');
    expect(nombreDelMes('raro')).toBe('raro');
  });
});

describe('el buscador, usándolo (CRM#591)', () => {
  afterEach(cleanup);
  // jsdom no trae scrollIntoView: el buscador lo usa para seguir a la fila activa.
  Element.prototype.scrollIntoView ??= () => {};
  const vacio = { success: true, data: [] };
  const urls = () => get.calls;
  beforeEach(() => {
    get.calls.length = 0;
    get.impl = () => Promise.resolve(vacio);
  });

  async function abrirYEscribir(texto) {
    render(<MemoryRouter><CommandPalette /></MemoryRouter>);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); });
    const input = await screen.findByPlaceholderText(/Buscar personas/);
    fireEvent.change(input, { target: { value: texto } });
    return input;
  }

  it('con dos letras, también tutores y facturas de colaboradores; Certifex y Moodle, todavía no', async () => {
    await abrirYEscribir('go');
    await waitFor(() => expect(urls().some((u) => u.startsWith('/tutores/buscar?'))).toBe(true));
    const rutas = urls().map((u) => u.split('?')[0]);
    expect(rutas).toEqual(expect.arrayContaining(['/leads', '/users/buscar', '/tutores/buscar', '/facturas-colaborador/facturas']));
    expect(rutas).not.toContain('/certifex/diplomas');
    expect(rutas).not.toContain('/moodle/cursos');
  });

  it('desde tres letras, también diplomas y cursos de Moodle (sin contar alumnos)', async () => {
    await abrirYEscribir('log');
    await waitFor(() => expect(urls().some((u) => u.startsWith('/moodle/cursos?'))).toBe(true));
    const moodle = urls().find((u) => u.startsWith('/moodle/cursos?'));
    expect(moodle).toContain('proyecto_id=7');
    expect(moodle).toContain('con_alumnos=0');
    if (CERTIFEX_PANEL) expect(urls().some((u) => u.startsWith('/certifex/diplomas?'))).toBe(true);
  });

  it('un Moodle lento no hace esperar a las personas, y su curso llega después', async () => {
    let soltarMoodle;
    get.impl = (url) => {
      if (url.startsWith('/moodle/cursos?')) {
        return new Promise((r) => { soltarMoodle = () => r({ success: true, data: { cursos: [{ id: 40, nombre: 'Logopedia infantil', estado: 'activo' }] } }); });
      }
      if (url.startsWith('/leads?')) return Promise.resolve({ success: true, data: [{ id: 3, nombre: 'Lola Gómez', status: 'nuevo' }] });
      return Promise.resolve(vacio);
    };
    await abrirYEscribir('log');
    expect(await screen.findByText('Lola Gómez')).toBeTruthy();
    expect(screen.queryByText('Logopedia infantil')).toBeNull();
    await act(async () => { soltarMoodle(); await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByText('Logopedia infantil')).toBeTruthy();
    expect(screen.getByText('Lola Gómez')).toBeTruthy();
  });

  it('un Moodle que contesta tarde a «log» no cuela su curso en «lola»', async () => {
    let soltarViejo;
    get.impl = (url) => {
      if (url.startsWith('/moodle/cursos?') && url.includes('texto=log&')) {
        return new Promise((r) => { soltarViejo = () => r({ success: true, data: { cursos: [{ id: 41, nombre: 'Curso Viejo' }] } }); });
      }
      if (url.startsWith('/leads?') && url.includes('search=lola')) return Promise.resolve({ success: true, data: [{ id: 3, nombre: 'Lola Gómez', status: 'nuevo' }] });
      return Promise.resolve(vacio);
    };
    const input = await abrirYEscribir('log');
    await waitFor(() => expect(soltarViejo).toBeTypeOf('function'));
    fireEvent.change(input, { target: { value: 'lola' } });
    expect(await screen.findByText('Lola Gómez')).toBeTruthy();
    await act(async () => { soltarViejo(); await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText('Curso Viejo')).toBeNull();
  });

  it('un tutor encontrado lleva a Tutores filtrada por su nombre', async () => {
    get.impl = (url) => (url.startsWith('/tutores/buscar?')
      ? Promise.resolve({ success: true, data: [{ id: 5, nombre: 'Tomás Ruiz', email: 'tomas@prueba.local' }] })
      : Promise.resolve(vacio));
    await abrirYEscribir('tom');
    expect(await screen.findByText('Tomás Ruiz')).toBeTruthy();
    expect(screen.getByText('Tutores')).toBeTruthy();
  });
});

describe('números', () => {
  it('una venta por su número y una factura sin la «F-»', () => {
    expect(numeroDeVenta('#1234')).toBe('1234');
    expect(numeroDeVenta('ana')).toBeNull();
    expect(terminoDeFactura('F-2026/0641')).toBe('2026/0641');
  });
});
