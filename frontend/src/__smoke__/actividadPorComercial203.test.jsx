// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  #203, parte B: «Actividad por comercial» en Reportes y en el Dashboard,
  pintada de verdad (comentario de Diego del 27/10).

  - Atajos Hoy · Ayer · Esta semana · Este mes, con Ayer por defecto.
  - Una fila por gestora, como llega del servidor (ordenada por llamadas).
  - «Llamadas registradas en el CRM», no «llamadas».
  - Al pulsar un número se abre la lista: lead, hora y nota.
  - La tarjeta: al admin, el equipo y «Ver todo»; a una gestora, su línea.
*/

const get = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => get(...a) } }));
let rol = 'admin';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: rol } }) }));

const { default: ActividadPorComercial, TarjetaActividad } = await import('@/modules/reports/components/ActividadPorComercial');

const fila = (user_id, comercial, n = {}) => ({
  user_id, comercial, llamadas: 0, whatsapp: 0, whatsapp_texto: 0, whatsapp_voz: 0,
  correos: 0, notas: 0, personas: 0, toques: 0, ...n,
});
const ACTIVIDAD = {
  desde: '2026-10-28',
  hasta: '2026-10-28',
  filas: [
    fila(7, 'Yolanda', { llamadas: 5, whatsapp: 15, whatsapp_texto: 12, whatsapp_voz: 3, correos: 1, personas: 12, toques: 21 }),
    fila(8, 'Dayana', { llamadas: 2, whatsapp: 15, correos: 2, personas: 18, toques: 19 }),
    fila(9, 'Ana', { whatsapp: 21, personas: 21, toques: 21 }),
  ],
  equipo: { llamadas: 7, whatsapp: 51, whatsapp_texto: 12, whatsapp_voz: 3, correos: 3, notas: 0, personas: 50, toques: 61 },
};

beforeEach(() => {
  rol = 'admin';
  get.mockReset();
  get.mockImplementation((url) => {
    if (url.startsWith('/informes/actividad-comercial/detalle')) {
      return Promise.resolve({ data: [
        { id: 1, lead_id: 41, lead: 'Laura Pérez', tipo: 'llamada', fecha: '2026-10-28T08:30:00Z', nota: 'le interesa el máster' },
      ] });
    }
    return Promise.resolve({ data: ACTIVIDAD });
  });
});

const pintar = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('el bloque de Reportes (#203 B)', () => {
  it('arranca en «Ayer» y pide con el ámbito de la pantalla', async () => {
    pintar(<ActividadPorComercial ambito={{ issuerId: 3 }} />);
    expect(screen.getByRole('button', { name: 'Ayer' })).toHaveAttribute('aria-pressed', 'true');
    const url = get.mock.calls[0][0];
    expect(url).toMatch(/^\/informes\/actividad-comercial\?/);
    expect(url).toContain('issuerId=3');
    const p = new URLSearchParams(url.split('?')[1]);
    expect(p.get('desde')).toBe(p.get('hasta')); // un solo día
    // Los cuatro atajos de la issue, y ninguno más.
    const grupo = screen.getByRole('group', { name: 'Periodo de la actividad' });
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hoy', 'Ayer', 'Esta semana', 'Este mes']);
  });

  it('una fila por gestora, en el orden del servidor, y dice «llamadas registradas»', async () => {
    pintar(<ActividadPorComercial ambito={{}} />);
    await screen.findByText('Yolanda');
    const filas = screen.getAllByRole('row').slice(1, -1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(filas).toEqual(['Yolanda', 'Dayana', 'Ana']);
    expect(screen.getByRole('columnheader', { name: 'Llamadas registradas' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Llamadas' })).toBeNull();
    // La fila del equipo.
    expect(within(screen.getAllByRole('row').at(-1)).getByText('Equipo')).toBeInTheDocument();
  });

  it('cambiar de atajo vuelve a pedir con otro periodo', async () => {
    pintar(<ActividadPorComercial ambito={{}} />);
    await screen.findByText('Yolanda');
    fireEvent.click(screen.getByRole('button', { name: 'Este mes' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    const p = new URLSearchParams(get.mock.calls[1][0].split('?')[1]);
    expect(p.get('desde').slice(8)).toBe('01');
  });

  it('al pulsar un número se abre la lista: lead, hora y nota', async () => {
    pintar(<ActividadPorComercial ambito={{ projectId: 2 }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Llamadas de Yolanda' }));
    const dialogo = await screen.findByRole('dialog');
    expect(await within(dialogo).findByText('Laura Pérez')).toHaveAttribute('href', '/leads/41');
    expect(within(dialogo).getByText('le interesa el máster')).toBeInTheDocument();
    // 08:30 UTC = 09:30 en Madrid (el 28/10 ya es horario de invierno).
    expect(within(dialogo).getByText(/09:30/)).toBeInTheDocument();
    const url = get.mock.calls.at(-1)[0];
    expect(url).toContain('userId=7');
    expect(url).toContain('tipo=llamada');
    expect(url).toContain('projectId=2');
  });

  it('quien solo escribió notas no sale (las notas no son contactos); el equipo no cambia', async () => {
    const soloNotas = fila(10, 'Angel', { notas: 1 });
    get.mockResolvedValue({ data: { ...ACTIVIDAD, filas: [...ACTIVIDAD.filas, soloNotas] } });
    pintar(<ActividadPorComercial ambito={{}} />);
    await screen.findByText('Yolanda');
    expect(screen.queryByText('Angel')).toBeNull();
    expect(within(screen.getAllByRole('row').at(-1)).getByText('7')).toBeInTheDocument();
  });

  it('quien solo mandó WhatsApp (sin contacto apuntado) sí sale', async () => {
    get.mockResolvedValue({ data: { ...ACTIVIDAD, filas: [fila(11, 'Marta', { whatsapp_texto: 3 })] } });
    pintar(<ActividadPorComercial ambito={{}} />);
    expect(await screen.findByText('Marta')).toBeInTheDocument();
  });

  it('los ceros no se pulsan', async () => {
    pintar(<ActividadPorComercial ambito={{}} />);
    await screen.findByText('Ana');
    expect(screen.queryByRole('button', { name: 'Llamadas de Ana' })).toBeNull();
  });
});

describe('la tarjeta del Dashboard (#203 B)', () => {
  it('al admin: el equipo, las 3 primeras y «Ver todo»', async () => {
    pintar(<TarjetaActividad ambito={{}} />);
    expect(await screen.findByText('7 llamadas registradas · 51 WhatsApp · 3 correos')).toBeInTheDocument();
    expect(screen.getByText('Yolanda')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver todo/ })).toHaveAttribute('href', '/informes');
  });

  it('la tarjeta tampoco pone entre las 3 primeras a quien solo escribió notas', async () => {
    get.mockResolvedValue({ data: { ...ACTIVIDAD, filas: [fila(10, 'Angel', { notas: 2 }), ...ACTIVIDAD.filas] } });
    pintar(<TarjetaActividad ambito={{}} />);
    await screen.findByText('Yolanda');
    expect(screen.queryByText('Angel')).toBeNull();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('a una gestora: solo su línea, sin «Ver todo»', async () => {
    rol = 'gestor';
    get.mockResolvedValue({ data: { ...ACTIVIDAD, filas: [ACTIVIDAD.filas[1]], equipo: { ...ACTIVIDAD.filas[1] } } });
    pintar(<TarjetaActividad ambito={{}} />);
    expect(await screen.findByText('Ayer: 2 llamadas registradas · 15 WhatsApp · 2 correos')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ver todo/ })).toBeNull();
  });
});
