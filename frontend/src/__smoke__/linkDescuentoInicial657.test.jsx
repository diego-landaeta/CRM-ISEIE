// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Links de pago: otro importe, descuento e inicial más cuotas (CRM-ISEIE#657,
 * gemela de CRM#982).
 *
 * Diego, 21/11/2026: «los enlaces de pago poder dar descuentos y poner montos
 * diferentes, y las cuotas, porque un enlace de pago es la inicial y lo otro son
 * las cuotas, no únicamente con el monto del programa. Son dos recorridos».
 *
 *   · Recorrido 1, pago único: el precio sale del catálogo y se cambia; el
 *     descuento en € o en % calcula el total, con el precio de antes a la vista;
 *     el link se pide por el total, con el precio y el descuento para que el
 *     servidor rehaga la cuenta.
 *   · Recorrido 2, inicial + cuotas: sobre el total con descuento, la inicial y
 *     las cuotas de lo que queda, con lo que es cada una (la última ajusta el
 *     céntimo) y desde qué fecha; el link se pide con la inicial.
 *   · Lo que no deja: un descuento que pasa del precio, o del tope del campus, y
 *     una inicial vacía o que no es menor que el total.
 *   · La pantalla «Links de pago»: los dos recorridos como atajos (con su anclaje
 *     del recorrido guiado), y en la lista el precio de antes y el plan.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } }, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus Uno' }] }) }));

const {
  default: CrearLinkAsistente, totalConDescuento, restaCentimos, textoDeLasCuotas, fechasMensuales, resumenDelPlan,
} = await import('@/modules/links-pago/components/CrearLinkAsistente');
const { default: LinksDePagoPage } = await import('@/modules/links-pago/pages/LinksDePagoPage');
const { RECORRIDOS_COBROS } = await import('@/shared/lib/recorridosCobros');

const CONFIG = {
  project_id: 1, descuento_max_pct: 15, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 6, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [{ id: 5, nombre: 'Máster en Psicología', precio: '1000.00', moneda: 'EUR' }];
const LINK = {
  id: 60, project_id: 1, project_nombre: 'Campus Uno', lead_id: null, conversion_id: null, product_id: 5,
  product_nombre: 'Máster en Psicología', created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '1000.00',
  importe: '900.00', descuento_pct: '10', moneda: 'EUR', modalidad: 'unico', estado: 'creado',
  url: 'https://buy.stripe.com/test_60', caduca_el: '2026-11-28T10:00:00Z', created_at: '2026-11-21T10:00:00Z',
  precio_original: '1000.00', descuento_tipo: 'pct', descuento_valor: '10', descuento_importe: '100.00',
};

beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true, 'links_pago.cobro_automatico': true };
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [LINK, { ...LINK, id: 61, modalidad: 'cuotas', num_cuotas: 4, importe_cuota: '300.00', importe_inicial: '300.00' }], pagination: { total: 2, page: 1, limit: 25, totalPages: 1 } };
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: { disponible: true, motivo: null, cuotas_max: 6 } };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });
});
afterEach(() => cleanup());

const abrir = async (props = {}) => {
  render(<MemoryRouter><CrearLinkAsistente onClose={() => {}} {...props} /></MemoryRouter>);
  const dialogo = await screen.findByRole('dialog');
  const lista = await within(dialogo).findByRole('listbox', { name: 'Curso' });
  fireEvent.click(await within(lista).findByRole('button', { name: /Máster en Psicología/ }));
  await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('1000'));
  return dialogo;
};
// Intl separa el importe del € con un espacio duro.
const sinDuros = (t) => t.replace(/\s+/g, ' ');
const crearHabilitado = (d) => vi.waitFor(() => expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('las cuentas, como el servidor', () => {
  it('el descuento en % o en €, al céntimo; si pasa del precio, null', () => {
    expect(totalConDescuento(1000, 'pct', 10)).toEqual({ total: 900, descuento: 100 });
    expect(totalConDescuento(999.99, 'pct', 12.5)).toEqual({ total: 874.99, descuento: 125 });
    expect(totalConDescuento(900, 'monto', 100.5)).toEqual({ total: 799.5, descuento: 100.5 });
    expect(totalConDescuento(900, 'monto', 901)).toBeNull();
    expect(totalConDescuento(900, 'pct', 101)).toBeNull();
  });
  it('lo que queda tras la inicial y el texto de las cuotas, con el céntimo en la última', () => {
    expect(restaCentimos(900, 300.1)).toBe(599.9);
    expect(sinDuros(textoDeLasCuotas([200, 200, 200]))).toBe('3 × 200,00 €');
    expect(sinDuros(textoDeLasCuotas([100, 100, 100, 100, 100, 100.01]))).toBe('5 × 100,00 € y la última de 100,01 €');
    expect(sinDuros(textoDeLasCuotas([600]))).toBe('1 cuota de 600,00 €');
    expect(fechasMensuales('2027-01-31', 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(sinDuros(resumenDelPlan({ importe: 1000, num_cuotas: 4, importe_cuota: 400, importe_inicial: 400 })))
      .toBe('400,00 € de inicial con el link y 3 × 200,00 €, una al mes');
  });
});

describe('recorrido 1 · pago único con otro importe y descuento', () => {
  it('cambia el precio y descuenta un %: el total a la vista, con el precio de antes; pide el link por el total', async () => {
    const d = await abrir();
    fireEvent.change(within(d).getByLabelText('Importe'), { target: { value: '1200' } });
    expect(within(d).getByText(/Precio del catálogo: 1000,00 €|Precio del catálogo: 1\.000,00 €/)).toBeTruthy();
    fireEvent.change(within(d).getByLabelText('Descuento'), { target: { value: '10' } });
    expect(within(d).getByLabelText('Tipo de descuento').value).toBe('pct');
    const total = within(d).getByTestId('link-total');
    const totalTxt = total.textContent.replace(/\s+/g, ' ');
    expect(totalTxt).toMatch(/Total 1\.?080,00 €/);
    expect(totalTxt).toMatch(/precio 1\.?200,00 € menos 120,00 € \(10 %\)/);
    expect(total.querySelector('s').textContent.replace(/\s+/g, ' ')).toMatch(/1\.?200,00 €/);

    post.mockResolvedValue({ success: true, data: { ...LINK, importe: '1080.00', precio_original: '1200.00', descuento_importe: '120.00' } });
    await crearHabilitado(d);
    fireEvent.click(within(d).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      projectId: 1, productId: 5, importe: 1080, precio_original: 1200, descuento_tipo: 'pct', descuento_valor: 10, moneda: 'EUR',
    }));
    expect(await within(d).findByText(/1\.?080,00 € \(precio 1\.?200,00 € menos 120,00 € de descuento\)/)).toBeTruthy();
  });

  it('descuento en €: el total es el precio menos esos euros', async () => {
    const d = await abrir();
    fireEvent.change(within(d).getByLabelText('Tipo de descuento'), { target: { value: 'monto' } });
    fireEvent.change(within(d).getByLabelText('Descuento'), { target: { value: '50,5' } });
    expect(within(d).getByTestId('link-total').textContent.replace(/\s+/g, ' ')).toMatch(/Total 949,50 €/);
    post.mockResolvedValue({ success: true, data: LINK });
    await crearHabilitado(d);
    fireEvent.click(within(d).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', expect.objectContaining({
      importe: 949.5, precio_original: 1000, descuento_tipo: 'monto', descuento_valor: 50.5,
    })));
  });

  it('no deja un descuento que pasa del precio ni del tope del campus', async () => {
    const d = await abrir();
    fireEvent.change(within(d).getByLabelText('Tipo de descuento'), { target: { value: 'monto' } });
    fireEvent.change(within(d).getByLabelText('Descuento'), { target: { value: '1100' } });
    expect(within(d).getByText('El descuento no puede superar el precio.')).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText('Tipo de descuento'), { target: { value: 'pct' } });
    fireEvent.change(within(d).getByLabelText('Descuento'), { target: { value: '20' } });
    expect(within(d).getByText(/Es un 20 % menos que el catálogo; el máximo en este campus es un 15 %/)).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
  });
});

describe('recorrido 2 · inicial más cuotas', () => {
  it('total con descuento, inicial libre y cuotas de lo que queda, con el céntimo en la última y su fecha', async () => {
    const d = await abrir({ formaInicial: 'cuotas' });
    expect(within(d).getByRole('radio', { name: /Inicial \+ cuotas/ }).checked).toBe(true);
    fireEvent.change(within(d).getByLabelText('Descuento'), { target: { value: '10' } });
    // La inicial propuesta: la parte igual de 900 en 4 pagos.
    await vi.waitFor(() => expect(within(d).getByLabelText('Inicial').value).toBe('225'));
    fireEvent.change(within(d).getByLabelText('Inicial'), { target: { value: '299,99' } });
    fireEvent.change(within(d).getByLabelText('Cuotas'), { target: { value: '6' } });
    // Tocada, ya no se recalcula al cambiar las cuotas.
    expect(within(d).getByLabelText('Inicial').value).toBe('299,99');
    const resumen = within(d).getByTestId('link-resumen-cuotas').textContent.replace(/\s+/g, ' ');
    expect(resumen).toMatch(/Quedan 600,01 € en 5 × 100,00 € y la última de 100,01 €/);
    // Cada cuota con su fecha (23/11): una al mes desde hoy, la primera dentro de un mes.
    const fechas = fechasMensuales(hoy(), 7).slice(1);
    expect(within(d).getByLabelText('Fecha de la cuota 1').value).toBe(fechas[0]);
    expect(within(d).getByLabelText('Fecha de la cuota 6').value).toBe(fechas[5]);
    expect(within(d).getByLabelText('Importe de la cuota 6').value).toBe('100.01');
    expect(within(d).getByText(/Al pagar, el link cobra la inicial \(299,99 €\)/)).toBeTruthy();
    const plan = [100, 100, 100, 100, 100, 100.01].map((importe, i) => ({ importe, vence: fechas[i] }));

    post.mockResolvedValue({ success: true, data: { ...LINK, modalidad: 'cuotas', num_cuotas: 7, importe_cuota: '299.99', importe_inicial: '299.99', plan_cuotas: plan, guarda_tarjeta: true } });
    await crearHabilitado(d);
    fireEvent.click(within(d).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      projectId: 1, productId: 5, importe: 900, precio_original: 1000, descuento_tipo: 'pct', descuento_valor: 10,
      modalidad: 'cuotas', num_cuotas: 6, inicial: 299.99, cuotas: plan,
    }));
    expect(await within(d).findByText(/299,99 € de inicial con el link y 5 × 100,00 € y la última de 100,01 €/)).toBeTruthy();
  });

  it('sin inicial, o con una que no es menor que el total, no deja crear y dice por qué', async () => {
    const d = await abrir({ formaInicial: 'cuotas' });
    await vi.waitFor(() => expect(within(d).getByLabelText('Inicial').value).toBe('250'));
    fireEvent.change(within(d).getByLabelText('Inicial'), { target: { value: '' } });
    expect(within(d).getByText(/Escribe la inicial/)).toBeTruthy();
    fireEvent.change(within(d).getByLabelText('Inicial'), { target: { value: '1000' } });
    expect(within(d).getByText('La inicial tiene que ser menor que el total.')).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText('Inicial'), { target: { value: '0,3' } });
    expect(within(d).getByText('La inicial tiene que ser de al menos 0,50 €.')).toBeTruthy();
  });
});

describe('la pantalla «Links de pago»', () => {
  it('los dos recorridos como atajos, con su anclaje, y el de cuotas abre con «Inicial + cuotas»', async () => {
    render(<MemoryRouter><LinksDePagoPage /></MemoryRouter>);
    const unico = await screen.findByRole('button', { name: /Pago único, con otro importe o descuento/ });
    const cuotas = screen.getByRole('button', { name: /^Inicial \+ cuotas/ });
    expect(unico.getAttribute('data-recorrido')).toBe('links-pantalla-unico');
    expect(cuotas.getAttribute('data-recorrido')).toBe('links-pantalla-inicial');
    // En la lista: el precio de antes, tachado, y el plan de la inicial.
    await screen.findAllByText('Máster en Psicología');
    expect([...document.querySelectorAll('s')].some((s) => /1\.?000,00 €/.test(s.textContent.replace(/\s+/g, ' ')))).toBe(true);
    expect(screen.getByText(/300,00 € de inicial con el link y 3 × 200,00 €, una al mes/)).toBeTruthy();

    fireEvent.click(cuotas);
    const d = await screen.findByRole('dialog');
    const lista = await within(d).findByRole('listbox', { name: 'Curso' });
    fireEvent.click(await within(lista).findByRole('button', { name: /Máster en Psicología/ }));
    expect((await within(d).findByRole('radio', { name: /Inicial \+ cuotas/ })).checked).toBe(true);
  });

  it('el recorrido guiado lleva un paso por cada recorrido, en los anclajes de la pantalla', () => {
    const pasos = RECORRIDOS_COBROS['links-pago'].pasos;
    const de = (n) => pasos.find((p) => p.donde === `[data-recorrido="${n}"]`);
    expect(de('links-pantalla-unico')).toMatchObject({ titulo: 'Pago único, con otro importe o descuento', permiso: 'links_pago.crear' });
    expect(de('links-pantalla-inicial')).toMatchObject({ titulo: 'Inicial más cuotas', permiso: 'links_pago.crear' });
    for (const p of pasos) expect(p.texto.length).toBeLessThanOrEqual(330);
  });
});
