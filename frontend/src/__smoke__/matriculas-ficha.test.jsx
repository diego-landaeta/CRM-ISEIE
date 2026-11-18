// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #199 · la ficha de una matrícula, en panel lateral (ideas de Diego del 01/10):
 * cabecera, datos de la persona con copiar, documentos con visor y «Reemplazar»,
 * vínculos, historial y las acciones según el estado.
 */

const { get, patch, openPdf } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), openPdf: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), patch }, API_BASE_URL: '/crm/api' }));
vi.mock('@/modules/invoices/api/invoices.api', () => ({ invoicesApi: { openPdf } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

import MatriculaDetail from '@/modules/matriculas/components/MatriculaDetail';

afterEach(cleanup);

const FICHA = {
  id: 1, estado: 'solicitud_admision', lead_id: 3912, conversion_id: null,
  lead_nombre: 'María López', lead_email: 'maria@x.es', lead_telefono: '+34600111222',
  curso: 'Máster en Psicología Clínica', campus_nombre: 'ISEIE Madrid', gestora_nombre: 'Ana',
  source: 'webhook', recibida_at: '2026-10-01T07:12:00Z',
  dni_doc_url: '/api/matriculas/1/doc/dni?exp=1&sig=a', documentos_formato: { dni: 'imagen' },
  titulo_doc_url: '/api/matriculas/1/doc/titulo?exp=1&sig=b',
  datos_admision: { documento_tipo: 'DNI', documento: '11111111A', fecha_nacimiento: '1995-04-12', direccion: 'Calle 1, Madrid', pais: 'España', estudios: 'Grado' },
  historial: [
    { evento: 'recibida', creado_at: '2026-10-01T07:12:00Z' },
    { evento: 'estado', estado: 'datos_validados', usuario: 'Mireia', creado_at: '2026-10-01T09:40:00Z' },
    { evento: 'documento', documento: 'dni_dorso', reemplazo: false, usuario: 'Mireia', creado_at: '2026-10-02T08:00:00Z' },
    { evento: 'documento', documento: 'dni', reemplazo: true, usuario: 'Ana', creado_at: '2026-10-03T08:00:00Z' },
    { evento: 'estado', estado: 'rechazada', motivo: 'El título no se lee', usuario: 'Mireia', creado_at: '2026-10-04T08:00:00Z' },
    { evento: 'documento', documento: 'foto', reemplazo: false, usuario: 'Ana', creado_at: '2026-10-05T08:00:00Z' },
    { evento: 'documento', documento: 'firma', reemplazo: true, usuario: 'Ana', creado_at: '2026-10-06T08:00:00Z' },
  ],
};

const abrir = (matricula = FICHA, onEstado = vi.fn()) => {
  render(<MemoryRouter><MatriculaDetail matricula={matricula} onClose={() => {}} onChange={() => {}} onEstado={onEstado} /></MemoryRouter>);
  return onEstado;
};
const boton = (nombre) => screen.queryByRole('button', { name: new RegExp(nombre) });

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async () => ({ success: true, data: FICHA }));
});

describe('las acciones de la ficha según el estado', () => {
  it('en Solicitud: «Validar datos» (pasa a Datos validados) y «Rechazar»', () => {
    const onEstado = abrir({ ...FICHA, estado: 'solicitud_admision' });
    expect(boton('Validar matrícula')).toBeNull();
    fireEvent.click(boton('Validar datos'));
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'datos_validados');
    expect(boton('Rechazar')).not.toBeNull();
  });

  it.each(['datos_validados', 'pendiente'])('en %s: «Validar matrícula» (pasa a Validada) y «Rechazar»', async (estado) => {
    get.mockImplementation(async () => ({ success: true, data: { ...FICHA, estado } }));
    const onEstado = abrir({ ...FICHA, estado });
    expect(boton('Validar datos')).toBeNull();
    fireEvent.click(boton('Validar matrícula'));
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'validada');
    expect(boton('Rechazar')).not.toBeNull();
  });

  it('en Validada: solo «Rechazar»', async () => {
    get.mockImplementation(async () => ({ success: true, data: { ...FICHA, estado: 'validada' } }));
    abrir({ ...FICHA, estado: 'validada' });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(boton('Validar datos')).toBeNull();
    expect(boton('Validar matrícula')).toBeNull();
    expect(boton('Rechazar')).not.toBeNull();
  });

  it('en Rechazada: ninguna, y se ve el motivo', async () => {
    const rechazada = { ...FICHA, estado: 'rechazada', motivo_rechazo: 'El DNI no se lee' };
    get.mockImplementation(async () => ({ success: true, data: rechazada }));
    abrir(rechazada);
    expect(boton('Validar')).toBeNull();
    expect(boton('Rechazar')).toBeNull();
    expect(screen.getByText(/El DNI no se lee/)).toBeTruthy();
  });
});

describe('la ficha en panel lateral, como la de los prospectos', () => {
  it('cabecera: el nombre, el estado, el curso y el campus (sin un punto suelto)', async () => {
    abrir();
    expect(screen.getByRole('heading', { name: 'María López' })).toBeTruthy();
    expect(screen.getAllByText('Solicitud admisión').length).toBeGreaterThan(0);
    expect(screen.getByText('Máster en Psicología Clínica · ISEIE Madrid')).toBeTruthy();
  });

  it('datos de la persona, del formulario, con botón para copiar', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    abrir();
    expect(screen.getByText('DNI 11111111A')).toBeTruthy();
    expect(screen.getByText('12/04/1995')).toBeTruthy();
    expect(screen.getByText('Calle 1, Madrid')).toBeTruthy();
    expect(screen.getByText('España')).toBeTruthy();
    expect(screen.getByText('Grado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar teléfono' }));
    expect(writeText).toHaveBeenCalledWith('+34600111222');
  });

  it('el país va en su fila: sin dirección, «Dirección» no enseña el país (#198, prueba a mano)', () => {
    abrir({ ...FICHA, datos_admision: { ...FICHA.datos_admision, direccion: undefined } });
    const fila = (etiqueta) => screen.getByText(etiqueta, { selector: 'p, span, dt, div' }).parentElement?.textContent || '';
    expect(fila('Dirección')).not.toContain('España');
    expect(fila('Dirección')).toContain('No indicado');
    expect(fila('País')).toContain('España');
  });

  it('#198: con el webhook mapeado, los datos salen de los campos propios aunque el formulario los llame de otra forma', async () => {
    const mapeada = {
      ...FICHA,
      dni: 'X1234567L', documento_tipo: 'NIE', fecha_nacimiento: '1990-05-17T00:00:00.000Z',
      direccion: 'C/ Mayor 1', pais: 'Portugal', estudios: 'Máster',
      datos_admision: { 'your-doc': 'X1234567L', 'fecha-nac': '17/05/1990', 'your-address': 'C/ Mayor 1' },
    };
    get.mockImplementation(async () => ({ success: true, data: mapeada }));
    abrir(mapeada);
    expect(screen.getByText('NIE X1234567L')).toBeTruthy();
    expect(screen.getByText('17/05/1990')).toBeTruthy();
    expect(screen.getByText('C/ Mayor 1')).toBeTruthy();
    expect(screen.getByText('Portugal')).toBeTruthy();
    expect(screen.getByText('Máster')).toBeTruthy();
  });

  it('documentos: miniatura, visor grande y «Reemplazar»; el aviso si no abre', async () => {
    abrir();
    // Los cinco de Diego, todos con su botón: «Reemplazar» en los que hay y «Subir» en los que faltan.
    expect(screen.getAllByText('Reemplazar').length).toBe(2);
    expect(screen.getAllByText('Subir').length).toBe(3);
    expect(screen.getByLabelText('Subir DNI (detrás)')).toBeTruthy();
    expect(screen.getByLabelText('Subir Foto')).toBeTruthy();
    expect(screen.queryByText(/llega con el formulario/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver DNI (delante)' }));
    expect(await screen.findByRole('dialog', { name: 'Visor: DNI (delante)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar visor' }));
    expect(screen.queryByRole('dialog', { name: /Visor/ })).toBeNull();
    // Una imagen que no carga: el texto de Diego.
    fireEvent.error(screen.getByAltText('DNI (delante)'));
    expect(screen.getByText('No se pudo abrir el DNI (delante). Vuelve a intentarlo; si sigue, súbelo de nuevo.')).toBeTruthy();
  });

  it('el documento se pide dentro del CRM (/crm/api/…), no fuera (/api/…, 404)', async () => {
    abrir();
    expect(screen.getByAltText('DNI (delante)').getAttribute('src')).toBe('/crm/api/matriculas/1/doc/dni?exp=1&sig=a');
  });

  it('un PDF se abre en el visor de PDF', async () => {
    const conPdf = { ...FICHA, documentos_formato: { dni: 'pdf' } };
    get.mockImplementation(async () => ({ success: true, data: conPdf }));
    abrir(conPdf);
    fireEvent.click(screen.getByRole('button', { name: 'Ver DNI (delante)' }));
    expect((await screen.findByTitle('DNI (delante)')).tagName).toBe('IFRAME');
  });

  it('vínculos: su prospecto, su venta y su gestora', async () => {
    abrir({ ...FICHA, conversion_id: 44 });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/matriculas/1'));
    expect(screen.getByRole('link', { name: /Ver prospecto/ }).getAttribute('href')).toBe('/leads/3912');
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('historial: cada cosa que le ha pasado, con quién y cuándo, en hora de Madrid', async () => {
    abrir();
    expect(screen.getByText(/Recibida por el formulario el 01 oct 2026, 0?9:12/)).toBeTruthy();
    expect(screen.getByText(/Datos validados por Mireia el 01 oct 2026, 11:40/)).toBeTruthy();
    expect(screen.getByText(/DNI \(detrás\) subido por Mireia el 02 oct 2026/)).toBeTruthy();
    expect(screen.getByText(/DNI \(delante\) reemplazado por Ana el 03 oct 2026/)).toBeTruthy();
    expect(screen.getByText(/Rechazada por Mireia el 04 oct 2026, 10:00\. Motivo: El título no se lee/)).toBeTruthy();
    // En femenino lo que es femenino (prueba a mano del 15/10: «Foto subido»).
    expect(screen.getByText(/^Foto subida por Ana el 05 oct 2026/)).toBeTruthy();
    expect(screen.getByText(/^Firma reemplazada por Ana el 06 oct 2026/)).toBeTruthy();
  });
});

// Revisión final del 15/10.
describe('detalles de la ficha', () => {
  it('el aviso de un documento que no abre, en minúscula salvo el DNI', async () => {
    const conTitulo = { ...FICHA, titulo_doc_url: '/api/matriculas/1/doc/titulo?exp=1&sig=b', documentos_formato: { dni: 'imagen', titulo: 'imagen' } };
    get.mockImplementation(async () => ({ success: true, data: conTitulo }));
    abrir(conTitulo);
    fireEvent.error(screen.getByAltText('Título'));
    expect(screen.getByText('No se pudo abrir el título. Vuelve a intentarlo; si sigue, súbelo de nuevo.')).toBeTruthy();
  });
});

describe('lo que salió en la revisión de la ficha', () => {
  it('el visor pide un enlace nuevo antes de abrirse (los firmados caducan a los 15 minutos)', async () => {
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    get.mockImplementation(async () => ({ success: true, data: { ...FICHA, dni_doc_url: '/api/matriculas/1/doc/dni?exp=2&sig=nueva' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver DNI (delante)' }));
    const visor = await screen.findByRole('dialog', { name: 'Visor: DNI (delante)' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(visor.querySelector('img').getAttribute('src')).toBe('/crm/api/matriculas/1/doc/dni?exp=2&sig=nueva');
  });

  it('«Reintentar» vuelve a pedir la ficha y quita el aviso', async () => {
    abrir();
    fireEvent.error(screen.getByAltText('DNI (delante)'));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByText(/No se pudo abrir el DNI \(delante\)/)).toBeNull());
    expect(screen.getByAltText('DNI (delante)')).toBeTruthy();
  });

  it('con la ventana de «Rechazar» encima, Esc no cierra la ficha', () => {
    const onClose = vi.fn();
    render(<MemoryRouter><MatriculaDetail matricula={FICHA} onClose={onClose} onChange={() => {}} onEstado={vi.fn()} pausada /></MemoryRouter>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sin ventana encima, Esc la cierra', () => {
    const onClose = vi.fn();
    render(<MemoryRouter><MatriculaDetail matricula={FICHA} onClose={onClose} onChange={() => {}} onEstado={vi.fn()} /></MemoryRouter>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('lo escrito en «A mano» no lo pisa la ficha que llega del servidor', async () => {
    let soltar;
    get.mockImplementation(() => new Promise((r) => { soltar = () => r({ success: true, data: { ...FICHA, notas: 'del servidor' } }); }));
    abrir();
    fireEvent.change(screen.getByRole('textbox', { name: /Notas/i }), { target: { value: 'lo que escribo' } });
    soltar();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('textbox', { name: /Notas/i }).value).toBe('lo que escribo');
  });
});

describe('la firma, sobre papel blanco', () => {
  // Llega con el fondo transparente (#198) y el trazo oscuro no se veía en modo oscuro.
  it('la miniatura de la firma va sobre blanco y entera; las demás, como siempre', () => {
    abrir({ ...FICHA, firma_url: '/api/matriculas/1/doc/firma?exp=1&sig=c', documentos_formato: { dni: 'imagen', firma: 'imagen' } });
    const firma = screen.getByRole('button', { name: 'Ver Firma' });
    expect(firma.className).toContain('bg-white');
    expect(firma.querySelector('img').className).toContain('object-contain');
    expect(screen.getByRole('button', { name: /Ver DNI/ }).className).not.toContain('bg-white');
  });
});

// 13/11/2026: «que esos datos de matriculación se puedan vincular a su gestora y a las facturas».
describe('la gestora y las facturas, desde la ficha de la matrícula', () => {
  const abrirCon = (matricula, props) => render(
    <MemoryRouter><MatriculaDetail matricula={matricula} onClose={() => {}} onChange={() => {}} {...props} /></MemoryRouter>);

  it('las facturas de la venta: número, fecha, importe, estado y su PDF', async () => {
    const ficha = { ...FICHA, conversion_id: 44 };
    get.mockImplementation(async (url) => (url.startsWith('/invoices/') ? { success: true, data: [
      { id: 9, codigo: 'A-2026-0101', tipo: 'normal', estado: 'pagada', fecha_emision: '2026-11-03', total: '250.00', moneda: 'EUR' },
      { id: 10, codigo: 'A-2026-0090', tipo: 'proforma', estado: 'emitida', fecha_emision: '2026-10-20T00:00:00.000Z', total: '500.00', moneda: 'USD', total_divisa: '540.00' },
    ] } : { success: true, data: ficha }));
    openPdf.mockResolvedValue(undefined);
    abrirCon(ficha, { verFacturas: true });
    const lista = await screen.findByRole('region', { name: 'Facturas de la venta' });
    expect(get).toHaveBeenCalledWith('/invoices/by-conversion/44?todas=1');
    expect(lista.textContent).toContain('A-2026-0101');
    expect(lista.textContent).toContain('03/11/2026');
    expect(lista.textContent).toContain('Pagada');
    expect(lista.textContent).toMatch(/250,00\s*€/);
    // La proforma, marcada, y en su moneda.
    expect(lista.textContent).toContain('(proforma)');
    expect(lista.textContent).toContain('20/10/2026');
    expect(lista.textContent).toMatch(/540,00/);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir la factura A-2026-0101' }));
    expect(openPdf).toHaveBeenCalledWith(9);
  });

  it('la venta sin facturas lo dice', async () => {
    const ficha = { ...FICHA, conversion_id: 45 };
    get.mockImplementation(async (url) => (url.startsWith('/invoices/') ? { success: true, data: [] } : { success: true, data: ficha }));
    abrirCon(ficha, { verFacturas: true });
    expect(await screen.findByText('La venta aún no tiene facturas.')).toBeTruthy();
  });

  it('sin permiso para ver facturas, ni se piden ni se ven', async () => {
    const ficha = { ...FICHA, conversion_id: 44 };
    get.mockImplementation(async () => ({ success: true, data: ficha }));
    abrirCon(ficha, { verFacturas: false });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.some(([url]) => url.startsWith('/invoices/'))).toBe(false);
    expect(screen.queryByRole('region', { name: 'Facturas de la venta' })).toBeNull();
  });

  it('«Asignar» la gestora: solo gestoras y admins del campus, con la reasignación de siempre', async () => {
    const ficha = { ...FICHA, gestora_id: null, gestora_nombre: null, project_id: 5 };
    get.mockImplementation(async (url) => (url.startsWith('/users') ? { success: true, data: [
      { id: 7, nombre: 'Lucía', role: 'gestor' }, { id: 8, nombre: 'Un tutor', role: 'tutor' }, { id: 9, nombre: 'Elena', role: 'admin' },
    ] } : { success: true, data: ficha }));
    patch.mockResolvedValue({ success: true });
    abrirCon(ficha, { puedeAsignar: true });
    expect(screen.getByText('Sin gestora')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }));
    const selector = screen.getByLabelText('Gestora de la ficha');
    await waitFor(() => expect([...selector.options].map((o) => o.textContent)).toEqual(['Elige una gestora', 'Lucía', 'Elena']));
    const pedido = get.mock.calls.map(([url]) => url).find((url) => url.startsWith('/users'));
    expect(new URLSearchParams(pedido.split('?')[1]).get('projectId')).toBe('5');
    fireEvent.change(selector, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/leads/3912/reassign', { responsable_id: 7 }));
  });

  it('con gestora, «Cambiar»; sin permiso o sin ficha, ningún botón', () => {
    const { unmount } = abrirCon({ ...FICHA, gestora_id: 4 }, { puedeAsignar: true });
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeTruthy();
    unmount();
    const sinPermiso = abrirCon({ ...FICHA, gestora_id: 4 }, { puedeAsignar: false });
    expect(screen.queryByRole('button', { name: /^(Cambiar|Asignar)$/ })).toBeNull();
    sinPermiso.unmount();
    abrirCon({ ...FICHA, lead_id: null, gestora_id: null, gestora_nombre: null }, { puedeAsignar: true });
    expect(screen.queryByRole('button', { name: /^(Cambiar|Asignar)$/ })).toBeNull();
  });
});
