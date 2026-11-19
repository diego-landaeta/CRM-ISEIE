// @vitest-environment jsdom
// Gemela de la de MultiCRM (CRM#680, 19/11). ISEIE no tiene un setup común de
// pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Links de pago: la pantalla, el asistente y los botones de arriba (Diego, 19/11).
 *
 * «No sé cómo hacer los enlaces de pago, tampoco hay una opción en el menú.
 * Intenté crear uno y nada.» Antes solo había una tarjeta al final de la ficha,
 * y su diálogo se callaba: el catálogo que no cargaba dejaba el desplegable
 * vacío, el botón se quedaba gris sin decir por qué y un fallo de Stripe solo
 * salía si el servidor contestaba con texto.
 *
 *   · «Comercial › Links de pago» en el menú, por permiso y con los links encendidos;
 *   · la pantalla: la lista (alumno, programa, venta, importe, quién, caducidad) y
 *     «Crear link de pago», que abre el asistente;
 *   · el asistente: busca el prospecto, enseña SUS ventas y se elige a cuál va el
 *     link (o «sin venta todavía»); con varias hay que elegir; desde una venta se
 *     propone lo pendiente y no deja pasarlo; dice por qué no deja crear; un error
 *     de Stripe sale escrito; con el link: copiar, abrir, WhatsApp y correo;
 *   · «Crear link de pago» arriba en la ficha del prospecto y en la de la venta.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
const sesion = vi.hoisted(() => ({ user: { id: 2, funciones: { links_pago: true } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: sesion.user, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: -1 }, activeIssuerId: null }) }));
vi.mock('@/shared/components/layout/CabeceraContext', () => ({ useCabecera: () => null }));

const { default: CrearLinkAsistente } = await import('@/modules/links-pago/components/CrearLinkAsistente');
const { default: LinksDePagoPage } = await import('@/modules/links-pago/pages/LinksDePagoPage');
const { default: BotonCrearLink } = await import('@/modules/links-pago/components/BotonCrearLink');

const CONFIG = {
  project_id: 1, descuento_max_pct: 0, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: false, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [
  { id: 5, nombre: 'Máster en Psicología', precio: '1000.00', moneda: 'EUR' },
  { id: 6, nombre: 'Experto en Mindfulness', precio: '600.00', moneda: 'EUR' },
];
const LEAD = { id: 3, nombre: 'Ana Pérez', email: 'ana@correo.test', telefono: '+34600000000', project_id: 1, producto_interes_id: 6 };
const VENTA_A = { id: 81, project_id: 1, producto_contratado_id: 5, producto_nombre: 'Máster en Psicología', importe_total: 1000, cobrado: 630, pendiente: 370, fecha_conversion: '2026-11-01' };
const VENTA_B = { id: 82, project_id: 1, producto_contratado_id: 6, producto_nombre: 'Experto en Mindfulness', importe_total: 600, cobrado: 0, pendiente: 600, fecha_conversion: '2026-11-10' };
const LINK = {
  id: 40, project_id: 1, project_nombre: 'Campus Uno', lead_id: 3, lead_nombre: 'Ana Pérez', conversion_id: 81,
  venta_producto_nombre: 'Máster en Psicología', product_id: 5, product_nombre: 'Máster en Psicología',
  created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '1000.00', importe: '370.00', descuento_pct: '0',
  moneda: 'EUR', modalidad: 'unico', estado: 'creado', url: 'https://buy.stripe.com/test_40', caduca_el: '2026-11-26T10:00:00Z',
  pagado_el: null, anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-19T10:00:00Z',
};
let ventas = [VENTA_A, VENTA_B];

beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true, 'whatsapp.usar': true, 'leads.enviar_correo': true };
  sesion.user = { id: 2, funciones: { links_pago: true } };
  ventas = [VENTA_A, VENTA_B];
  get.mockImplementation(async (url, opts) => {
    if (url === '/links-pago') return { success: true, data: [LINK], pagination: { total: 1, page: 1, limit: 25, totalPages: 1 } };
    if (url === '/links-pago/ventas-del-prospecto') return { success: true, data: { lead: LEAD, ventas } };
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/products') return { success: true, data: CURSOS };
    if (url === '/leads') return { success: true, data: opts?.params?.search === 'ana' ? [{ id: 3, nombre: 'Ana Pérez', email: 'ana@correo.test' }] : [] };
    return { success: true, data: [] };
  });
});

afterEach(cleanup);

const conRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('el menú: «Comercial › Links de pago»', () => {
  const cargarMenu = async () => {
    const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');
    const comercial = NAV_SECTIONS.find((s) => s.label === 'Comercial');
    const entrada = comercial.items.find((i) => i.label === 'Links de pago');
    return { comercial, entrada, canSeeItem };
  };

  it('está en Comercial, justo detrás de Ventas, y lleva a /links-pago', async () => {
    const { comercial, entrada } = await cargarMenu();
    expect(entrada).toBeTruthy();
    expect(entrada.to).toBe('/links-pago');
    const etiquetas = comercial.items.map((i) => i.label);
    expect(etiquetas.indexOf('Links de pago')).toBe(etiquetas.indexOf('Ventas') + 1);
  });

  it('sale con «crear» o con «ver todos»; sin ninguno, o con los links apagados en el servidor, no', async () => {
    const { entrada, canSeeItem } = await cargarMenu();
    // En ISEIE: canSeeItem(item, rol, soloColaboraciones, usuario, can).
    const ve = (mapa, user = { funciones: { links_pago: true } }) => canSeeItem(entrada, ['gestor'], false, user, (k) => mapa[k] === true);
    expect(ve({ 'links_pago.crear': true })).toBe(true);
    expect(ve({ 'links_pago.ver_todos': true })).toBe(true);
    expect(ve({})).toBe(false);
    expect(ve({ 'links_pago.crear': true }, { funciones: { links_pago: false } })).toBe(false);
  });
});

describe('la pantalla «Links de pago»', () => {
  it('lista los links con alumno, programa, venta, importe y quién; y el botón grande abre el asistente', async () => {
    conRouter(<LinksDePagoPage />);
    const fila = await screen.findByText('Ana Pérez');
    const li = fila.closest('li');
    expect(within(li).getByText('Pendiente')).toBeTruthy();
    expect(within(li).getByText(/370,00/)).toBeTruthy();
    expect(within(li).getByRole('link', { name: 'Venta n.º 81' }).getAttribute('href')).toBe('/ventas/81');
    expect(within(li).getByRole('link', { name: /Abrir/ }).getAttribute('href')).toBe('https://buy.stripe.com/test_40');
    expect(within(li).getByText(/Gestora Uno/)).toBeTruthy();
    expect(within(li).getByRole('button', { name: /Copiar/ })).toBeTruthy();
    expect(within(li).getByRole('button', { name: /Anular/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByPlaceholderText(/Nombre, correo o teléfono/)).toBeTruthy();
  });

  it('quien solo ve los de todos no tiene el botón de crear', async () => {
    permisos.mapa = { 'links_pago.ver_todos': true };
    conRouter(<LinksDePagoPage />);
    await screen.findByText('Ana Pérez');
    expect(screen.queryByRole('button', { name: /Crear link de pago/ })).toBeNull();
  });

  it('si la lista no carga, lo dice', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/links-pago') throw Object.assign(new Error('x'), { data: { error: 'Error del servidor' } });
      return { success: true, data: [] };
    });
    conRouter(<LinksDePagoPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/No se han podido cargar los links: Error del servidor/);
  });
});

describe('el asistente «Crear link de pago»', () => {
  it('busca el prospecto, enseña sus ventas y, con dos, hay que elegir; la elegida propone su pendiente', async () => {
    conRouter(<CrearLinkAsistente onClose={() => {}} />);
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Busca y elige el prospecto.')).toBeTruthy();
    fireEvent.change(within(dialogo).getByPlaceholderText(/Nombre, correo o teléfono/), { target: { value: 'ana' } });
    fireEvent.click(await within(dialogo).findByRole('button', { name: /Ana Pérez/ }));

    // Sus dos ventas, con su programa, total y pendiente, y «sin venta todavía».
    const grupo = await within(dialogo).findByRole('radiogroup', { name: 'Venta del link' });
    expect(within(grupo).getByText(/Venta n.º 81/).textContent).toMatch(/pendiente\s*370,00/);
    expect(within(grupo).getByText(/Venta n.º 82/)).toBeTruthy();
    expect(within(grupo).getByText('Sin venta todavía')).toBeTruthy();
    expect(within(dialogo).getByText(/Elige a qué venta va el link/)).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);

    fireEvent.click(within(grupo).getAllByRole('radio')[0]);
    const importe = await within(dialogo).findByLabelText('Importe');
    await vi.waitFor(() => expect(importe.value).toBe('370'));
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Curso').value).toBe('5'));

    // Pasarse de lo pendiente (CRM#909): lo dice y no deja.
    fireEvent.change(importe, { target: { value: '400' } });
    expect(within(dialogo).getByText(/no puede pasar de lo pendiente de la venta/)).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);

    fireEvent.change(importe, { target: { value: '370' } });
    post.mockResolvedValue({ success: true, data: LINK });
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      leadId: 3, conversionId: 81, productId: 5, importe: 370, moneda: 'EUR', caducidad_dias: 7,
    }));
    expect(await within(dialogo).findByText('Link creado')).toBeTruthy();
    expect(within(dialogo).getByLabelText('Link de pago').value).toBe('https://buy.stripe.com/test_40');
    expect(within(dialogo).getByRole('button', { name: /Copiar/ })).toBeTruthy();
    expect(within(dialogo).getByRole('link', { name: /Abrir/ })).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: /Enviar por WhatsApp/ })).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: /Enviar por correo/ })).toBeTruthy();
  });

  it('desde la ficha de un prospecto con UNA venta, sale ya elegida; «sin venta» manda el link sin venta', async () => {
    ventas = [VENTA_B];
    conRouter(<CrearLinkAsistente leadId={3} onClose={() => {}} />);
    const dialogo = await screen.findByRole('dialog');
    const grupo = await within(dialogo).findByRole('radiogroup', { name: 'Venta del link' });
    await vi.waitFor(() => expect(within(grupo).getAllByRole('radio')[0].checked).toBe(true));
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('600'));

    fireEvent.click(within(grupo).getAllByRole('radio')[1]); // Sin venta todavía
    // Sin venta: el curso que le interesa y su precio de catálogo.
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Curso').value).toBe('6'));
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('600'));
    post.mockResolvedValue({ success: true, data: { ...LINK, conversion_id: null } });
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      leadId: 3, productId: 6, importe: 600, moneda: 'EUR', caducidad_dias: 7,
    }));
  });

  it('desde la ficha de una venta, va a esa venta aunque el prospecto tenga más', async () => {
    conRouter(<CrearLinkAsistente leadId={3} conversionId={82} onClose={() => {}} />);
    const dialogo = await screen.findByRole('dialog');
    const grupo = await within(dialogo).findByRole('radiogroup', { name: 'Venta del link' });
    await vi.waitFor(() => expect(within(grupo).getAllByRole('radio')[1].checked).toBe(true));
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('600'));
  });

  it('si Stripe falla, el error sale escrito en el diálogo (nunca «nada»)', async () => {
    ventas = [VENTA_A];
    post.mockRejectedValue(Object.assign(new Error('Request failed'), {
      status: 424, data: { success: false, error: 'Stripe no ha podido crear el link: Invalid API Key provided', code: 'STRIPE_ERROR' },
    }));
    conRouter(<CrearLinkAsistente leadId={3} onClose={() => {}} />);
    const dialogo = await screen.findByRole('dialog');
    await vi.waitFor(() => expect(within(dialogo).getByLabelText('Importe').value).toBe('370'));
    await vi.waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear link' }));
    const alerta = await within(dialogo).findByRole('alert');
    expect(alerta.textContent).toMatch(/No se ha creado el link\. Stripe no ha podido crear el link: Invalid API Key/);
    expect(within(dialogo).queryByText('Link creado')).toBeNull();
  });

  it('si el catálogo no carga, lo dice; sin cursos, dice por qué no deja crear', async () => {
    ventas = [];
    get.mockImplementation(async (url) => {
      if (url === '/links-pago/ventas-del-prospecto') return { success: true, data: { lead: LEAD, ventas } };
      if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
      if (url === '/products') throw Object.assign(new Error('x'), { data: { error: 'No tienes permiso' } });
      return { success: true, data: [] };
    });
    conRouter(<CrearLinkAsistente leadId={3} onClose={() => {}} />);
    const dialogo = await screen.findByRole('dialog');
    expect((await within(dialogo).findByRole('alert')).textContent).toMatch(/No se ha podido cargar el catálogo del campus: No tienes permiso/);
    expect(await within(dialogo).findByText(/no tiene cursos en el catálogo/)).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
  });
});

describe('«Crear link de pago» arriba, en las fichas', () => {
  it('abre el asistente con el prospecto (y la venta) ya elegidos', async () => {
    conRouter(<BotonCrearLink leadId={3} conversionId={81} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear link de pago/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(await within(dialogo).findByText('Ana Pérez')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/links-pago/ventas-del-prospecto', { params: { leadId: 3 } });
    const grupo = await within(dialogo).findByRole('radiogroup', { name: 'Venta del link' });
    await vi.waitFor(() => expect(within(grupo).getAllByRole('radio')[0].checked).toBe(true));
  });

  it('sin permiso de crear, o con los links apagados, no sale', () => {
    permisos.mapa = { 'links_pago.ver_todos': true };
    const { container, rerender } = conRouter(<BotonCrearLink leadId={3} />);
    expect(container.textContent).toBe('');
    permisos.mapa = { 'links_pago.crear': true };
    sesion.user = { id: 2, funciones: { links_pago: false } };
    rerender(<MemoryRouter><BotonCrearLink leadId={3} /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('la ficha del prospecto y la de la venta lo llevan en su cabecera', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const leer = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    expect(leer('modules/leads/components/lead-detail/LeadHeaderCard.tsx')).toMatch(/<BotonCrearLink leadId=\{lead\.id\} \/>/);
    expect(leer('modules/sales/pages/SaleDetailPage.tsx')).toMatch(/<BotonCrearLink leadId=\{venta\.lead_id\} conversionId=\{venta\.id\} \/>/);
    expect(leer('App.jsx')).toMatch(/path="\/links-pago" element=\{<LinksDePagoPage \/>\}/);
  });
});
