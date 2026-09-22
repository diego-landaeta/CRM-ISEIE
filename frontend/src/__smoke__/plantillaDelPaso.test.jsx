// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  El mensaje del paso, donde se trabaja (#88 · #89 · #90).

  Las plantillas estaban cargadas y rellenas desde el #129, pero solo se llegaba
  a ellas desde el chat: en la cola del día y en la ficha no había ninguna. Lo
  que faltaba no era el texto sino el vínculo —`paso_clave`—, y sin él la cola
  no podía ofrecer «la plantilla de esta persona».

  Lo que se prueba es justo eso: que sale la del paso y NO las de los otros, que
  sale rellena, que copiar copia y avisa a quien lo apunta, y que un hueco que
  el CRM no sabe rellenar se avisa en vez de colarse en el mensaje.
*/

const plantillas = vi.fn();
vi.mock('@/modules/whatsapp/api/whatsapp.api', () => ({
  whatsappApi: { plantillas: (...a) => plantillas(...a) },
}));

const copiado = vi.fn();
vi.mock('@/shared/lib/clipboard', () => ({
  copyToClipboard: (...a) => copiado(...a),
}));

vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

import PlantillaDelPaso from '@/modules/proceso/components/PlantillaDelPaso';

const LISTA = [
  { id: 10, label: 'Día 1 · Saludo', body: 'Hola {nombre}, te escribo por {producto}.', ambito: 'compartida', orden: 1, paso_clave: 'paso_1' },
  { id: 21, label: 'Día 2 · Opiniones · 1 de 3', body: '{nombre}, mira lo que dicen.', ambito: 'compartida', orden: 1, paso_clave: 'paso_2' },
  { id: 22, label: 'Día 2 · Opiniones · 2 de 3', body: 'Esta es de la promoción pasada.', ambito: 'compartida', orden: 2, paso_clave: 'paso_2', pide_adjunto: true },
  { id: 23, label: 'Día 2 · Opiniones · 3 de 3', body: '¿Te resuelvo alguna duda?', ambito: 'compartida', orden: 3, paso_clave: 'paso_2' },
  { id: 90, label: 'Reactivar', body: 'Hace tiempo que no hablamos.', ambito: 'personal', orden: 1, paso_clave: null },
];

const MARTA = {
  nombre: 'Marta Ruiz Díaz',
  email: 'marta@ejemplo.com',
  telefono: '+34600111222',
  producto: 'Máster en Logopedia',
};

const montar = (props = {}) => render(
  <MemoryRouter>
    <PlantillaDelPaso
      projectId={1}
      pasoClave="paso_2"
      datos={MARTA}
      nombreProyecto="Psiko Aprende"
      {...props}
    />
  </MemoryRouter>
);

beforeEach(() => {
  plantillas.mockReset().mockResolvedValue({ success: true, data: LISTA });
  copiado.mockReset().mockResolvedValue(true);
});

// A mano y no por el arranque de las pruebas: los dos CRM no lo montan igual
// —uno declara el entorno en su configuracion y el otro en cada fichero— y sin
// esto la segunda prueba encuentra pintada tambien la primera.
afterEach(cleanup);

describe('el mensaje de este paso', () => {
  it('saca las del paso que toca y NINGUNA de los demás', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Día 2 · Opiniones · 1 de 3')).toBeTruthy());
    expect(screen.getByText('Día 2 · Opiniones · 3 de 3')).toBeTruthy();
    // La del paso 1 y la suelta no pintan aquí: ofrecer el mensaje equivocado
    // es peor que no ofrecer ninguno.
    expect(screen.queryByText('Día 1 · Saludo')).toBeNull();
    expect(screen.queryByText('Reactivar')).toBeNull();
  });

  it('el día 2 son tres mensajes seguidos, numerados y en su orden', async () => {
    // «Si no cabe en la pantalla del móvil sin desplazarse, parte el mensaje.»
    // El orden es media instrucción, así que se numera.
    montar();
    await waitFor(() => expect(screen.getByText('1 de 3')).toBeTruthy());
    expect(screen.getByText('2 de 3')).toBeTruthy();
    expect(screen.getByText('3 de 3')).toBeTruthy();
  });

  it('sale RELLENO, no con las llaves crudas', async () => {
    montar({ pasoClave: 'paso_1' });
    await waitFor(() => expect(
      screen.getByText('Hola Marta, te escribo por Máster en Logopedia.'),
    ).toBeTruthy());
  });

  it('copiar copia el texto ya relleno y avisa a quien lo apunta', async () => {
    const alCopiar = vi.fn();
    montar({ pasoClave: 'paso_1', alCopiar });
    await waitFor(() => expect(screen.getByText('Día 1 · Saludo')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Copiar/ }));
    await waitFor(() => expect(copiado).toHaveBeenCalledWith('Hola Marta, te escribo por Máster en Logopedia.'));
    // Quien lo reciba deja la NOTA en su ficha. No un contacto: copiar no es
    // hablar con nadie, y si contara, la persona saldría de la cola por haber
    // copiado un texto que igual no se envió.
    await waitFor(() => expect(alCopiar).toHaveBeenCalled());
    expect(alCopiar.mock.calls[0][0].label).toBe('Día 1 · Saludo');
  });

  it('un hueco que el CRM no sabe rellenar se AVISA, no se cuela', async () => {
    plantillas.mockResolvedValue({
      success: true,
      data: [{ id: 1, label: 'Día 3 · Plazas', body: 'Quedan {plazas} plazas.', orden: 1, paso_clave: 'paso_3' }],
    });
    montar({ pasoClave: 'paso_3' });
    await waitFor(() => expect(screen.getByText(/Falta \{plazas\}/)).toBeTruthy());
  });

  it('sin plantilla para el paso, dice dónde se escribe una', async () => {
    montar({ pasoClave: 'paso_4' });
    await waitFor(() => expect(screen.getByText(/no tiene mensaje guardado/)).toBeTruthy());
    expect(screen.getByText('Escribir uno')).toBeTruthy();
  });

  it('si el CRM no lleva WhatsApp, no enseña un error: no enseña nada', async () => {
    // El endpoint de plantillas no existe cuando el módulo no está instalado.
    // Una pantalla con un error rojo por una pieza que este CRM no tiene es
    // ruido: la cola sigue sirviendo igual.
    plantillas.mockRejectedValue(new Error('404'));
    const { container } = montar({ compacto: true });
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
