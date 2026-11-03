// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

/*
  El tutorial de Plantillas de WhatsApp (#576): son cuatro pasos y se veían
  tres. «Los datos los pone el CRM» señala los datos que se insertan, que solo
  están en «Editar», y la pantalla abre en «Consultar»: el paso no encontraba
  su objetivo y se saltaba. Además, una vez visto no había forma de repetirlo.
*/

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'gestor' }, permissions: {} }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1, nombre: 'ISEIE Online' }, activeIssuerId: null }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/modules/whatsapp/api/whatsapp.api', () => ({
  whatsappApi: {
    plantillas: vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 1, project_id: 1, label: 'Día 1 · Saludo', body: 'Hola {nombre}', ambito: 'compartida', owner_id: null, orden: 1 }],
    }),
  },
}));

const { default: PlantillasPage } = await import('@/modules/whatsapp/pages/PlantillasPage');

const siguiente = () => fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
const ESPERA = { timeout: 3000 };

beforeEach(() => { localStorage.clear(); });

describe('El tutorial de Plantillas (#576)', () => {
  it('enseña los cuatro pasos, también el de los datos que se insertan', async () => {
    render(<MemoryRouter><PlantillasPage /></MemoryRouter>);
    expect(await screen.findByText('Tus plantillas, guardadas aquí')).toBeInTheDocument();
    siguiente();
    expect(await screen.findByText('Consultar o editar')).toBeInTheDocument();
    siguiente();
    // Antes, de aquí se pasaba directamente a «Se copia, no se envía».
    expect(await screen.findByText('Los datos los pone el CRM')).toBeInTheDocument();
    expect(screen.getByText('3 de 4')).toBeInTheDocument();
    // Y la pantalla está en «Editar», que es donde están los datos.
    expect(document.querySelector('[data-tour="insertar"]')).not.toBeNull();
    siguiente();
    // El último vuelve a «Consultar», que es donde está el botón de copiar.
    expect(await screen.findByText('Se copia, no se envía')).toBeInTheDocument();
    expect(document.querySelector('[data-tour="copiar"]')).not.toBeNull();
    // Se mira un rato: si el paso se saltara, el recorrido se cerraría.
    await new Promise((r) => setTimeout(r, 1800));
    expect(screen.getByText('Se copia, no se envía')).toBeInTheDocument();
  }, 10000);

  it('el botón «Tutorial» lo vuelve a abrir', async () => {
    localStorage.setItem('wa-tour-plantillas-visto-v1', '1');
    render(<MemoryRouter><PlantillasPage /></MemoryRouter>);
    await screen.findByText('Día 1 · Saludo', undefined, ESPERA);
    expect(screen.queryByText('Tus plantillas, guardadas aquí')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver el tutorial' }));
    expect(await screen.findByText('Tus plantillas, guardadas aquí')).toBeInTheDocument();
  });
});
