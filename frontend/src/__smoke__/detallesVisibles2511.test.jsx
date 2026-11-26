// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/*
  Detalles visibles del QA del 25/11/2026 (Playwright a 1280 y 375 px).

   · Ficha del alumno a 375 px: el botón flotante de atajos (el rayo, abajo a la derecha)
     tapaba lo último de la ficha. La ficha lleva `pb-24`, como Diplomas y Emisiones.
   · Diplomas › Pendientes a 1280 px: la columna de acciones («Aprobar y emitir»,
     «Rechazar», «Editar») se cortaba por la derecha. La tabla se desliza dentro de su
     caja (TablaDesplazable) y la columna de acciones va fija a la derecha: se ve sin
     deslizar nada. En todas las pestañas con acciones.

  jsdom no maqueta: se fija lo que lo garantiza (las clases). La medida de verdad está en
  Playwright (botón flotante sin tapar nada; botones dentro de su caja y de la pantalla).
*/

const datos = vi.hoisted(() => {
  const fila = (id, nombre, dni, extra = {}) => ({
    matriculaId: id, centro: 'PSIKO', titular: { nombre, email: `alumno${id}@prueba.test`, dni },
    curso: { ref: 12, nombre: 'Diplomado en Prueba' }, notaFinal: 8, umbral: 5, completado: true,
    actividades: { total: 4, calificadas: 4 }, propuesto: true, nexpediente: null,
    solicitud: { en: '2026-10-20T09:00:00Z', nombre }, decision: null, crm: null, edicion: null, firma: null,
    programaCrm: { programa: { horas: 100, modulos: [{ titulo: 'Módulo uno' }] }, formacion: null, motivo: null, editado: false, elegida: false },
    ...extra,
  });
  return {
    pendientes: [fila(1, 'Ana Con Documento', '12345678Z'), fila(2, 'Luis Sin Documento', null)],
    rechazadas: [fila(3, 'Pepa Rechazada', '12345678Z', { decision: { decision: 'rechazada', motivo: 'No pagó', decididoPor: 'x', decididoEn: '2026-10-20T10:00:00Z', refExterna: null } })],
    diplomas: [{
      nexpediente: 'PSIKO-2026-000009-BBBB', centro: 'PSIKO', alumno: 'Rosa Emitida', titulacion: 'Diplomado en Prueba', cursoRef: 12,
      emitidoEn: '2026-10-20T10:00:00Z', emitidaPor: 'Dayana', revocada: false, revocacion: null, verificarUrl: 'https://certifex.test/c/x',
      diplomaUrl: null, aviso: null, emitidoEnCrm: true, imprenta: true,
    }],
    lead: {
      id: 7, nombre: 'María Alumna', email: 'maria@prueba.test', telefono: '+34600111222', origen: 'formulario',
      responsable_id: 3, responsable_nombre: 'Laura', created_at: '2026-09-01T10:00:00Z', interactions: [],
    },
  };
});

vi.mock('@/shared/hooks/useToast', () => ({ toast: () => {}, useToast: () => ({ toasts: [], addListener: () => () => {} }) }));
vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: { conectado: true, nombre: 'CRM de prueba' } }),
    centros: async () => ({ data: [{ codigo: 'PSIKO', nombre: 'Psiko Aprende', moodleUrl: null, logo: null, activo: true, cursos: 1, matriculados: 3, porDecidir: 2, aprobadasSinEmitir: 0, rechazadas: 1, emitidas: 1 }] }),
    cursos: async () => ({ data: [] }),
    listar: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
  },
  diplomasApi: {
    resumen: async () => ({ data: { pendientes: 2, rechazadas: 1, vigentes: 1, revocados: 0, terminados: 0, porAvisar: 0, sinEmitir: 0, porEnviar: 0 } }),
    solicitudes: async (f) => ({ data: f?.estado === 'rechazada'
      ? { filas: datos.rechazadas, total: 1, pagina: 1, tam: 50 }
      : { filas: datos.pendientes, total: datos.pendientes.length, pagina: 1, tam: 50 } }),
    porAvisar: async () => ({ data: { porAvisar: [], sinEmitir: [] } }),
    diplomas: async () => ({ data: { filas: datos.diplomas, total: 1, pagina: 1, tam: 50 } }),
    terminados: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    revertirDisponible: async () => ({ data: { disponible: true, motivo: null } }),
    formaciones: async () => ({ data: { proyecto: null, motivo: null, formaciones: [] } }),
  },
}));

// La ficha: sesión de admin, el cliente y sus compras.
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, nombre: 'Laura', role: 'admin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1 }, projects: [{ id: 1, nombre: 'Uno' }] }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn(async (url) => (url === '/leads/7' ? { success: true, data: datos.lead } : { success: true, data: [] })),
    post: vi.fn(async () => ({ success: true, data: null })),
  },
  API_BASE_URL: '/api', getAccessToken: () => null, setAccessToken: () => {},
}));
vi.mock('@/modules/conversions/api/conversions.api', () => ({ conversionsApi: { byLead: async () => ({ success: true, data: [] }) } }));

const { default: CertifexDiplomasPage } = await import('@/modules/certifex/pages/CertifexDiplomasPage');
const { default: ClientDetailPage } = await import('@/modules/clients/pages/ClientDetailPage');

afterEach(cleanup);

const fija = (el) => expect(el.className, el.outerHTML.slice(0, 120)).toMatch(/\bsticky\b.*\bright-0\b|\bright-0\b.*\bsticky\b/);

async function diplomas(ruta = '/') {
  render(<MemoryRouter initialEntries={[ruta]}><CertifexDiplomasPage /></MemoryRouter>);
}

describe('Diplomas: la columna de acciones se ve sin deslizar (QA 25/11)', () => {
  it('Pendientes: la tabla se desliza dentro de su caja y «Acciones» va fija a la derecha', async () => {
    await diplomas();
    const fila = (await screen.findByText('Ana Con Documento')).closest('tr');
    const tabla = fila.closest('table');
    // Dentro de su caja, que se desliza (no la página).
    const caja = tabla.closest('[role="region"]');
    expect(caja.className).toMatch(/\boverflow-x-auto\b/);
    expect(tabla.className).toMatch(/\bmin-w-\[\d+px\]/);
    // La cabecera y las celdas de acciones, fijas y opacas.
    const th = within(tabla).getByRole('columnheader', { name: 'Acciones' });
    fija(th);
    expect(th.className).toMatch(/\bbg-card\b/);
    for (const nombre of [/Aprobar y emitir/, /^Rechazar/, /^Editar los datos/]) {
      const td = within(fila).getByRole('button', { name: nombre }).closest('td');
      fija(td);
      expect(td.className).toMatch(/\bbg-card\b/);
    }
    // El color de la fila al pasar por encima llega a la celda fija.
    expect(fila.className).toMatch(/\bgroup\b/);
  });

  it('Emitidos y Rechazados: también', async () => {
    await diplomas('/?pestana=enviados');
    const emitida = (await screen.findByText('Rosa Emitida')).closest('tr');
    fija(within(emitida.closest('table')).getByRole('columnheader', { name: 'Acciones' }));
    fija(within(emitida).getByRole('button', { name: /Ver PDF/ }).closest('td'));
    cleanup();
    await diplomas('/?pestana=rechazados');
    const rechazada = (await screen.findByText('Pepa Rechazada')).closest('tr');
    fija(within(rechazada.closest('table')).getByRole('columnheader', { name: 'Acción' }));
  });

  it('el aviso «Desliza la tabla…» solo sale si de verdad no cabe (aquí, sin maqueta, cabe)', async () => {
    await diplomas();
    await screen.findByText('Ana Con Documento');
    expect(screen.queryByTestId('aviso-desliza')).toBeNull();
  });
});

describe('Ficha del alumno: el botón flotante no tapa el final (QA 25/11)', () => {
  it('el contenedor de la ficha deja sitio abajo (pb-24, como Diplomas)', async () => {
    render(
      <MemoryRouter initialEntries={['/ficha/7']}>
        <Routes><Route path="/ficha/:id" element={<ClientDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    const nombre = await screen.findAllByText('María Alumna');
    const ficha = nombre[0].closest('div[class*="max-w-[1100px]"]');
    expect(ficha).not.toBeNull();
    expect(ficha.className).toMatch(/\bpb-24\b/);
    expect(ficha.className).not.toMatch(/\bpb-8\b/);
  });
});
