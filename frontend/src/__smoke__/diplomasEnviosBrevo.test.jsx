// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

/*
  Justificante del envío del diploma (Diego, 05/11/2026).

   · «Aviso al alumno» en Emitidos: «Enviado el 05/11/2026 a las 19:28» (hora de Madrid),
     «a <correo del alumno>» y, pequeño, «aprobado por <nombre>». Antes salía solo el correo
     de quien aprobó, y parecía el destinatario.
   · «Ver envío» abre la ficha del diploma, con «Envíos» (lo que dice Brevo) e
     «Imprimir justificante».
   · La ficha tiene dirección propia: `?pestana=emitidos&exp=<nº>` la abre directamente.
*/

const NEXP = 'CEDIA-2026-000011-B5HQ';
const datos = vi.hoisted(() => ({
  diploma: {
    nexpediente: 'CEDIA-2026-000011-B5HQ', centro: 'CEDIA', alumno: 'Alba López', titulacion: 'Máster en Prueba', cursoRef: 12,
    emitidoEn: '2026-11-05T10:00:00Z', emitidaPor: 'Diego (CRM)', revocada: false, revocacion: null, verificarUrl: null, diplomaUrl: null,
    aviso: { resultado: 'enviado', en: '2026-11-05T18:28:00.000Z', por: 'aprobador@empresa.test (CRM)', porNombre: 'Diego Landaeta' },
    titularEmail: 'alba.alumna@example.com', emitidoEnCrm: true, imprenta: false,
  },
  envios: {
    nexpediente: 'CEDIA-2026-000011-B5HQ', centro: 'CEDIA', alumno: 'Alba López', titulacion: 'Máster en Prueba', email: 'alba.alumna@example.com', motivo: null,
    envios: [{
      messageId: '<202611051828.1@smtp-relay.mailin.fr>', asunto: 'Tu diploma está disponible', remitente: 'no-reply@certifex.tech',
      destinatario: 'alba.alumna@example.com', enviadoEn: '2026-11-05T18:28:01.000Z', entregadoEn: '2026-11-05T18:28:05.000Z',
      abiertoEn: '2026-11-05T18:40:00.000Z', problemas: [],
    }],
  },
}));

vi.mock('@/shared/hooks/useToast', () => ({ toast: () => {}, useToast: () => ({ toasts: [], addListener: () => () => {} }) }));
vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: { conectado: true, nombre: 'CRM de prueba' } }),
    centros: async () => ({ data: [{ codigo: 'CEDIA', nombre: 'CEDIA' }] }),
    cursos: async () => ({ data: [] }),
    diploma: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
  },
  diplomasApi: {
    resumen: async () => ({ data: { pendientes: 0, rechazadas: 0, vigentes: 1, revocados: 0, terminados: 0, porAvisar: 0, sinEmitir: 0, porEnviar: 0 } }),
    solicitudes: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    porAvisar: async () => ({ data: { porAvisar: [], sinEmitir: [] } }),
    diplomas: async () => ({ data: { filas: [datos.diploma], total: 1, pagina: 1, tam: 50 } }),
    terminados: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    envios: vi.fn(async () => ({ data: datos.envios })),
  },
}));

const { default: CertifexDiplomasPage } = await import('@/modules/certifex/pages/CertifexDiplomasPage');
const { lineaDeEnvio, hojaJustificante } = await import('@/modules/certifex/components/EnviosBrevo');

afterEach(cleanup);

let dondeEstoy = '';
function Ubicacion() {
  const l = useLocation();
  dondeEstoy = l.search;
  return null;
}
function abrir(ruta) {
  render(<MemoryRouter initialEntries={[ruta]}><CertifexDiplomasPage soloLectura /><Ubicacion /></MemoryRouter>);
}

describe('«Aviso al alumno» en Emitidos', () => {
  it('fecha y hora de Madrid, a quién se mandó y, aparte, quién lo aprobó', async () => {
    abrir('/?pestana=emitidos');
    expect(await screen.findByText('Enviado el 05/11/2026 a las 19:28')).toBeTruthy();
    expect(screen.getByText('a alba.alumna@example.com')).toBeTruthy();
    expect(screen.getByText('aprobado por Diego Landaeta')).toBeTruthy();
    // El correo de quien aprobó ya no se pinta como si fuera el destinatario.
    expect(screen.queryByText(/aprobador@empresa\.test/)).toBeNull();
  });

  it('«Ver envío» abre la ficha con «Envíos» y pone su dirección en la URL', async () => {
    abrir('/?pestana=emitidos');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver envío' }));
    const ficha = await screen.findByRole('dialog');
    expect(await within(ficha).findByText(/Enviado el 05\/11\/2026 19:28 \(hora de Madrid\) a alba\.alumna@example\.com · Entregado el 05\/11\/2026 19:28 · Abierto el 05\/11\/2026 19:40/)).toBeTruthy();
    expect(within(ficha).getByText(/Message-ID: <202611051828\.1@smtp-relay\.mailin\.fr>/)).toBeTruthy();
    expect(within(ficha).getByRole('button', { name: /Imprimir justificante/ })).toBeTruthy();
    expect(new URLSearchParams(dondeEstoy).get('exp')).toBe(NEXP);
    // Al cerrarla, la dirección vuelve a la de la lista.
    fireEvent.click(within(ficha).getByRole('button', { name: 'Cerrar' }));
    expect(new URLSearchParams(dondeEstoy).get('exp')).toBeNull();
  });

  it('la dirección propia abre la ficha directamente', async () => {
    abrir(`/?pestana=emitidos&exp=${NEXP}`);
    const ficha = await screen.findByRole('dialog');
    expect(await within(ficha).findByText(/a alba\.alumna@example\.com · Entregado/)).toBeTruthy();
  });

  it('lo que no salió dice el motivo', async () => {
    datos.diploma = { ...datos.diploma, aviso: { ...datos.diploma.aviso, resultado: 'correo_apagado' } };
    abrir('/?pestana=emitidos');
    expect(await screen.findByText('No salió el 05/11/2026 a las 19:28')).toBeTruthy();
    expect(screen.getByText(/Motivo: el correo está apagado/)).toBeTruthy();
    datos.diploma = { ...datos.diploma, aviso: { ...datos.diploma.aviso, resultado: 'enviado' } };
  });
});

describe('el justificante', () => {
  it('una línea por envío, con rebotes', () => {
    expect(lineaDeEnvio({ ...datos.envios.envios[0], abiertoEn: null, entregadoEn: null, problemas: [{ evento: 'hardBounces', fecha: '2026-11-05T18:28:09Z', motivo: 'no existe' }] }))
      .toBe('Enviado el 05/11/2026 19:28 (hora de Madrid) a alba.alumna@example.com · Rebote definitivo el 05/11/2026 19:28 (no existe)');
  });

  it('la hoja imprimible lleva todo, en hora de Madrid y UTC, y escapa el HTML', () => {
    const h = hojaJustificante({ ...datos.envios, alumno: 'Alba <b>López</b>' }, datos.envios.envios[0], new Date('2026-11-05T19:00:00Z'));
    for (const t of ['Justificante de envío del diploma', NEXP, 'Máster en Prueba', '05/11/2026 19:28:01 (hora de Madrid)', '05/11/2026 18:28:01 UTC',
      'alba.alumna@example.com', 'Tu diploma está disponible', 'no-reply@certifex.tech', '&lt;202611051828.1@smtp-relay.mailin.fr&gt;',
      'Generado el 05/11/2026 20:00 (hora de Madrid) desde el CRM']) expect(h, t).toContain(t);
    expect(h).toContain('Alba &lt;b&gt;López&lt;/b&gt;');
  });
});
