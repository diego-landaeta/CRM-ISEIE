// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Gemela de diego-landaeta/CRM#913 (CRM#859) · Dejar de pedir al servidor lo
 * que el usuario no puede ver. En ISEIE casi siempre hay un campus elegido; el
 * caso de «Todos» (-1) se deja igual, por si llega.
 *
 * Un día en producción (18/11): de 600 a 2.000 `403 SIN_WHATSAPP`, unos 400
 * `400 projectId o projectIds requerido` en `/leads`, de 50 a 140 `403` en
 * `/users` y de 25 a 50 `403 PROJECT_FORBIDDEN` en `/products`. Una prueba por
 * caso; todas fallan con el código de antes.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', async (orig) => ({ ...(await orig()), default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const ctx = vi.hoisted(() => ({ value: {} }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.value }));
const permisos = vi.hoisted(() => ({ value: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.value[k] === true }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: AvisoDeMensaje, _volverAPreguntar } = await import('@/shared/components/layout/AvisoDeMensaje');
const { default: LeadPicker } = await import('@/modules/messages/components/LeadPicker');
const { default: LeadProductsCard } = await import('@/modules/leads/components/lead-detail/LeadProductsCard');
const { pideLeadsSinCampus } = await import('@/shared/api/client');
const { esCampusMio } = await import('@/shared/hooks/useCampusMio');

afterEach(cleanup);

const pedidas = () => get.mock.calls.map(([url, o]) => (o?.params ? `${url}?${new URLSearchParams(o.params)}` : url));

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ success: true, data: [] });
  permisos.value = {};
  ctx.value = { activeProject: { id: 7 }, activeIssuerId: null, projects: [{ id: 7 }, { id: 8 }] };
});

describe('1 · el aviso de mensajes deja de preguntar tras un 403', () => {
  beforeEach(() => { vi.useFakeTimers(); _volverAPreguntar(); });
  afterEach(() => { vi.useRealTimers(); _volverAPreguntar(); });

  it('un 403 SIN_WHATSAPP y no vuelve a preguntar en toda la sesión', async () => {
    const e = Object.assign(new Error('No tienes activado el WhatsApp del CRM.'), { status: 403, data: { code: 'SIN_WHATSAPP' } });
    get.mockRejectedValue(e);
    const { unmount } = render(<MemoryRouter><AvisoDeMensaje /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(get).toHaveBeenCalledTimes(1);
    // Ni al volver a montarlo (otra pantalla del mismo layout).
    unmount();
    render(<MemoryRouter><AvisoDeMensaje /></MemoryRouter>);
    await act(async () => { vi.advanceTimersByTime(60 * 1000); });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('un fallo de conexión no corta: la siguiente vuelta lo reintenta', async () => {
    get.mockRejectedValue(Object.assign(new Error('fetch failed'), { status: undefined }));
    render(<MemoryRouter><AvisoDeMensaje /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('2 · la lista de prospectos nunca sale sin campus', () => {
  it('el cliente no manda `GET /leads` sin un campus válido', () => {
    for (const url of ['/leads?status=nuevo&limit=1', '/leads?projectId=-1&limit=20', '/leads?projectIds=&limit=200', '/leads']) {
      expect(pideLeadsSinCampus(url), url).toBe(true);
    }
    for (const url of ['/leads?projectId=7&limit=20', '/leads?projectIds=7,8&status=nuevo', '/leads/today?projectId=-1', '/leads/123']) {
      expect(pideLeadsSinCampus(url), url).toBe(false);
    }
  });

  it('el cliente de verdad no llega a llamar al servidor (y contesta «sin éxito»)', async () => {
    const real = (await vi.importActual('@/shared/api/client')).default;
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn();
    try {
      const r = await real.get('/leads?status=nuevo&limit=1');
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(r).toMatchObject({ success: false, code: 'SIN_CAMPUS' });
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  it('Mensajes · «Compartir prospecto» con «Todos»: los campus del ámbito, no `projectId=-1`', async () => {
    ctx.value = { activeProject: { id: -1 }, activeIssuerId: null, projects: [{ id: 7 }, { id: 8 }] };
    render(<LeadPicker open onSelect={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(pedidas()[0]).toMatch(/^\/leads\?projectIds=7,8&/);
    expect(pedidas().some((u) => u.includes('projectId=-1'))).toBe(false);
  });

  it('Mensajes · sin ningún campus todavía, no pregunta', async () => {
    ctx.value = { activeProject: { id: -1 }, activeIssuerId: null, projects: [] };
    render(<LeadPicker open onSelect={() => {}} onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('3 y 4 · la tarjeta de programas de la ficha', () => {
  it('sin «Ver usuarios» no pide /users; con él, con alcance comercial', async () => {
    render(<LeadProductsCard leadId={1} projectId={7} isAdmin={false} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(pedidas().some((u) => u.startsWith('/users'))).toBe(false);

    get.mockClear();
    permisos.value = { 'users.view': true };
    render(<LeadProductsCard leadId={1} projectId={7} isAdmin />);
    await waitFor(() => expect(pedidas().some((u) => u.startsWith('/users'))).toBe(true));
    expect(pedidas().find((u) => u.startsWith('/users'))).toMatch(/alcance=comercial/);
  });

  it('el catálogo, solo de un campus suyo', async () => {
    render(<LeadProductsCard leadId={1} projectId={99} isAdmin={false} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(pedidas().some((u) => u.startsWith('/products'))).toBe(false);

    get.mockClear();
    render(<LeadProductsCard leadId={1} projectId={8} isAdmin={false} />);
    await waitFor(() => expect(pedidas().some((u) => u.startsWith('/products?projectId=8'))).toBe(true));
  });

  it('esCampusMio: sus campus, nada mientras carga, y nunca -1', () => {
    expect(esCampusMio([{ id: 7 }], 7)).toBe(true);
    expect(esCampusMio([{ id: 7 }], '7')).toBe(true);
    expect(esCampusMio([{ id: 7 }], 9)).toBe(false);
    expect(esCampusMio([{ id: 7 }], -1)).toBe(false);
    expect(esCampusMio(null, 7)).toBe(false);
  });
});
