// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Links de pago: la moneda de cada campus y los códigos promocionales (CRM-ISEIE#661, gemela de CRM#986).
 *
 * Diego, 21/11/2026: «El link sale en la moneda del campus (MXN, COP, CLP…), con
 * el precio del curso en esa moneda cuando lo haya» y «códigos promocionales de
 * Stripe en el link, con fecha límite, para campañas».
 *
 *   · el asistente: la moneda sale la del curso (con su precio) o la del campus,
 *     y la gestora la puede cambiar; en CLP, sin decimales; las cuotas, en euros
 *     y se dice; «Admite códigos promocionales» con los vigentes, y se manda;
 *   · Integraciones: el interruptor de los códigos y crear un código de campaña
 *     con su fecha límite;
 *   · la lista: el código que usó el alumno.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put, delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } }, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus México' }] }) }));

const { default: CrearLinkAsistente, monedaPropuesta } = await import('@/modules/links-pago/components/CrearLinkAsistente');
const { default: CodigosPromocionales } = await import('@/modules/links-pago/components/CodigosPromocionales');
const { ReglasDeLosLinks } = await import('@/modules/links-pago/components/ConfigLinksPago');
const { default: LinksDePagoPage } = await import('@/modules/links-pago/pages/LinksDePagoPage');
const { textoDelCodigo } = await import('@/modules/links-pago/api/linksPago.api');

const CONFIG = {
  project_id: 1, descuento_max_pct: 0, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 6, monedas: ['EUR', 'MXN', 'CLP'], moneda_defecto: 'MXN', codigos_promo: true,
};
const CURSOS = [
  { id: 5, nombre: 'Diplomado en Psicología', precio: '20000.00', moneda: 'MXN' },
  { id: 6, nombre: 'Máster en Neuro', precio: '1000.00', moneda: 'EUR' },
  { id: 7, nombre: 'Curso sin precio', precio: null, moneda: 'EUR' },
];
const CODIGOS = [{
  id: 1, project_id: 1, codigo: 'BF20', campana: 'Black Friday', tipo: 'pct', valor: 20, moneda: null,
  caduca_el: '2026-11-30', max_usos: null, activo: true, estado: 'vigente', created_at: '2026-11-23T10:00:00Z',
}];
const LINK = {
  id: 70, project_id: 1, project_nombre: 'Campus México', lead_id: null, conversion_id: null, product_id: 5,
  product_nombre: 'Diplomado en Psicología', created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '20000.00',
  importe: '20000.00', descuento_pct: '0', moneda: 'MXN', modalidad: 'unico', estado: 'creado', codigos_promo: true,
  url: 'https://buy.stripe.com/test_70', caduca_el: '2026-11-30T10:00:00Z', created_at: '2026-11-23T10:00:00Z',
};
let config = CONFIG;

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  config = CONFIG;
  permisos.mapa = { 'links_pago.crear': true };
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') {
      return { success: true, data: [LINK, { ...LINK, id: 71, estado: 'pagado', promo_codigo: 'BF20', promo_descuento: '4000.00' }], pagination: { total: 2, page: 1, limit: 25, totalPages: 1 } };
    }
    if (url.startsWith('/links-pago/config')) return { success: true, data: config };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: { disponible: true, automatico: true, motivo: null, cuotas_max: 6 } };
    if (url === '/links-pago/codigos') return { success: true, data: CODIGOS };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });
});
afterEach(() => cleanup());

const elegir = async (dialogo, nombre) => {
  const lista = await within(dialogo).findByRole('listbox', { name: 'Curso' });
  fireEvent.click(await within(lista).findByRole('button', { name: new RegExp(nombre) }));
};
const abrir = async () => {
  render(<MemoryRouter><CrearLinkAsistente onClose={() => {}} /></MemoryRouter>);
  return screen.findByRole('dialog');
};

describe('la moneda que sale elegida, como el servidor', () => {
  it('la del curso si tiene precio en una moneda del campus; si no, la del campus; desde una venta, euros', () => {
    expect(monedaPropuesta(CONFIG, CURSOS[0])).toBe('MXN');
    expect(monedaPropuesta(CONFIG, CURSOS[1])).toBe('EUR');
    expect(monedaPropuesta(CONFIG, CURSOS[2])).toBe('MXN');
    expect(monedaPropuesta(CONFIG, { precio: 900000, moneda: 'COP' })).toBe('MXN');
    expect(monedaPropuesta(CONFIG, CURSOS[0], true)).toBe('EUR');
  });
  it('lo que descuenta un código, en % o en su moneda', () => {
    expect(textoDelCodigo({ tipo: 'pct', valor: 12.5, moneda: null })).toBe('12,5 %');
    expect(textoDelCodigo({ tipo: 'monto', valor: 50, moneda: 'EUR' }).replace(/\s+/g, ' ')).toBe('50,00 €');
  });
});

describe('el asistente', () => {
  it('el curso en MXN sale en MXN con su precio; uno en EUR, en EUR; la gestora puede cambiarla', async () => {
    const d = await abrir();
    await elegir(d, 'Diplomado en Psicología');
    await vi.waitFor(() => expect(within(d).getByLabelText('Importe').value).toBe('20000'));
    expect(within(d).getByLabelText('Moneda').value).toBe('MXN');
    await elegir(d, 'Máster en Neuro');
    await vi.waitFor(() => expect(within(d).getByLabelText('Moneda').value).toBe('EUR'));
    // Cambiada a mano, ya no sigue al curso.
    fireEvent.change(within(d).getByLabelText('Moneda'), { target: { value: 'MXN' } });
    await elegir(d, 'Curso sin precio');
    expect(within(d).getByLabelText('Moneda').value).toBe('MXN');
  });

  it('en CLP, sin decimales', async () => {
    const d = await abrir();
    await elegir(d, 'Diplomado en Psicología');
    fireEvent.change(within(d).getByLabelText('Moneda'), { target: { value: 'CLP' } });
    fireEvent.change(within(d).getByLabelText('Importe'), { target: { value: '900000,5' } });
    expect(await within(d).findByText(/En CLP el importe va sin decimales/)).toBeTruthy();
  });

  it('con los códigos del campus, el link los admite (con los vigentes a la vista) y se manda; se puede quitar', async () => {
    post.mockResolvedValue({ success: true, data: LINK });
    const d = await abrir();
    await elegir(d, 'Diplomado en Psicología');
    const casilla = await within(d).findByLabelText(/Admite códigos promocionales/);
    expect(casilla.checked).toBe(true);
    expect((await within(d).findByTestId('link-codigos-vigentes')).textContent).toMatch(/BF20 \(−20 %, hasta el 30\/11\/2026\)/);
    fireEvent.click(within(d).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', expect.objectContaining({
      productId: 5, importe: 20000, moneda: 'MXN', codigos_promo: true,
    })));
    expect(await within(d).findByText(/admite códigos promocionales/)).toBeTruthy();
  });

  it('en cuotas no hay códigos y se dice que van en euros', async () => {
    const d = await abrir();
    await elegir(d, 'Máster en Neuro');
    fireEvent.click(within(d).getByRole('radio', { name: /Inicial \+ cuotas/ }));
    expect(await within(d).findByTestId('link-cuotas-en-euros')).toBeTruthy();
    expect(within(d).queryByLabelText(/Admite códigos promocionales/)).toBeNull();
  });

  it('sin códigos en el campus, ni casilla ni se mandan', async () => {
    config = { ...CONFIG, codigos_promo: false };
    post.mockResolvedValue({ success: true, data: { ...LINK, codigos_promo: false } });
    const d = await abrir();
    await elegir(d, 'Diplomado en Psicología');
    await vi.waitFor(() => expect(within(d).getByLabelText('Importe').value).toBe('20000'));
    expect(within(d).queryByLabelText(/Admite códigos promocionales/)).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].codigos_promo).toBeUndefined();
  });
});

describe('Integraciones › Links de pago', () => {
  it('el interruptor de los códigos se guarda con las reglas', async () => {
    config = { ...CONFIG, codigos_promo: false };
    put.mockResolvedValue({ success: true, data: { ...CONFIG, codigos_promo: true } });
    render(<ReglasDeLosLinks projectId={1} />);
    const casilla = await screen.findByLabelText(/Códigos promocionales en los links/);
    fireEvent.click(casilla);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    await vi.waitFor(() => expect(put).toHaveBeenCalledWith('/links-pago/config', { projectId: 1, codigos_promo: true }));
  });

  it('crear un código de campaña con su fecha límite', async () => {
    post.mockResolvedValue({ success: true, data: { ...CODIGOS[0], id: 2, codigo: 'VERANO10' } });
    render(<CodigosPromocionales projectId={1} />);
    expect(await screen.findByText('BF20')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo código/ }));
    const crear = screen.getByRole('button', { name: 'Crear código' });
    expect(crear.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'verano10' } });
    fireEvent.change(screen.getByLabelText('Descuento'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Vale hasta'), { target: { value: '2099-07-31' } });
    fireEvent.change(screen.getByLabelText('Usos máximos'), { target: { value: '100' } });
    await vi.waitFor(() => expect(crear.disabled).toBe(false));
    fireEvent.click(crear);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago/codigos', {
      projectId: 1, codigo: 'VERANO10', tipo: 'pct', valor: 10, caduca_el: '2099-07-31', max_usos: 100,
    }));
  });

  it('sin códigos en el campus, lo dice y no deja crear', async () => {
    config = { ...CONFIG, codigos_promo: false };
    render(<CodigosPromocionales projectId={1} />);
    expect(await screen.findByText(/Este campus no admite códigos/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Nuevo código/ })).toBeNull();
  });
});

describe('la lista de links', () => {
  it('el código que usó el alumno, con lo que descontó; y si un link vivo los admite', async () => {
    render(<MemoryRouter><LinksDePagoPage /></MemoryRouter>);
    expect((await screen.findByTitle('Código promocional que usó el alumno')).textContent.replace(/\s+/g, ' ')).toMatch(/BF20 −4\.?000,00\s?(MX\$|MXN)/);
    expect(screen.getByText('admite códigos')).toBeTruthy();
  });
});
