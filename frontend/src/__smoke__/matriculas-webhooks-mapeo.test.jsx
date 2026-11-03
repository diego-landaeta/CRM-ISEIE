// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

/**
 * #198 · mapear un campo de la muestra en «Webhooks de admisión»: elegir en la
 * ventanita «Mapear campo del payload» no puede cerrar el editor (el clic subía
 * hasta el fondo del editor y lo cerraba sin mapear; lo vio Diana en su prueba).
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

import WebhooksTab from '@/modules/matriculas/components/WebhooksTab';

afterEach(cleanup);

const TOKEN = {
  id: 7, project_id: 1, kind: 'matriculas', token: 'matriculas_abc', active: true, notas: 'Prueba Diana',
  field_mapping: {}, uses_count: 0, last_used_at: null, awaiting_sample: false,
  sample_payload: { 'your-name': 'Ana Prueba Diana', 'dni-front': { __archivo: 'dni-front', __indice: 0, nombre: 'dni-delante.jpg', tamano: 1000 } },
};

async function abrirEditor() {
  get.mockResolvedValue({ success: true, data: [TOKEN] });
  render(<WebhooksTab project={{ id: 1 }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
  return screen.getByRole('dialog', { name: 'Editar webhook de admisión' });
}

async function mapear(valor, destino) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(valor) }));
  fireEvent.click(await screen.findByRole('combobox'));
  fireEvent.mouseDown(screen.getByRole('option', { name: destino }));
  fireEvent.click(screen.getByRole('button', { name: 'Mapear' }));
}

describe('mapear la muestra del webhook de admisión', () => {
  it('elegir el destino y «Mapear» deja el editor abierto, con el campo mapeado', async () => {
    await abrirEditor();
    await mapear('Ana Prueba Diana', 'Nombre');
    await waitFor(() => expect(screen.getByRole('button', { name: /Ana Prueba Diana ← nombre/ })).toBeTruthy());
    expect(screen.getByRole('dialog', { name: 'Editar webhook de admisión' })).toBeTruthy();
  });

  it('un archivo «📎» se mapea igual', async () => {
    await abrirEditor();
    await mapear('dni-delante.jpg', 'DNI · delante (archivo)');
    await waitFor(() => expect(screen.getByRole('button', { name: /dni-delante\.jpg ← dni_frente/ })).toBeTruthy());
  });

  it('pulsar el fondo oscuro sigue cerrando el editor', async () => {
    const editor = await abrirEditor();
    fireEvent.click(editor.parentElement);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar webhook de admisión' })).toBeNull());
  });
});
