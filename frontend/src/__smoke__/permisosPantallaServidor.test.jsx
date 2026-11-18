// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
  La pantalla decide por el PERMISO que mira el servidor, no por el rol ni por
  otra clave parecida (descuadres encontrados al escribir el manual, 17/11/2026).

  Gemela de CRM#842 (en ISEIE la pantalla es /webhooks y `canSeeItem` es
  `(item, roles, soloColaboraciones, permisos, can)`).

  Aquí, lo que no necesita montar una pantalla entera: el menú y la ruta de
  Webhooks, el texto de «No volver a escribir», quién configura el
  proceso comercial y el tablero del tutor.
*/

const auth = vi.hoisted(() => ({ user: null, permissions: null, isAuthenticated: false, loading: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, canSeeItem, rutaPermitida } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { rolesDe } = await import('@/shared/lib/roles');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { puedeEditar } = await import('@/modules/proceso/pages/ProcesoPage');
const { default: ProtectedRoute } = await import('@/shared/components/layout/ProtectedRoute');

const mapaDe = (role, excepciones = {}) => resolverPermisos({ role, roles_extra: [], excepciones }).mapa;
const canDe = (role, excepciones) => crearCan({ id: 1, role, roles_extra: [] }, mapaDe(role, excepciones));

function entrada(to) {
  let hallada = null;
  const recorrer = (items) => {
    for (const it of items || []) {
      if (it.to === to && !hallada) hallada = it;
      if (it.children) recorrer(it.children);
    }
  };
  for (const s of NAV_SECTIONS) recorrer(s.items);
  return hallada;
}

describe('Webhooks pide lo que pide el servidor (/api/forms)', () => {
  const webhooks = entrada('/webhooks');
  const ve = (role, excepciones) => canSeeItem(webhooks, rolesDe({ role }), false, {}, canDe(role, excepciones));

  it('el admin y el project manager, con sus permisos de serie, la siguen viendo y abriendo', () => {
    expect(ve('admin')).toBe(true);
    expect(ve('project_manager')).toBe(true);
    expect(rutaPermitida('/webhooks', canDe('admin'))).toBe(true);
    expect(rutaPermitida('/webhooks', canDe('project_manager'))).toBe(true);
  });

  it('con «Ver webhooks» pero sin «Ver formularios» no sale ni se abre: la lista es /api/forms y daba 403', () => {
    const sinFormularios = { 'forms.view': false };
    expect(mapaDe('admin', sinFormularios)['webhooks.view']).toBe(true);
    expect(ve('admin', sinFormularios)).toBe(false);
    expect(rutaPermitida('/webhooks', canDe('admin', sinFormularios))).toBe(false);
  });

  it('sigue pidiendo «Ver webhooks», como aprobó Diego: soporte no la ve', () => {
    expect(ve('soporte')).toBe(false);
    expect(rutaPermitida('/webhooks', canDe('soporte'))).toBe(false);
  });
});

describe('«No volver a escribir» no promete lo que no hay', () => {
  it('no dice «Se puede quitar después»: no hay ruta ni botón para quitarlo', () => {
    const chat = fs.readFileSync(path.resolve(__dirname, '../modules/whatsapp/pages/ChatPage.tsx'), 'utf8');
    const rutas = fs.readFileSync(path.resolve(__dirname, '../../../backend/src/modules/whatsapp/whatsapp.routes.js'), 'utf8');
    // Si algún día hay forma de quitarlo, esta prueba avisa para cambiar el texto.
    expect(rutas).not.toMatch(/delete\(['"]\/chats\/:id\/no-escribir/);
    expect(chat).not.toMatch(/Se puede quitar después/);
    expect(chat).toMatch(/Desde el CRM no se puede deshacer/);
  });
});

describe('Proceso comercial: configura los pasos quien tiene `proceso.configurar_pasos`', () => {
  it('soporte lo trae de serie y puede (antes se le escondía por el rol)', () => {
    expect(puedeEditar(canDe('soporte'))).toBe(true);
  });
  it('admin sí; al admin al que se le quita, no; la gestora, no', () => {
    expect(puedeEditar(canDe('admin'))).toBe(true);
    expect(puedeEditar(canDe('admin', { 'proceso.configurar_pasos': false }))).toBe(false);
    expect(puedeEditar(canDe('gestor'))).toBe(false);
  });
});

describe('El tutor abre «Mi tablero», que el menú le enseña', () => {
  const abrir = (ruta) => render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/tareas" element={<ProtectedRoute><p>El tablero</p></ProtectedRoute>} />
        <Route path="/leads" element={<ProtectedRoute><p>Prospectos</p></ProtectedRoute>} />
        <Route path="/mis-cursos" element={<p>Mi campus</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it('el menú se lo enseña (tasks.view_own) y la ruta le deja entrar', () => {
    const tablero = entrada('/tareas');
    const tutor = { id: 1, role: 'tutor', roles_extra: [] };
    expect(canSeeItem(tablero, rolesDe(tutor), false, {}, canDe('tutor'))).toBe(true);
    Object.assign(auth, { user: tutor, permissions: mapaDe('tutor'), isAuthenticated: true });
    abrir('/tareas');
    expect(screen.getByText('El tablero')).toBeTruthy();
  });

  it('lo que no es suyo sigue llevándole a «Mi campus»', () => {
    Object.assign(auth, { user: { id: 1, role: 'tutor', roles_extra: [] }, permissions: mapaDe('tutor'), isAuthenticated: true });
    abrir('/leads');
    expect(screen.getByText('Mi campus')).toBeTruthy();
  });
});
