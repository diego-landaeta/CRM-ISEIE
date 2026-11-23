// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Cuotas con sus fechas y la búsqueda del prospecto en «Crear link de pago»
 * (Diego, 23/11/2026; gemela de CRM#1021).
 *
 * «El link de pago debe dejar CREAR CUOTAS Y ELEGIR LAS FECHAS SÍ O SÍ» y
 * «tampoco funciona lo opcional, debe funcionar».
 *
 *   · LA BÚSQUEDA: Daniela (ISEIE) buscaba «34960254882» en «Para un prospecto o
 *     una venta concretos» y no salía nadie, con cinco fichas con ese móvil. El
 *     asistente pedía `GET /leads` sin campus, y la lista de prospectos exige
 *     `projectId` o `projectIds` (CRM#859): el cliente ni siquiera hacía la
 *     petición y devolvía una lista vacía. Ahora va con los campus de quien crea.
 *   · LAS CUOTAS, SIEMPRE: con o sin cobro automático. Sin él, «Inicial + cuotas»
 *     no se apaga: dice que cada cuota tendrá su propio link. Apagado solo si el
 *     campus no admite cuotas.
 *   · LAS FECHAS: una al mes desde hoy de serie, y cada fecha y cada importe se
 *     pueden cambiar; se mandan tal cual. Si no cuadran (suma, orden, fecha
 *     pasada), no deja crear y dice por qué.
 *
 *   npx vitest run src/__smoke__/cuotasConFechas.test.jsx
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, funciones: { links_pago: true } }, permissions: null }) }));
const ctx = vi.hoisted(() => ({ valor: {} }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.valor }));

const {
  default: CrearLinkAsistente, paramsDeLaBusqueda, problemasDelPlan, ajustarFechas, fechasMensuales,
} = await import('@/modules/links-pago/components/CrearLinkAsistente');
// El cliente de verdad: es el que se negaba a pedir la lista sin campus.
const { pideLeadsSinCampus } = await vi.importActual('@/shared/api/client');

const CONFIG = {
  project_id: 10, descuento_max_pct: 10, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: true, cuotas_max: 6, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const MOVIL = '34960254882';
const FICHA = { id: 22440, nombre: 'Prospecto del móvil', email: null, telefono: '+34960254882', project_nombre: 'ISEIE' };
const SIN_PERMISO = 'La clave de links de pago de este campus no tiene permiso de suscripciones: en Stripe le faltan Subscription Schedules.';
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const comoUrl = (params) => `/leads?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;

let cuotas;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true, 'links_pago.cobro_automatico': true };
  ctx.valor = { activeProject: { id: 10 }, activeIssuerId: null, projects: [{ id: 10, nombre: 'ISEIE' }] };
  cuotas = { disponible: true, automatico: false, codigo: 'clave_sin_permiso', motivo: SIN_PERMISO, cuotas_max: 6 };
  get.mockImplementation(async (url, opciones) => {
    if (url.startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: cuotas };
    if (url === '/products') return { success: true, data: [{ id: 5, nombre: 'Máster en Psicología', precio: '1000.00', moneda: 'EUR' }] };
    if (url === '/leads') {
      // Como el cliente de verdad: sin campus, ni se pide (CRM#859).
      if (pideLeadsSinCampus(comoUrl(opciones?.params || {}))) return { success: false, data: [], code: 'SIN_CAMPUS' };
      return { success: true, data: String(opciones.params.search).includes(MOVIL) ? [FICHA] : [] };
    }
    return { success: true, data: [] };
  });
});
afterEach(() => cleanup());

const abrir = async (props = {}) => {
  render(<MemoryRouter><CrearLinkAsistente onClose={() => {}} {...props} /></MemoryRouter>);
  const dialogo = await screen.findByRole('dialog');
  const lista = await within(dialogo).findByRole('listbox', { name: 'Curso' });
  fireEvent.click(await within(lista).findByRole('button', { name: /Máster en Psicología/ }));
  return dialogo;
};
const crearHabilitado = (d) => vi.waitFor(() => expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(false));

describe('«Para un prospecto»: la búsqueda va con el campus', () => {
  it('lo que pedía antes (sin campus) el cliente no lo manda; lo de ahora, sí', () => {
    // El fallo: `{ search, includeConverted, limit }` y nada más.
    expect(pideLeadsSinCampus(comoUrl({ search: MOVIL, includeConverted: true, limit: 10 }))).toBe(true);
    expect(paramsDeLaBusqueda(` ${MOVIL} `, [10])).toEqual({ search: MOVIL, includeConverted: true, limit: 10, projectId: 10 });
    expect(pideLeadsSinCampus(comoUrl(paramsDeLaBusqueda(MOVIL, [10])))).toBe(false);
    // Con varios campus, todos los suyos (el servidor los recorta igual).
    expect(paramsDeLaBusqueda(MOVIL, [1, 2, 2, -1])).toMatchObject({ projectIds: '1,2' });
    expect(pideLeadsSinCampus(comoUrl(paramsDeLaBusqueda(MOVIL, [1, 2])))).toBe(false);
  });

  it('Daniela busca el móvil y encuentra la ficha', async () => {
    const d = await abrir();
    fireEvent.click(within(d).getByRole('button', { name: /Para un prospecto o una venta concretos/ }));
    fireEvent.change(within(d).getByPlaceholderText('Nombre, correo o teléfono'), { target: { value: MOVIL } });
    expect(await within(d).findByText('Prospecto del móvil', {}, { timeout: 3000 })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/leads', { params: { search: MOVIL, includeConverted: true, limit: 10, projectId: 10 } });
    expect(within(d).queryByText(/Ningún prospecto tuyo/)).toBeNull();
  });
});

describe('las cuotas, con o sin cobro automático', () => {
  it('sin cobro automático: se eligen igual, lo dice, y se crean con sus fechas (cambiadas a mano)', async () => {
    const d = await abrir({ formaInicial: 'cuotas' });
    const radio = within(d).getByRole('radio', { name: /Inicial \+ cuotas/ });
    expect(radio.checked).toBe(true);
    expect(radio.disabled).toBe(false);
    const aviso = await within(d).findByTestId('aviso-cuotas-sin-auto');
    expect(aviso.textContent).toMatch(/El cobro no será automático: cada cuota tendrá su propio link/);
    expect(within(d).queryByText(/Cuotas no disponibles/)).toBeNull();

    // 1000 en 4 pagos: 250 de inicial y 3 cuotas de 250, una al mes desde hoy.
    await vi.waitFor(() => expect(within(d).getByLabelText('Inicial').value).toBe('250'));
    const deSerie = fechasMensuales(hoy(), 4).slice(1);
    expect([1, 2, 3].map((k) => within(d).getByLabelText(`Fecha de la cuota ${k}`).value)).toEqual(deSerie);
    expect([1, 2, 3].map((k) => within(d).getByLabelText(`Importe de la cuota ${k}`).value)).toEqual(['250', '250', '250']);
    expect(within(d).getByText(/se crea un link por cuota, que vence en su fecha/)).toBeTruthy();

    // La gestora mueve la 2 y cambia importes: si no suman lo que queda, no deja.
    const [a, m] = deSerie[1].split('-');
    const otraFecha = `${a}-${m}-05` > deSerie[0] ? `${a}-${m}-05` : deSerie[1];
    fireEvent.change(within(d).getByLabelText('Fecha de la cuota 2'), { target: { value: otraFecha } });
    fireEvent.change(within(d).getByLabelText('Importe de la cuota 1'), { target: { value: '300' } });
    expect(within(d).getByText(/Las cuotas suman 800,00 € y tienen que sumar 750,00 €/)).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText('Importe de la cuota 3'), { target: { value: '200' } });

    post.mockResolvedValue({ success: true, data: {
      id: 70, project_id: 10, modalidad: 'cuotas', importe: '1000.00', moneda: 'EUR', num_cuotas: 4, importe_cuota: '250.00',
      importe_inicial: '250.00', guarda_tarjeta: false, estado: 'creado', url: 'https://buy.stripe.com/test_70', caduca_el: '2026-12-01T10:00:00Z',
      plan_cuotas: [{ importe: 300, vence: deSerie[0] }, { importe: 250, vence: otraFecha }, { importe: 200, vence: deSerie[2] }],
    } });
    await crearHabilitado(d);
    fireEvent.click(within(d).getByRole('button', { name: 'Crear link' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago', {
      projectId: 10, productId: 5, importe: 1000, modalidad: 'cuotas', num_cuotas: 3, inicial: 250,
      cuotas: [{ importe: 300, vence: deSerie[0] }, { importe: 250, vence: otraFecha }, { importe: 200, vence: deSerie[2] }],
    }));
    expect(await within(d).findByText(/cada cuota, con su link/)).toBeTruthy();
  });

  it('con cobro automático: el texto de siempre, sin el aviso', async () => {
    cuotas = { disponible: true, automatico: true, codigo: null, motivo: null, cuotas_max: 6 };
    const d = await abrir({ formaInicial: 'cuotas' });
    await vi.waitFor(() => expect(within(d).getByText(/Stripe cobra cada cuota sola en su fecha/)).toBeTruthy());
    expect(within(d).queryByTestId('aviso-cuotas-sin-auto')).toBeNull();
  });

  it('campus que no admite cuotas: apagado, y dice por qué', async () => {
    cuotas = { disponible: false, automatico: false, codigo: 'cuotas_no_admitidas', motivo: 'Este campus no admite pagos en cuotas.', cuotas_max: 6 };
    const d = await abrir();
    const radio = await within(d).findByRole('radio', { name: /Inicial \+ cuotas/ });
    await vi.waitFor(() => expect(radio.disabled).toBe(true));
    expect(within(d).getByText(/Cuotas no disponibles: Este campus no admite pagos en cuotas/)).toBeTruthy();
  });

  it('una fecha antes de la anterior: no deja crear y dice cuál', async () => {
    const d = await abrir({ formaInicial: 'cuotas' });
    await vi.waitFor(() => expect(within(d).getByLabelText('Fecha de la cuota 3')).toBeTruthy());
    const f1 = within(d).getByLabelText('Fecha de la cuota 1').value;
    fireEvent.change(within(d).getByLabelText('Fecha de la cuota 2'), { target: { value: f1 } });
    expect(within(d).getByText('La cuota 2 tiene que ir después de la 1.')).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Crear link' }).disabled).toBe(true);
  });
});

describe('las reglas de las fechas, como el servidor', () => {
  it('más cuotas: las que hay se quedan y las nuevas, una al mes después de la última', () => {
    expect(ajustarFechas([], 2, '2026-11-23')).toEqual(['2026-12-23', '2027-01-23']);
    expect(ajustarFechas(['2026-12-05'], 3, '2026-11-23')).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(ajustarFechas(['2026-12-05', '2027-01-05', '2027-02-05'], 1, '2026-11-23')).toEqual(['2026-12-05']);
  });

  it('suma, mínimo, fecha de hoy, orden y tope de tres años', () => {
    const ok = [{ importe: '100', vence: '2026-12-01' }, { importe: '100', vence: '2027-01-01' }];
    expect(problemasDelPlan(ok, 200, '2026-11-23')).toEqual([]);
    expect(problemasDelPlan(ok, 250, '2026-11-23').join(' ').replace(/\s/g, ' ')).toMatch(/suman 200,00 € y tienen que sumar 250,00 €/);
    expect(problemasDelPlan([{ importe: '0,3', vence: '2026-12-01' }], 0.3, '2026-11-23')).toEqual(['Cada cuota tiene que ser de al menos 0,50 €.']);
    expect(problemasDelPlan([{ importe: '200', vence: '2026-11-23' }], 200, '2026-11-23').join(' ')).toMatch(/de mañana en adelante/);
    expect(problemasDelPlan([{ importe: '200', vence: '2029-11-24' }], 200, '2026-11-23').join(' ')).toMatch(/más de 3 años/);
    expect(problemasDelPlan([{ importe: '200', vence: '' }], 200, '2026-11-23')).toEqual(['Pon la fecha de cada cuota.']);
  });
});
