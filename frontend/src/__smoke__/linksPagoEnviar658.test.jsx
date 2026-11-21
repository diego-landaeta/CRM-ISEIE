// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Mandar el link sin copiarlo a mano (gemela de CRM#983, #658; Diego, 21/11/2026).
 *
 *   · el mensaje del link: saludo, curso, importe, caducidad y el link;
 *   · «Copiar mensaje» para todo el mundo; «Enviar por WhatsApp» solo con WhatsApp
 *     conectado en el CRM, y manda el mensaje en la conversación del prospecto;
 *   · desde el chat, «Link de pago» abre el asistente y «Enviar en este chat» lo
 *     manda en esa conversación;
 *   · el link de un link vivo se ve en la lista (no es de un solo uso).
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } }, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus Uno' }] }) }));
vi.mock('@/shared/components/layout/CabeceraContext', () => ({ useCabecera: () => null }));

const { mensajeDelLink } = await import('@/modules/links-pago/lib/mensajeDelLink');
const { default: EnviarLink, _olvidarConexion } = await import('@/modules/links-pago/components/EnviarLink');
const { default: BotonLinkEnChat } = await import('@/modules/links-pago/components/BotonLinkEnChat');
const { default: LinksDePagoCard } = await import('@/modules/links-pago/components/LinksDePagoCard');

const LINK = {
  id: 40, project_id: 1, lead_id: 3, lead_nombre: 'Laura Gómez', conversion_id: null, product_id: 5,
  product_nombre: 'Psicopedagogía', created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '900.00',
  importe: '900.00', descuento_pct: '0', moneda: 'EUR', modalidad: 'unico', estado: 'creado',
  url: 'https://buy.stripe.com/test_40', caduca_el: '2026-11-28T10:00:00Z', pagado_el: null,
  anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-21T10:00:00Z',
};
const CONFIG = { project_id: 1, descuento_max_pct: 0, caducidad_dias: 7, caducidad_max_dias: 30, cuotas_admitidas: false, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR' };
const LEAD = { id: 3, nombre: 'Laura Gómez', email: 'laura@correo.test', telefono: '+34600000000', project_id: 1, producto_interes_id: 5 };
let conectado;
const escribir = vi.fn(async () => {});

beforeEach(() => {
  get.mockReset(); post.mockReset(); escribir.mockClear();
  _olvidarConexion();
  conectado = false;
  permisos.mapa = { 'links_pago.crear': true, 'whatsapp.usar': true };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true });
  get.mockImplementation(async (url) => {
    if (String(url).startsWith('/whatsapp/conexion')) return { success: true, data: { configurado: true, conectado } };
    if (url === '/links-pago') return { success: true, data: [LINK] };
    if (url === '/links-pago/ventas-del-prospecto') return { success: true, data: { lead: LEAD, ventas: [] } };
    if (String(url).startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: { disponible: false, motivo: 'no', cuotas_max: 12 } };
    if (url === '/products') return { success: true, data: [{ id: 5, nombre: 'Psicopedagogía', precio: '900.00', moneda: 'EUR' }] };
    return { success: true, data: [] };
  });
});
afterEach(cleanup);

describe('el mensaje del link', () => {
  it('saludo, curso, importe, caducidad y el link', () => {
    const m = mensajeDelLink(LINK);
    expect(m).toContain('Hola Laura, te paso el link de pago de Psicopedagogía: 900,00');
    expect(m).toContain('hasta el 28/11/2026');
    expect(m.split('\n')).toContain('https://buy.stripe.com/test_40');
  });

  it('en cuotas con inicial, lo que paga con el link y que las demás se cobran solas', () => {
    const m = mensajeDelLink({ ...LINK, modalidad: 'cuotas', importe: '1000.00', num_cuotas: 4, importe_cuota: '250.00', importe_inicial: '250.00' });
    expect(m).toContain('la inicial, de 250,00');
    expect(m).toContain('las 3 cuotas siguientes se cobran solas cada mes');
  });
});

describe('«Copiar mensaje» y «Enviar por WhatsApp»', () => {
  it('sin WhatsApp conectado, solo «Copiar mensaje», que copia el link con su mensaje', async () => {
    render(<EnviarLink link={LINK} />);
    const copiar = screen.getByRole('button', { name: /Copiar mensaje/ });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/whatsapp/conexion'));
    expect(screen.queryByRole('button', { name: /Enviar por WhatsApp/ })).toBeNull();
    fireEvent.click(copiar);
    await waitFor(() => expect(escribir).toHaveBeenCalledWith(mensajeDelLink(LINK)));
  });

  it('con WhatsApp conectado, lo manda en la conversación del prospecto, con su mensaje', async () => {
    conectado = true;
    post.mockImplementation(async (url) => (url === '/whatsapp/chats' ? { success: true, data: { id: 9 } } : { success: true, data: { id: 1 } }));
    render(<EnviarLink link={LINK} />);
    fireEvent.click(await screen.findByRole('button', { name: /Enviar por WhatsApp/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/whatsapp/chats/9/enviar', expect.objectContaining({ texto: mensajeDelLink(LINK) })));
    expect(post).toHaveBeenCalledWith('/whatsapp/chats', { leadId: 3, usuarioId: undefined });
  });

  it('sin permiso de WhatsApp no pregunta ni enseña el botón; un link pagado no tiene nada', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    conectado = true;
    const { unmount } = render(<EnviarLink link={LINK} />);
    expect(screen.getByRole('button', { name: /Copiar mensaje/ })).toBeTruthy();
    expect(get).not.toHaveBeenCalledWith('/whatsapp/conexion');
    unmount();
    render(<EnviarLink link={{ ...LINK, estado: 'pagado' }} />);
    expect(screen.queryByRole('button', { name: /Copiar mensaje/ })).toBeNull();
  });

  it('en la ficha, el link vivo se ve y se puede volver a copiar', async () => {
    render(<MemoryRouter><LinksDePagoCard leadId={3} /></MemoryRouter>);
    expect(await screen.findByText('buy.stripe.com/test_40')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copiar mensaje/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^\s*Copiar\s*$/ })).toBeTruthy();
  });
});

describe('«Link de pago» en el chat', () => {
  it('abre el asistente con el prospecto y «Enviar en este chat» lo manda en esa conversación', async () => {
    conectado = true;
    post.mockImplementation(async (url) => (url === '/links-pago' ? { success: true, data: LINK } : { success: true, data: { id: 1 } }));
    render(<MemoryRouter><BotonLinkEnChat leadId={3} conversacionId={77} usuarioId={5} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de pago' }));
    const dialogo = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    fireEvent.click(await within(dialogo).findByRole('button', { name: /Enviar en este chat/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/whatsapp/chats/77/enviar', expect.objectContaining({ texto: mensajeDelLink(LINK, 'Laura Gómez'), usuarioId: 5 })));
    // No abre otra conversación.
    expect(post).not.toHaveBeenCalledWith('/whatsapp/chats', expect.anything());
  });

  it('sin permiso para crear links o sin prospecto, no sale', () => {
    permisos.mapa = { 'whatsapp.usar': true };
    const { unmount } = render(<BotonLinkEnChat leadId={3} conversacionId={77} />);
    expect(screen.queryByRole('button', { name: 'Enviar link de pago' })).toBeNull();
    unmount();
    permisos.mapa = { 'links_pago.crear': true };
    render(<BotonLinkEnChat leadId={null} conversacionId={77} />);
    expect(screen.queryByRole('button', { name: 'Enviar link de pago' })).toBeNull();
  });
});
