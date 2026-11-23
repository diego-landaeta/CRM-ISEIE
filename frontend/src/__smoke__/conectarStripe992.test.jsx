// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * «Conectar Stripe para cobros automáticos» (CRM#992).
 *
 * Diego, 21/11/2026: «todos deben tenerlo, y el que no, que salga un anuncio:
 * conectar Stripe para cobros automáticos, y al tocarlo que los mande al sitio de
 * edición».
 *
 *   · El asistente «Crear link»: si las cuotas no se pueden cobrar solas por la
 *     clave (sin clave, o sin permiso de suscripciones), «Inicial + cuotas» sigue
 *     (desde el 23/11, cada cuota con su link) y sale el aviso con su motivo y el
 *     botón a Integraciones › Links de pago de ese campus; si es el interruptor
 *     del servidor, solo que no está activo aquí; si es otra cosa, el motivo.
 *   · La pantalla «Links de pago»: arriba, los campus del ámbito en esa situación.
 *   · Sin `integrations.edit` (el permiso de la clave) no hay botón: «Pídeselo a
 *     un administrador».
 *   · Integraciones abre en el campus (`?campus=N`) y marca la tarjeta de links
 *     (`&seccion=links-pago`).
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } }, permissions: null }) }));
const ctx = vi.hoisted(() => ({ valor: {} }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.valor }));
vi.mock('@/shared/components/layout/CabeceraContext', () => ({ useCabecera: () => null }));

const { default: CrearLinkAsistente } = await import('@/modules/links-pago/components/CrearLinkAsistente');
const { default: LinksDePagoPage } = await import('@/modules/links-pago/pages/LinksDePagoPage');
const {
  default: AvisoConectarStripe, tipoDeAviso, rutaDeLaClave,
} = await import('@/modules/links-pago/components/AvisoConectarStripe');
const { default: IntegrationsPage } = await import('@/modules/accounting/pages/IntegrationsPage');

const RUTA = '/accounting/integrations?campus=1&seccion=links-pago';
const CONFIG = {
  project_id: 1, descuento_max_pct: 15, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 6, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const SIN_PERMISO = 'La clave de links de pago de este campus no tiene permiso de suscripciones: en Stripe le faltan Subscription Schedules.';
const SIN_CLAVE = 'Este campus no tiene la clave de links de pago de Stripe: sin ella no se pueden cobrar las cuotas solas.';

let cuotas;
let config;
let conectar;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true, 'links_pago.cobro_automatico': true, 'integrations.edit': true };
  ctx.valor = { activeProject: { id: 1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus Uno' }] };
  cuotas = { disponible: true, codigo: null, motivo: null, cuotas_max: 6 };
  config = CONFIG;
  conectar = { activo: true, codigo: null, motivo: null, campus: [] };
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 1 } };
    if (url.startsWith('/links-pago/config')) return { success: true, data: config };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: cuotas };
    if (url === '/links-pago/conectar-stripe') return { success: true, data: conectar };
    if (url === '/products') return { success: true, data: [{ id: 5, nombre: 'Máster en Psicología', precio: '1000.00', moneda: 'EUR' }] };
    return { success: true, data: [] };
  });
});
afterEach(() => cleanup());

// La forma de pago sale al elegir el curso (con la clave del campus en orden).
const abrir = async ({ conCurso = true, ...props } = {}) => {
  const onClose = vi.fn();
  render(<MemoryRouter><CrearLinkAsistente onClose={onClose} {...props} /></MemoryRouter>);
  const dialogo = await screen.findByRole('dialog');
  if (conCurso) {
    const lista = await within(dialogo).findByRole('listbox', { name: 'Curso' });
    fireEvent.click(await within(lista).findByRole('button', { name: /Máster en Psicología/ }));
  }
  return { dialogo, onClose };
};

describe('el aviso, solo', () => {
  it('qué aviso toca a cada motivo y adónde lleva', () => {
    expect(tipoDeAviso('sin_clave')).toBe('conectar');
    expect(tipoDeAviso('clave_sin_permiso')).toBe('conectar');
    expect(tipoDeAviso('apagado_entorno')).toBe('entorno');
    for (const c of ['campus_no_permitido', 'sin_permiso', 'cuotas_no_admitidas', 'stripe_no_contesta', null, undefined]) {
      expect(tipoDeAviso(c)).toBeNull();
    }
    expect(rutaDeLaClave(7)).toBe('/accounting/integrations?campus=7&seccion=links-pago');
  });

  it('sin clave: «Conectar Stripe», que lleva a la clave de ese campus', () => {
    render(<MemoryRouter><AvisoConectarStripe campus={[{ project_id: 7, codigo: 'sin_clave', motivo: SIN_CLAVE }]} /></MemoryRouter>);
    const aviso = screen.getByTestId('aviso-conectar-stripe');
    expect(aviso.textContent).toMatch(/Conectar Stripe para cobros automáticos/);
    expect(aviso.textContent).toContain(SIN_CLAVE);
    expect(within(aviso).getByRole('link', { name: /Conectar Stripe/ }).getAttribute('href')).toBe('/accounting/integrations?campus=7&seccion=links-pago');
  });

  it('clave sin permiso: «Cambiar la clave de Stripe»', () => {
    render(<MemoryRouter><AvisoConectarStripe campus={[{ project_id: 7, codigo: 'clave_sin_permiso', motivo: SIN_PERMISO }]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Cambiar la clave de Stripe/ }).getAttribute('href')).toBe('/accounting/integrations?campus=7&seccion=links-pago');
    expect(screen.getByTestId('aviso-conectar-stripe').textContent).toContain(SIN_PERMISO);
  });

  it('sin el permiso de la clave: el aviso, sin botón, y a quién pedírselo', () => {
    permisos.mapa = { 'links_pago.crear': true };
    render(<MemoryRouter><AvisoConectarStripe campus={[{ project_id: 7, codigo: 'sin_clave', motivo: SIN_CLAVE }]} /></MemoryRouter>);
    const aviso = screen.getByTestId('aviso-conectar-stripe');
    expect(aviso.textContent).toMatch(/Pídeselo a un administrador/);
    expect(within(aviso).queryByRole('link')).toBeNull();
    expect(within(aviso).queryByRole('button')).toBeNull();
  });

  it('otro motivo: no sale', () => {
    render(<MemoryRouter><AvisoConectarStripe campus={[{ project_id: 7, codigo: 'campus_no_permitido', motivo: 'x' }]} /></MemoryRouter>);
    expect(screen.queryByTestId('aviso-conectar-stripe')).toBeNull();
  });
});

// Las cuotas sin cobro automático (23/11) se eligen igual: el aviso sale al elegirlas.
const elegirCuotas = async (dialogo) => {
  const radio = await within(dialogo).findByRole('radio', { name: /Inicial \+ cuotas/ });
  await vi.waitFor(() => expect(within(dialogo).getByText(/cada cuota, con su link/)).toBeTruthy());
  expect(radio.disabled).toBe(false);
  fireEvent.click(radio);
};
const sinAuto = (codigo, motivo) => ({ disponible: true, automatico: false, codigo, motivo, cuotas_max: 6 });

describe('el asistente «Crear link»', () => {
  it('clave sin permiso de suscripciones: las cuotas siguen, con el aviso, y el botón lleva a la clave (y cierra)', async () => {
    cuotas = sinAuto('clave_sin_permiso', SIN_PERMISO);
    const { dialogo, onClose } = await abrir();
    await elegirCuotas(dialogo);
    const aviso = await within(dialogo).findByTestId('aviso-conectar-stripe');
    expect(aviso.textContent).toContain(SIN_PERMISO);
    expect(within(dialogo).getByTestId('aviso-cuotas-sin-auto').textContent).toMatch(/El cobro no será automático: cada cuota tendrá su propio link/);
    expect(within(dialogo).queryByText(/Cuotas no disponibles/)).toBeNull();
    const ir = within(aviso).getByRole('link', { name: /Cambiar la clave de Stripe/ });
    expect(ir.getAttribute('href')).toBe(RUTA);
    fireEvent.click(ir);
    expect(onClose).toHaveBeenCalled();
  });

  it('campus sin clave de links: el aviso una vez, fuera de lo apagado, con su botón', async () => {
    cuotas = sinAuto('sin_clave', SIN_CLAVE);
    config = { ...CONFIG, aviso_clave: { code: 'SIN_CLAVE_DE_LINKS', error: 'Este campus no tiene la clave de links de pago.' } };
    const { dialogo } = await abrir({ conCurso: false });
    await within(dialogo).findByTestId('aviso-conectar-stripe');
    expect(within(dialogo).getAllByTestId('aviso-conectar-stripe')).toHaveLength(1);
    expect(within(dialogo).getByTestId('aviso-conectar-stripe').closest('fieldset')).toBeNull();
    expect(within(dialogo).getByRole('link', { name: /Conectar Stripe/ }).getAttribute('href')).toBe(RUTA);
  });

  it('sin el permiso de la clave: el aviso con «Pídeselo a un administrador», sin botón', async () => {
    permisos.mapa = { 'links_pago.crear': true, 'links_pago.cobro_automatico': true };
    cuotas = sinAuto('sin_clave', SIN_CLAVE);
    const { dialogo } = await abrir();
    await elegirCuotas(dialogo);
    const aviso = await within(dialogo).findByTestId('aviso-conectar-stripe');
    expect(aviso.textContent).toMatch(/Pídeselo a un administrador/);
    expect(within(aviso).queryByRole('link')).toBeNull();
  });

  it('el interruptor del servidor apagado: solo que no está activo en este entorno, sin mandar a editar', async () => {
    cuotas = sinAuto('apagado_entorno', 'El cobro automático de cuotas no está activo en este entorno.');
    const { dialogo } = await abrir();
    await elegirCuotas(dialogo);
    const aviso = await within(dialogo).findByTestId('aviso-cobro-auto-apagado');
    expect(aviso.textContent).toMatch(/no está activo en este entorno/);
    expect(within(dialogo).queryByTestId('aviso-conectar-stripe')).toBeNull();
    expect(within(dialogo).queryByRole('link', { name: /Conectar Stripe|Cambiar la clave/ })).toBeNull();
  });

  it('otro motivo (sin el permiso de cobro automático): las cuotas siguen, con el motivo', async () => {
    cuotas = sinAuto('sin_permiso', 'No tienes el permiso «Cobro automático de cuotas».');
    const { dialogo } = await abrir();
    await elegirCuotas(dialogo);
    expect((await within(dialogo).findByTestId('aviso-cuotas-sin-auto')).textContent).toMatch(/No tienes el permiso/);
    expect(within(dialogo).queryByText(/Cuotas no disponibles/)).toBeNull();
    expect(within(dialogo).queryByTestId('aviso-conectar-stripe')).toBeNull();
  });
});

describe('la pantalla «Links de pago»', () => {
  const CAMPUS = [
    { project_id: 5, nombre: 'ACADEMIA IA', codigo: 'clave_sin_permiso', motivo: SIN_PERMISO },
    { project_id: 7, nombre: 'Campus Siete', codigo: 'sin_clave', motivo: SIN_CLAVE },
  ];
  const pintar = () => render(<MemoryRouter><LinksDePagoPage /></MemoryRouter>);

  it('arriba, los campus del ámbito sin clave o sin permiso, cada uno con su botón a su clave', async () => {
    conectar = { activo: true, codigo: null, motivo: null, campus: CAMPUS };
    pintar();
    const aviso = await screen.findByTestId('aviso-conectar-stripe');
    expect(aviso.textContent).toMatch(/ACADEMIA IA/);
    expect(aviso.textContent).toMatch(/Campus Siete/);
    const enlaces = within(aviso).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(enlaces).toEqual(['/accounting/integrations?campus=5&seccion=links-pago', '/accounting/integrations?campus=7&seccion=links-pago']);
    // Con el ámbito de la pantalla, como la lista.
    expect(get).toHaveBeenCalledWith('/links-pago/conectar-stripe', { params: expect.objectContaining({ projectId: 1 }) });
  });

  it('sin el permiso de la clave: los mismos campus, sin botones', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    conectar = { activo: true, codigo: null, motivo: null, campus: CAMPUS };
    pintar();
    const aviso = await screen.findByTestId('aviso-conectar-stripe');
    expect(within(aviso).queryAllByRole('link')).toHaveLength(0);
    expect(within(aviso).getAllByText(/Pídeselo a un administrador/)).toHaveLength(2);
  });

  it('el interruptor del servidor apagado: que no está activo en este entorno, sin campus ni botones', async () => {
    conectar = { activo: false, codigo: 'apagado_entorno', motivo: 'El cobro automático de cuotas no está activo en este entorno.', campus: [] };
    pintar();
    expect((await screen.findByTestId('aviso-cobro-auto-apagado')).textContent).toMatch(/no está activo en este entorno/);
    expect(screen.queryByTestId('aviso-conectar-stripe')).toBeNull();
  });

  it('todos conectados: no sale nada', async () => {
    pintar();
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('/links-pago/conectar-stripe', expect.anything()));
    expect(screen.queryByTestId('aviso-conectar-stripe')).toBeNull();
    expect(screen.queryByTestId('aviso-cobro-auto-apagado')).toBeNull();
  });
});

describe('Integraciones abre en su clave de links', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  // ISEIE es un solo campus (CRM-ISEIE#667): no se cambia de campus, solo se baja a la tarjeta.
  it('sin ?seccion=links-pago la tarjeta no sale marcada', async () => {
    window.history.pushState({}, '', '/accounting/integrations');
    ctx.valor = { activeProject: { id: 5, nombre: 'ISEIE' }, activeIssuerId: null, isAllProjects: false, projects: [{ id: 5 }] };
    render(<IntegrationsPage />);
    const tarjeta = await screen.findByTestId('integracion-links-pago');
    expect(tarjeta.className).not.toMatch(/ring-2/);
  });

  it('ya en ese campus: la tarjeta de links de pago, marcada', async () => {
    window.history.pushState({}, '', '/accounting/integrations?campus=5&seccion=links-pago');
    ctx.valor = { activeProject: { id: 5, nombre: 'ACADEMIA IA' }, activeIssuerId: null, isAllProjects: false, projects: [{ id: 5 }], switchProject: vi.fn() };
    render(<IntegrationsPage />);
    const tarjeta = await screen.findByTestId('integracion-links-pago');
    expect(tarjeta.className).toMatch(/ring-2/);
    expect(tarjeta.id).toBe('integracion-links-pago');
  });
});
