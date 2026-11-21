// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
import { afterEach as despues } from 'vitest';
despues(() => limpiar());
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * «Crear link de pago» sencillo (Carlos y Diego, 20/11/2026).
 *
 * Carlos: «Crear link de pago > producto > pago único / cuotas > seleccionar. Y
 * ya.» Sin el nombre de la persona.
 *
 *   · una sola pantalla: el campus (si tiene varios), el curso con buscador, su
 *     precio del catálogo, pago único o cuotas;
 *   · en cuotas, cuántas (de 2 al máximo del campus) y cuánto es cada una, con
 *     los céntimos en la última;
 *   · si el campus no puede cobrar cuotas solas, «En cuotas» sale apagado y dice
 *     por qué, antes de crear nada;
 *   · el link creado sin prospecto: copiar y abrir (sin WhatsApp ni correo, que
 *     no hay a quién).
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } }, permissions: null }) }));
const contexto = vi.hoisted(() => ({ v: null }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => contexto.v }));

const { default: CrearLinkAsistente, repartirEnCuotas } = await import('@/modules/links-pago/components/CrearLinkAsistente');

const CONFIG = {
  project_id: 1, descuento_max_pct: 10, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 6, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [
  { id: 5, nombre: 'Máster en Psicología', precio: '1000.00', moneda: 'EUR' },
  { id: 6, nombre: 'Experto en Mindfulness', precio: '600.00', moneda: 'EUR' },
  { id: 7, nombre: 'Curso de Logopedia', precio: '300.00', moneda: 'EUR' },
];
const LINK = {
  id: 50, project_id: 1, lead_id: null, conversion_id: null, product_id: 5, product_nombre: 'Máster en Psicología',
  created_by: 2, precio_catalogo: '1000.00', importe: '1000.00', descuento_pct: '0', moneda: 'EUR', modalidad: 'unico',
  estado: 'creado', url: 'https://buy.stripe.com/test_50', caduca_el: '2026-11-27T10:00:00Z', created_at: '2026-11-20T10:00:00Z',
};
let cuotas = { disponible: true, motivo: null, cuotas_max: 6 };

beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true, 'links_pago.cobro_automatico': true, 'whatsapp.usar': true, 'leads.enviar_correo': true };
  contexto.v = { activeProject: { id: -1 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus Uno' }, { id: 2, nombre: 'Campus Dos' }] };
  cuotas = { disponible: true, motivo: null, cuotas_max: 6 };
  get.mockImplementation(async (url) => {
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: cuotas };
    if (url === '/products') return { success: true, data: CURSOS };
    return { success: true, data: [] };
  });
});

const abrir = async () => {
  render(<MemoryRouter><CrearLinkAsistente onClose={() => {}} /></MemoryRouter>);
  return screen.findByRole('dialog');
};
const elegirCampusYCurso = async (dialogo, curso = /Máster en Psicología/) => {
  fireEvent.change(within(dialogo).getByLabelText('Campus'), { target: { value: '1' } });
  const lista = await within(dialogo).findByRole('listbox', { name: 'Curso' });
  fireEvent.click(await within(lista).findByRole('button', { name: curso }));
};

describe('el reparto en cuotas', () => {
  it('como el servidor: iguales, con los céntimos en la última', () => {
    expect(repartirEnCuotas(1000, 3)).toEqual([333.33, 333.33, 333.34]);
    expect(repartirEnCuotas(900, 3)).toEqual([300, 300, 300]);
  });
});

describe('«Crear link de pago» en una pantalla, sin prospecto', () => {
  it('campus, curso (con buscador), pago único y crear: sin prospecto ni venta', async () => {
    const dialogo = await abrir();
    // Nada de buscar al prospecto: el campus y el curso.
    expect(within(dialogo).queryByPlaceholderText(/Nombre, correo o teléfono/)).toBeNull();
    expect(within(dialogo).getByText('Elige el campus.')).toBeTruthy();

    fireEvent.change(within(dialogo).getByLabelText('Campus'), { target: { value: '1' } });
    const lista = await within(dialogo).findByRole('listbox', { name: 'Curso' });
    await within(lista).findByRole('button', { name: /Máster en Psicología/ });
    fireEvent.change(within(dialogo).getByPlaceholderText(/Busca entre 3 cursos/), { target: { value: 'logo' } });
    expect(within(lista).queryByRole('button', { name: /Máster/ })).toBeNull();
    fireEvent.click(within(lista).getByRole('button', { name: /Curso de Logopedia/ }));

    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('300'));
    expect(within(dialogo).getByRole('radio', { name: /Pago único/ }).checked).toBe(true);
    post.mockResolvedValue({ success: true, data: { ...LINK, product_id: 7, importe: '300.00' } });
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', { projectId: 1, productId: 7, importe: 300, moneda: 'EUR' }));

    expect(await within(dialogo).findByText('Link creado')).toBeTruthy();
    expect(within(dialogo).getByText(/Sin prospecto: al pagarlo, el CRM busca su ficha/)).toBeTruthy();
    expect(within(dialogo).getByLabelText('Link de pago').value).toBe('https://buy.stripe.com/test_50');
    expect(within(dialogo).getByRole('button', { name: /Copiar/ })).toBeTruthy();
    expect(within(dialogo).getByRole('link', { name: /Abrir/ })).toBeTruthy();
    // Sin prospecto no hay a quién mandarlo desde el CRM.
    expect(within(dialogo).queryByRole('button', { name: /Enviar por WhatsApp/ })).toBeNull();
    expect(within(dialogo).queryByRole('button', { name: /Enviar por correo/ })).toBeNull();
  });

  it('con un solo campus, o con uno elegido arriba, no pregunta el campus', async () => {
    contexto.v = { activeProject: { id: 2 }, activeIssuerId: null, projects: [{ id: 1, nombre: 'Campus Uno' }, { id: 2, nombre: 'Campus Dos' }] };
    const dialogo = await abrir();
    await within(dialogo).findByRole('listbox', { name: 'Curso' });
    expect(get).toHaveBeenCalledWith('/products', { params: { projectId: 2, limit: 500 } });
  });

  it('en cuotas: cuántas (hasta el máximo del campus) y cuánto cada una; crea con el total y el número', async () => {
    const dialogo = await abrir();
    await elegirCampusYCurso(dialogo);
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('1000'));
    fireEvent.click(within(dialogo).getByRole('radio', { name: /En cuotas/ }));

    const num = within(dialogo).getByLabelText('Cuotas');
    expect([...num.options].map((o) => o.value)).toEqual(['2', '3', '4', '5', '6']);
    expect(num.value).toBe('3');
    expect(within(dialogo).getByText(/2 × 333,33 € y la última de 333,34 €/)).toBeTruthy();
    expect(within(dialogo).getByText(/El link cobra la primera cuota \(333,33 €\) y guarda la tarjeta/)).toBeTruthy();
    fireEvent.change(num, { target: { value: '4' } });
    expect(within(dialogo).getByText(/4 × 250,00 €/)).toBeTruthy();

    post.mockResolvedValue({ success: true, data: { ...LINK, modalidad: 'cuotas', num_cuotas: 4, importe_cuota: '250.00', guarda_tarjeta: true } });
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      projectId: 1, productId: 5, importe: 1000, modalidad: 'cuotas', num_cuotas: 4,
    }));
    expect(await within(dialogo).findByText(/en 4 cuotas: 250,00 € al pagar el link/)).toBeTruthy();
  });

  it('si el campus no puede cobrar cuotas solas, «En cuotas» sale apagado y dice por qué', async () => {
    cuotas = { disponible: false, motivo: 'Este campus no tiene permitido el cobro automático. Lo enciende un admin en Integraciones › Links de pago.', cuotas_max: 6 };
    const dialogo = await abrir();
    await elegirCampusYCurso(dialogo);
    const enCuotas = await within(dialogo).findByRole('radio', { name: /En cuotas/ });
    await vi.waitFor(() => expect(enCuotas.disabled).toBe(true));
    expect(within(dialogo).getByText(/Cuotas no disponibles: Este campus no tiene permitido el cobro automático/)).toBeTruthy();
  });

  it('el precio se puede bajar solo dentro del tope del campus', async () => {
    const dialogo = await abrir();
    await elegirCampusYCurso(dialogo);
    const importe = within(dialogo).getByLabelText('Importe');
    await vi.waitFor(() => expect(importe.value).toBe('1000'));
    fireEvent.change(importe, { target: { value: '850' } });
    expect(within(dialogo).getByText(/Es un 15 % menos que el catálogo; el máximo en este campus es un 10 %/)).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
    fireEvent.change(importe, { target: { value: '900' } });
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
  });
});
