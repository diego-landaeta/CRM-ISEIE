// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * STRIPE Y CUOTAS, CLARO (Diego, 24/11/2026). Tres cosas:
 *
 *  1. «Que salga sí o sí ese disclaimer: mismo enlace y se cobrará de esta
 *     forma»: con cuotas, un recuadro con las cifras reales del plan antes de
 *     crear el link o de registrar la venta.
 *  2. Venta con «Tarjeta (Stripe)»: «¿La inicial ya fue pagada?» → «¿Necesitas
 *     enlace de las cuotas?»; con sí, los links de las cuotas pendientes sin
 *     volver a cobrar la inicial (el fraccionado con «ya la pagó con otro link»).
 *  3. Las listas de Stripe por empresa y campus; un campus con el Stripe de otro
 *     (`stripe_prestado_de`) sale conectado: «Usa el Stripe de <nombre>».
 */

const permisos = { lista: ['links_pago.crear'] };
vi.mock('@/shared/lib/linksPago', () => ({ useLinksPagoEncendidos: () => true, linksPagoEncendidos: () => true }));
vi.mock('@/shared/lib/recordatoriosLinks', () => ({ useRecordatoriosLinks: () => false, recordatoriosLinksEncendidos: () => false }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.lista.includes(k), llevaEquipo: false }) }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/shared/hooks/useDialogA11y', () => ({ useEscapeKey: () => {} }));
vi.mock('@/modules/products/hooks/useProducts', () => ({ useProducts: () => ({ products: [] }) }));
vi.mock('@/modules/conversions/hooks/useProductosConCurso', async (original) => ({ ...(await original()), useProductosConCurso: () => null }));

const createMock = vi.fn();
const cuotasMock = vi.fn();
vi.mock('@/modules/conversions/api/conversions.api', () => ({
  conversionsApi: { create: (...a) => createMock(...a), generateInstallments: (...a) => cuotasMock(...a) },
}));
const planMock = vi.fn();
const linkMock = vi.fn();
vi.mock('@/modules/links-pago/api/linksPago.api', () => ({
  generarPlan: (...a) => planMock(...a),
  crearLink: (...a) => linkMock(...a),
}));
const toastMock = vi.fn();
vi.mock('@/shared/hooks/useToast', () => ({ toast: (...a) => toastMock(...a) }));
const get = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => get(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const ctx = { valor: {} };
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.valor }));

const { frasesDelAviso, euros, cobrosEnLista } = await import('@/modules/links-pago/lib/avisoCuotas');
const { agruparPorEmpresa, stripePrestadoDe, SIN_EMPRESA } = await import('@/shared/lib/campusPorEmpresa');
const { default: AvisoConectarStripe } = await import('@/modules/links-pago/components/AvisoConectarStripe');
const { default: SaludDeLasConexiones } = await import('@/modules/accounting/components/SaludDeLasConexiones');
const { default: ConversionDialog } = await import('@/modules/conversions/components/ConversionDialog');

// Dos empresas y un campus suelto, como llegan en /auth/me.
const PROYECTOS = [
  { id: 1, nombre: 'Psiko Aprende', sociedad_emisora_id: 8, sociedad_nombre: 'Zeta Formación SL' },
  { id: 2, nombre: 'ICTESS', sociedad_emisora_id: 3, sociedad_nombre: 'Alfa Educación SL' },
  { id: 3, nombre: 'ICTESS US', sociedad_emisora_id: 3, sociedad_nombre: 'Alfa Educación SL' },
  { id: 4, nombre: 'Campus suelto', sociedad_emisora_id: null },
];

beforeEach(() => {
  permisos.lista = ['links_pago.crear'];
  createMock.mockReset(); createMock.mockResolvedValue({ success: true, data: { id: 7 } });
  cuotasMock.mockReset(); cuotasMock.mockResolvedValue({ success: true });
  planMock.mockReset(); planMock.mockResolvedValue({ success: true, data: { cuotas: [] } });
  linkMock.mockReset(); toastMock.mockReset(); get.mockReset();
  ctx.valor = { activeProject: { id: -1 }, activeIssuerId: null, projects: PROYECTOS, switchProject: vi.fn() };
});
afterEach(() => { cleanup(); });

describe('1 · el aviso «cómo se cobra», con las cifras del plan', () => {
  const PLAN = {
    primero: { importe: 500, esInicial: true },
    despues: [{ importe: 250, vence: '2026-12-24' }, { importe: 250, vence: '2027-01-24' }, { importe: 250, vence: '2027-02-24' }],
    total: 1250, linksDeCuotas: 'al_pagar', recordatorio: true,
  };

  it('el caso de Diego, con cobro automático: un solo enlace, hoy la inicial y Stripe las cuotas solas', () => {
    expect(frasesDelAviso({ ...PLAN, automatico: true }).join(' '))
      .toBe('Un solo enlace. Hoy se cobran 500 €. Después, Stripe cobra solo 250 € el 24/12, el 24/01 y el 24/02 con la misma tarjeta. Total: 1.250 €.');
  });

  it('sin cobro automático: la inicial con este enlace y cada cuota con el suyo (recordatorio encendido o no)', () => {
    const con = frasesDelAviso({ ...PLAN, automatico: false }).join(' ');
    expect(con).toContain('Hoy se cobra la inicial (500 €) con este enlace.');
    expect(con).toContain('Cada cuota tendrá su propio enlace (250 € el 24/12, el 24/01 y el 24/02), que se crea al pagar la inicial');
    expect(con).toContain('Si no lo paga, se le recuerda al alumno.');
    const sin = frasesDelAviso({ ...PLAN, automatico: false, recordatorio: false, linksDeCuotas: 'al_registrar' }).join(' ');
    expect(sin).toContain('que te damos al registrar la venta');
    expect(sin).toContain('El recordatorio automático al alumno está apagado');
    expect(sin).not.toContain('se le recuerda al alumno.');
  });

  it('con la inicial ya pagada por otro lado: no se vuelve a cobrar, y el enlace cobra la cuota 1', () => {
    const t = frasesDelAviso({
      automatico: true, yaPagado: 500, total: 1250, linksDeCuotas: 'al_registrar', recordatorio: false,
      primero: { importe: 250, vence: '2026-12-24', esInicial: false },
      despues: [{ importe: 250, vence: '2027-01-24' }, { importe: 250, vence: '2027-02-24' }],
    }).join(' ');
    expect(t).toBe('La inicial (500 €) ya está pagada: no se vuelve a cobrar. Un solo enlace. Al pagarlo se cobra la cuota 1 (250 €, vence el 24/12) y se guarda la tarjeta. Después, Stripe cobra solo 250 € el 24/01 y el 24/02 con la misma tarjeta. Total: 1.250 €.');
  });

  it('importes distintos, cada uno con su fecha; y el año si el plan pasa de un año', () => {
    expect(cobrosEnLista([{ importe: 249.99, vence: '2026-12-24' }, { importe: 250.02, vence: '2027-01-24' }]))
      .toBe('249,99 € el 24/12 y 250,02 € el 24/01');
    const largo = frasesDelAviso({ ...PLAN, automatico: true, despues: [{ importe: 375, vence: '2026-12-24' }, { importe: 375, vence: '2028-01-24' }] }).join(' ');
    expect(largo).toContain('375 € el 24/12/2026 y el 24/01/2028');
    expect(euros(1250)).toBe('1.250 €');
    expect(euros(1234567.5)).toBe('1.234.567,50 €');
  });
});

/** Una venta de 900 € con producto y fecha de inicio, sin decir aún cómo paga. */
function ventaDe900() {
  const r = render(<ConversionDialog open onClose={vi.fn()} lead={{ id: 99, nombre: 'Ana Test' }} projectId={1} />);
  const { container } = r;
  const inicio = container.querySelector('#venta-fecha-inicio');
  if (inicio) fireEvent.change(inicio, { target: { value: '2026-12-01' } });
  fireEvent.change(container.querySelector('input[placeholder*="producto"]'), { target: { value: 'Máster X' } });
  fireEvent.change(container.querySelector('input[type="number"][required]'), { target: { value: '900' } });
  return r;
}
async function elegirStripe() {
  fireEvent.click(screen.getByRole('combobox', { name: /Método de pago/i }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: 'Tarjeta (Stripe)' }));
}
const enviar = (container) => fireEvent.submit(container.querySelector('form'));

describe('2 · venta con «Tarjeta (Stripe)»: ¿la inicial ya fue pagada?', () => {
  it('pregunta, y sin contestar no se registra', async () => {
    const { container } = ventaDe900();
    await elegirStripe();
    expect(screen.getByText('¿La inicial ya fue pagada?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pagó TODO' }));
    expect(screen.queryByText('¿La inicial ya fue pagada?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sin pago' }));
    enviar(container);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta decir si la inicial ya fue pagada' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sí + enlace de las cuotas: inicial cobrada como Stripe y los links de las cuotas pendientes, sin cobrarla otra vez', async () => {
    const { container } = ventaDe900();
    await elegirStripe();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya la pagó' }));
    fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '300' } });
    expect(screen.getByText('¿Necesitas enlace de las cuotas?')).toBeTruthy();
    // La pregunta del fraccionado no sale dos veces: la lleva esta.
    expect(screen.queryByText('¿Se cobra con link de pago?')).toBeNull();
    enviar(container);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta decir si necesitas enlace de las cuotas' })));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, enlace de las cuotas' }));
    // El aviso, con la inicial ya pagada y un enlace por cuota.
    const aviso = screen.getByTestId('aviso-como-se-cobra');
    expect(aviso.textContent).toContain('La inicial (300 €) ya está pagada: no se vuelve a cobrar.');
    expect(aviso.textContent).toMatch(/Cada cuota tendrá su propio enlace \(200 € el .*\), que te damos al registrar la venta/);
    expect(aviso.textContent).toContain('Total: 900 €.');
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][0];
    expect(body.importe_pagado).toBe(300);
    expect(body.metodo_pago).toBe('fraccionado');
    expect(body.metodo_pago_inicial).toBe('tarjeta_stripe');
    // Las cuotas reparten lo pendiente (600), no el total: la inicial no se cobra otra vez.
    await waitFor(() => expect(cuotasMock).toHaveBeenCalled());
    const plan = cuotasMock.mock.calls[0][1].installments;
    expect(plan.reduce((t, c) => t + c.importe_previsto, 0)).toBe(600);
    await waitFor(() => expect(planMock).toHaveBeenCalledWith(7));
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('sí + sin enlace de las cuotas: ningún link', async () => {
    const { container } = ventaDe900();
    await elegirStripe();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya la pagó' }));
    fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByTestId('aviso-como-se-cobra')).toBeNull();
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0].metodo_pago_inicial).toBe('tarjeta_stripe');
    await waitFor(() => expect(cuotasMock).toHaveBeenCalled());
    expect(planMock).not.toHaveBeenCalled();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('sí, sin escribir lo que pagó: lo pide', async () => {
    const { container } = ventaDe900();
    await elegirStripe();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya la pagó' }));
    fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sí, enlace de las cuotas' }));
    enviar(container);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta lo que pagó de inicial' })));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('no: el flujo de siempre (un link por todo) o la inicial con su link y las cuotas', async () => {
    const { container } = ventaDe900();
    await elegirStripe();
    fireEvent.click(screen.getByRole('button', { name: 'No, aún no' }));
    expect(screen.getByText(/Generar link de pago de Stripe/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Inicial \+ cuotas: el link cobra la inicial/));
    fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '300' } });
    // La inicial con su link: es la cuota 1, de hoy; el aviso lo dice.
    expect(screen.getByTestId('aviso-como-se-cobra').textContent).toContain('Hoy se cobra la inicial (300 €) con este enlace.');
    enviar(container);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0].importe_pagado).toBe(0);
    await waitFor(() => expect(planMock).toHaveBeenCalledWith(7));
  });

  it('con cobro automático marcado, el aviso dice «un solo enlace» y lo que cobra Stripe solo', async () => {
    permisos.lista = ['links_pago.crear', 'links_pago.cobro_automatico'];
    const { container } = ventaDe900();
    await elegirStripe();
    fireEvent.click(screen.getByRole('button', { name: 'No, aún no' }));
    fireEvent.click(screen.getByLabelText(/Inicial \+ cuotas: el link cobra la inicial/));
    fireEvent.change(container.querySelector('input[aria-label="Cuánto pagó hoy"]'), { target: { value: '300' } });
    fireEvent.click(screen.getByLabelText(/Cobrar automáticamente con Stripe/));
    const texto = screen.getByTestId('aviso-como-se-cobra').textContent;
    expect(texto).toMatch(/Un solo enlace\. Hoy se cobran 300 €\. Después, Stripe cobra solo 200 € el .* con la misma tarjeta\. Total: 900 €\./);
    enviar(container);
    await waitFor(() => expect(planMock).toHaveBeenCalledWith(7, undefined, { cobroAutomatico: true }));
  });
});

describe('3 · Stripe por empresa y campus', () => {
  it('agrupa por empresa (por nombre) y deja los sin empresa al final', () => {
    const grupos = agruparPorEmpresa([{ id: 4 }, { id: 1 }, { id: 3 }, { id: 2 }, { id: 99 }], PROYECTOS, (c) => c.id);
    expect(grupos.map((g) => [g.nombre, g.campus.map((c) => c.id)])).toEqual([
      ['Alfa Educación SL', [3, 2]], ['Zeta Formación SL', [1]], [SIN_EMPRESA, [4, 99]],
    ]);
    expect(stripePrestadoDe({ stripe_prestado_de: { id: 2, nombre: 'ICTESS' } })).toEqual({ id: 2, nombre: 'ICTESS' });
    expect(stripePrestadoDe({})).toBeNull();
  });

  it('«FALTA CONECTAR STRIPE», por empresa; el campus con el Stripe de otro sale conectado', () => {
    permisos.lista = ['integrations.edit'];
    render(
      <MemoryRouter>
        <AvisoConectarStripe proyectos={PROYECTOS} campus={[
          { project_id: 1, nombre: 'Psiko Aprende', codigo: 'sin_clave', motivo: 'No tiene la clave de links.' },
          { project_id: 3, nombre: 'ICTESS US', codigo: 'sin_clave', motivo: 'No tiene la clave de links.', stripe_prestado_de: { id: 2, nombre: 'ICTESS' } },
          { project_id: 4, nombre: 'Campus suelto', codigo: 'clave_sin_permiso', motivo: 'Sin permiso.' },
        ]} />
      </MemoryRouter>,
    );
    const grupos = screen.getAllByTestId('grupo-empresa');
    expect(grupos.map((g) => g.getAttribute('aria-label'))).toEqual(['Empresa Alfa Educación SL', 'Empresa Zeta Formación SL', `Empresa ${SIN_EMPRESA}`]);
    expect(within(grupos[0]).getByText('Usa el Stripe de ICTESS')).toBeTruthy();
    expect(within(grupos[0]).queryByRole('link')).toBeNull();
    expect(within(grupos[1]).getByRole('link', { name: /Conectar Stripe/ })).toBeTruthy();
    expect(within(grupos[2]).getByRole('link', { name: /Cambiar la clave de Stripe/ })).toBeTruthy();
  });

  it('si solo falta el que usa el Stripe de otro, no hay aviso', () => {
    render(<MemoryRouter><AvisoConectarStripe proyectos={PROYECTOS} campus={[
      { project_id: 3, nombre: 'ICTESS US', codigo: 'sin_clave', motivo: 'x', stripe_prestado_de: { id: 2, nombre: 'ICTESS' } },
    ]} /></MemoryRouter>);
    expect(screen.queryByTestId('aviso-conectar-stripe')).toBeNull();
  });

  it('Integraciones › Salud de las conexiones: cada empresa con sus campus; el que usa el Stripe de otro, conectado', async () => {
    const vacia = (resumen) => ({ estado: 'sin_configurar', resumen, ultimaSenal: null, queSenal: null, motivo: null, comprobado: null });
    const bien = { estado: 'bien', resumen: 'Cobros al día', ultimaSenal: null, queSenal: null, motivo: null, comprobado: null };
    get.mockResolvedValue({ success: true, data: {
      comprobado: '2026-11-24T12:00:00Z',
      conexiones: [{ clave: 'stripe', titulo: 'Stripe' }],
      campus: [
        { id: 1, nombre: 'Psiko Aprende', peor: 'bien', casillas: { stripe: bien } },
        { id: 2, nombre: 'ICTESS', peor: 'bien', casillas: { stripe: bien } },
        { id: 3, nombre: 'ICTESS US', peor: 'sin_configurar', casillas: { stripe: vacia('Sin clave de Stripe') }, stripe_prestado_de: { id: 2, nombre: 'ICTESS' } },
        { id: 4, nombre: 'Campus suelto', peor: 'sin_configurar', casillas: { stripe: vacia('Sin clave de Stripe') } },
      ],
    } });
    render(<SaludDeLasConexiones deTodos />);
    const tabla = await screen.findByRole('table', { name: 'Salud de las conexiones por campus' });
    const grupos = within(tabla).getAllByTestId('grupo-empresa');
    expect(grupos.map((g) => g.querySelector('th').textContent.trim())).toEqual(['Alfa Educación SL', 'Zeta Formación SL', SIN_EMPRESA]);
    expect(within(grupos[0]).getByText('ICTESS US')).toBeTruthy();
    expect(within(grupos[0]).getByText('Usa el Stripe de ICTESS')).toBeTruthy();
    expect(within(grupos[1]).getByText('Psiko Aprende')).toBeTruthy();
    expect(within(grupos[2]).getByText('Campus suelto')).toBeTruthy();
    expect(within(grupos[2]).queryByText(/Usa el Stripe/)).toBeNull();
  });
});
