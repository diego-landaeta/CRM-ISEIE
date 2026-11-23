// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/**
 * Gemela de diego-landaeta/CRM#755 (#690 del 360) · Un solo apartado
 * «Webhooks» (Diego, 05/11): todos juntos, señalados por su función, con los
 * permisos de cada uno. Solo frontal: cada tipo se lee con el GET que ya usa su
 * pantalla. En ISEIE siempre hay un campus elegido arriba.
 */

const { cabecera, get, permisos } = vi.hoisted(() => ({
  cabecera: { value: {} },
  get: vi.fn(),
  permisos: { value: null },
}));

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => cabecera.value }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'superadmin' }, projects: [], permissions: null }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({
    can: (p) => (permisos.value ? permisos.value.includes(p) : true),
    tieneRol: () => true,
    llevaEquipo: false,
  }),
}));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, API_BASE_URL: '/api' }));

import { TIPOS, GRUPOS, tiposVisibles, porCampus, ordenarFilas, crearPedidor, campusDelTipo } from '@/modules/webhooks/lib/resumen';
import { pestanasDe } from '@/modules/webhooks/lib/pestanas';
import { TRASLADOS_DE_MENU, aplicarTraslados } from '@/shared/components/layout/trasladosDeMenu';
import { NAV_SECTIONS, PERMISOS_WEBHOOKS, rutaPermitida } from '@/shared/components/layout/Sidebar';
import WebhooksResumenPage from '@/modules/webhooks/pages/WebhooksResumenPage';
import RedirigirAWebhooks from '@/modules/webhooks/components/RedirigirAWebhooks';

afterEach(cleanup);

const RESPUESTAS = (url) => {
  const [ruta, q = ''] = url.split('?');
  const p = new URLSearchParams(q);
  if (ruta === '/forms' && p.get('kind') === 'webhook') return [{ id: 11, nombre: 'Zapier ventas', active: true }];
  if (ruta === '/forms') return [];
  if (ruta === '/forms/11/events') return [{ status: 'error', error_message: 'Falta el email', created_at: '2026-11-08T10:00:00Z' }];
  if (ruta === '/make-webhooks') return [{ id: 21, label: 'Leads Meta', slug: 'mk_1', active: false, mode: 'active', last_received_at: '2026-11-07T09:00:00Z', last_error: null }];
  if (ruta === '/webhooks-salientes') return [{ id: 31, nombre: 'Make cobros', activo: true, ambito: 'empresa', issuer_id: 7, project_id: null, proyecto: null, empresa: 'ISEIE', ultimo_envio_at: null, fallidos_30_dias: 2 }];
  return [];
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url) => Promise.resolve({ success: true, data: RESPUESTAS(url) }));
  permisos.value = null;
  cabecera.value = { activeProject: { id: 1, nombre: 'ISEIE', sociedad_emisora_id: 7 }, projects: [] };
});

describe('un solo apartado en el menú', () => {
  const entradas = NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i, ...(i.children || [])]));

  it('«Webhooks» está en Configuración (antes Conexión) y las entradas sueltas ya no', () => {
    // «Conexión» pasó a «Configuración» con el reparto por bloques (gemela de CRM#900).
    const conexion = NAV_SECTIONS.find((s) => s.label === 'Configuración');
    expect(conexion.items.some((i) => i.to === '/conexion/webhooks')).toBe(true);
    for (const vieja of ['/webhooks', '/make-webhooks', '/conexion/webhook-transferencias']) {
      expect(entradas.some((i) => i.to === vieja), vieja).toBe(false);
    }
  });

  it('la entrada pide los permisos de las tres que sustituye, ni uno más', () => {
    expect(new Set(PERMISOS_WEBHOOKS)).toEqual(new Set(TRASLADOS_DE_MENU[0].de.map((d) => d.permiso)));
    expect(rutaPermitida('/conexion/webhooks', (p) => p === 'make.view')).toBe(true);
    expect(rutaPermitida('/conexion/webhooks', () => false)).toBe(false);
    const gestora = (p) => ['forms.view', 'widget.view', 'whatsapp.usar', 'integrations.view'].includes(p);
    expect(rutaPermitida('/conexion/webhooks', gestora)).toBe(false);
    const deLosTipos = new Set(TIPOS.flatMap((t) => t.permisos));
    for (const p of PERMISOS_WEBHOOKS) expect(deLosTipos.has(p), p).toBe(true);
  });

  it('cada pestaña pide el permiso que tenía su entrada', () => {
    const solo = (clave) => (p) => p === clave;
    const los = (...claves) => (p) => claves.includes(p);
    expect(rutaPermitida('/conexion/webhooks/make', solo('make.view'))).toBe(true);
    expect(rutaPermitida('/conexion/webhooks/make', solo('webhooks.view'))).toBe(false);
    expect(rutaPermitida('/conexion/webhooks/prospectos', los('webhooks.view', 'forms.view'))).toBe(true);
    expect(rutaPermitida('/conexion/webhooks/prospectos', solo('webhooks.view'))).toBe(false);
    expect(rutaPermitida('/conexion/webhooks/prospectos', solo('forms.view'))).toBe(false);
    expect(rutaPermitida('/conexion/webhooks/transferencias', solo('webhooks_salientes.view'))).toBe(true);
  });

  it('el traslado no cambia el acceso: quien abría una entrada vieja abre la nueva y su pestaña', () => {
    const [t] = TRASLADOS_DE_MENU;
    expect(t.a).toBe('Conexión › Webhooks');
    for (const d of t.de) {
      const solo = (p) => p === d.permiso || [].concat(d.tambienPermiso || []).includes(p);
      expect(PERMISOS_WEBHOOKS, d.entrada).toContain(d.permiso);
      expect(rutaPermitida('/conexion/webhooks', solo), d.entrada).toBe(true);
      expect(rutaPermitida(d.a, solo), d.a).toBe(true);
    }
    expect(aplicarTraslados(['Captación › Make', 'Captación › Email']).sort()).toEqual(['Captación › Email', 'Conexión › Webhooks']);
    expect(aplicarTraslados(['Captación › Email'])).toEqual(['Captación › Email']);
  });

  it('las pestañas de Prospectos y Make no salen con su módulo apagado en el campus', () => {
    expect(pestanasDe(null).map((t) => t.label)).toEqual(['Resumen', 'Prospectos', 'Make', 'Transferencias']);
    expect(pestanasDe({ make: false, webhooks: false }).map((t) => t.label)).toEqual(['Resumen', 'Transferencias']);
  });
});

describe('cada tipo, en su grupo y por su permiso', () => {
  it('todo tipo tiene un grupo que existe, y cada grupo tiene alguno', () => {
    const grupos = new Set(GRUPOS.map((g) => g.id));
    for (const t of TIPOS) expect(grupos.has(t.grupo)).toBe(true);
    for (const g of GRUPOS) expect(TIPOS.some((t) => t.grupo === g.id)).toBe(true);
  });

  it('están las entradas y salidas de ISEIE (sin la clave del campus, que aquí no tiene pantalla)', () => {
    expect(TIPOS.map((t) => t.id).sort()).toEqual([
      'admision', 'admision-webhooks', 'asignacion', 'certifex', 'consultas', 'formularios', 'make',
      'prospectos', 'stripe', 'tokens', 'transferencias', 'whatsapp', 'widget', 'woocommerce',
    ]);
  });

  it('cada enlace es una dirección de ISEIE, no del 360', () => {
    for (const t of TIPOS) {
      expect(t.enlace, t.id).not.toMatch(/^\/(clientes|finanzas|productos|prospectos)\//);
      expect(t.enlace, t.id).not.toBe('/captacion');
    }
  });

  it('quien no tiene el permiso de un tipo no lo ve', () => {
    expect(tiposVisibles((p) => p === 'make.view').map((t) => t.id)).toEqual(['make']);
  });

  it('prospectos pide además leer formularios, que es lo que pide su GET', () => {
    expect(tiposVisibles((p) => ['webhooks.view', 'forms.view'].includes(p)).map((t) => t.id)).toEqual(['prospectos', 'admision-webhooks', 'formularios', 'tokens']);
  });

  it('un campus con el módulo apagado no se pide para ese tipo', () => {
    const make = TIPOS.find((t) => t.id === 'make');
    const campus = [{ id: 1, nombre: 'A', modules: { make: false } }, { id: 2, nombre: 'B', modules: {} }];
    expect(campusDelTipo(make, campus).map((c) => c.id)).toEqual([2]);
  });
});

describe('campus a campus, sin tumbar la tarjeta', () => {
  it('un campus que falla sale como fila «no se pudo leer», no como fallo', async () => {
    const filas = await porCampus([{ id: 4, nombre: 'C4' }], async () => { throw Object.assign(new Error('x'), { status: 403 }); });
    expect(filas[0]).toMatchObject({ campus: 'C4', nombre: 'No se pudo leer', sinLeer: 'No tienes permiso para ver este campus' });
    expect(filas[0].fallo).toBeUndefined();
  });

  it('el pedidor, cancelado, no pide más', async () => {
    const corte = new AbortController();
    const cortado = crearPedidor(2, corte.signal);
    corte.abort();
    await expect(cortado('/y')).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('primero lo que falla, al final lo apagado', () => {
    const f = (clave, extra) => ({ clave, nombre: clave, activo: true, enlace: '/', ...extra });
    expect(ordenarFilas([f('apagado', { activo: false }), f('bien'), f('roto', { fallo: 'x' })]).map((x) => x.clave)).toEqual(['roto', 'bien', 'apagado']);
  });
});

describe('el resumen del campus de arriba', () => {
  const abrir = () => render(<MemoryRouter><WebhooksResumenPage /></MemoryRouter>);

  it('pide lo del campus elegido', async () => {
    abrir();
    await screen.findByText(/Leads Meta/);
    expect(get.mock.calls.map((c) => c[0])).toContain('/make-webhooks?projectId=1');
    expect(get.mock.calls.map((c) => c[0])).toContain('/webhooks-salientes?projectId=1');
  });

  it('cada tarjeta dice su dirección, su estado, el último aviso y si falló', async () => {
    abrir();
    const prospectos = await screen.findByTestId('tipo-prospectos');
    await within(prospectos).findByText('Zapier ventas');
    expect(within(prospectos).getByText('Entra al CRM')).toBeTruthy();
    expect(within(prospectos).getByText('Activo')).toBeTruthy();
    expect(within(prospectos).getByText(/Último aviso/)).toBeTruthy();
    expect(within(prospectos).getByText(/Falló: Falta el email/)).toBeTruthy();
    expect(within(prospectos).getByText('Zapier ventas').closest('a').getAttribute('href')).toBe('/conexion/webhooks/prospectos/11');

    const make = screen.getByTestId('tipo-make');
    await within(make).findByText(/Leads Meta/);
    expect(within(make).getByText('Apagado')).toBeTruthy();

    const salida = screen.getByTestId('tipo-transferencias');
    await within(salida).findByText('Make cobros');
    expect(within(salida).getByText('Sale del CRM')).toBeTruthy();
  });

  it('«Configurar» lleva a la pantalla de ISEIE', async () => {
    abrir();
    const stripe = await screen.findByTestId('tipo-stripe');
    expect(within(stripe).getByRole('link', { name: 'Configurar Pagos de Stripe' }).getAttribute('href')).toBe('/accounting/integrations');
    const woo = screen.getByTestId('tipo-woocommerce');
    expect(within(woo).getByRole('link', { name: 'Configurar Pedidos de WooCommerce' }).getAttribute('href')).toBe('/woocommerce');
  });

  it('Make: un escenario cuya última entrega se rechazó sale como fallo', async () => {
    get.mockImplementation((url) => Promise.resolve({
      data: url.startsWith('/make-webhooks?projectId=1')
        ? [{ id: 21, label: 'Leads Meta', slug: 'mk_1', active: true, mode: 'active', last_received_at: '2026-11-09T09:00:00Z', last_error: null }]
        : url === '/make-webhooks/21/deliveries?limit=1' ? [{ result: 'rejected', error_message: 'Sin correo ni nombre' }]
          : RESPUESTAS(url),
    }));
    abrir();
    const make = await screen.findByTestId('tipo-make');
    expect(await within(make).findByText(/Falló: Sin correo ni nombre/)).toBeTruthy();
  });

  it('un campus con Make apagado no lo pide', async () => {
    cabecera.value = { activeProject: { id: 2, nombre: 'Otro', modules: { make: false } }, projects: [] };
    abrir();
    await screen.findByTestId('tipo-transferencias');
    expect(screen.queryByTestId('tipo-make')).toBeNull();
    expect(get.mock.calls.some((c) => c[0].startsWith('/make-webhooks'))).toBe(false);
  });

  it('sin el permiso de un tipo, ni se pide ni se enseña', async () => {
    permisos.value = ['make.view'];
    abrir();
    await screen.findByTestId('tipo-make');
    expect(screen.queryByTestId('tipo-prospectos')).toBeNull();
    expect(get.mock.calls.some((c) => c[0].startsWith('/forms'))).toBe(false);
    expect(get.mock.calls.some((c) => c[0].startsWith('/webhooks-salientes'))).toBe(false);
  });

  it('sin campus elegido, lo dice', async () => {
    cabecera.value = { activeProject: { id: null, nombre: 'Sin proyecto' }, projects: [] };
    abrir();
    expect(await screen.findByText('Sin campus que mirar')).toBeTruthy();
    // Lo de un campus no se pide sin campus.
    await waitFor(() => expect(get.mock.calls.some((c) => /projectId=/.test(c[0]))).toBe(false));
  });
});

describe('las direcciones de antes llevan al apartado', () => {
  const Donde = () => { const l = useLocation(); return <p data-testid="donde">{l.pathname}{l.search}</p>; };
  const ir = (desde) => render(
    <MemoryRouter initialEntries={[desde]}>
      <Routes>
        <Route path="/webhooks" element={<RedirigirAWebhooks a="/conexion/webhooks/prospectos" />} />
        <Route path="/webhooks/:id" element={<RedirigirAWebhooks a="/conexion/webhooks/prospectos" />} />
        <Route path="/make-webhooks/:id" element={<RedirigirAWebhooks a="/conexion/webhooks/make" />} />
        <Route path="/conexion/webhook-transferencias" element={<RedirigirAWebhooks a="/conexion/webhooks/transferencias" />} />
        <Route path="*" element={<Donde />} />
      </Routes>
    </MemoryRouter>,
  );

  it.each([
    ['/webhooks?new=1', '/conexion/webhooks/prospectos?new=1'],
    ['/webhooks/42', '/conexion/webhooks/prospectos/42'],
    ['/make-webhooks/7', '/conexion/webhooks/make/7'],
    ['/conexion/webhook-transferencias', '/conexion/webhooks/transferencias'],
  ])('%s → %s', (desde, hasta) => {
    ir(desde);
    expect(screen.getByTestId('donde').textContent).toBe(hasta);
  });
});
