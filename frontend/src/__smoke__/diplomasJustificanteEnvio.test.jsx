// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/*
  Justificante del envío del diploma (Diego, 05/11/2026): en la ficha del diploma, la
  sección «Envíos» con «Enviado el dd/mm/aaaa hh:mm a correo@…» (o «No ha salido: motivo»)
  y un botón «Descargar justificante» por envío. La hora, la de Madrid.
*/

const api = vi.hoisted(() => ({
  envios: vi.fn(),
  justificante: vi.fn(async () => ({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), nombre: 'justificante.pdf' })),
}));
const toasts = vi.hoisted(() => []);
vi.mock('@/shared/hooks/useToast', () => ({ toast: (t) => toasts.push(t), useToast: () => ({ toasts: [], addListener: () => () => {} }) }));
vi.mock('@/modules/certifex/api/certifex.api', () => ({ diplomasApi: api }));

const { default: EnviosDelDiploma, lineaDeEnvio, fechaHoraMadrid } = await import('@/modules/certifex/components/EnviosDelDiploma');

const NEXP = 'ISEIE-2026-000005-AAAA';
const ENVIADO = {
  id: 41, tipo: 'credencial', en: '2026-11-05T13:03:12.000Z', resultado: 'enviado', aprobadoPor: 'gestora@prueba.test (CRM ISEIE)',
  destinatario: 'ana.alumna@example.com', asunto: 'Tu diploma está disponible', messageId: '<a@smtp-relay.mailin.fr>', sinDetalle: false,
};
const APAGADO = { ...ENVIADO, id: 40, resultado: 'correo_apagado', messageId: null, en: '2026-11-05T12:00:00.000Z' };
const ANTIGUO = { ...ENVIADO, id: 12, destinatario: null, asunto: null, messageId: null, sinDetalle: true, en: '2026-10-20T09:30:00.000Z' };

beforeEach(() => {
  api.envios.mockReset();
  api.justificante.mockClear();
  toasts.length = 0;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:prueba');
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('lineaDeEnvio', () => {
  it('enviado: fecha y hora de Madrid y el correo', () => {
    expect(lineaDeEnvio(ENVIADO)).toBe('Enviado el 05/11/2026 14:03 a ana.alumna@example.com');
    expect(fechaHoraMadrid('2026-07-05T13:03:12Z')).toBe('05/07/2026 15:03');
  });
  it('no salió: el motivo', () => {
    expect(lineaDeEnvio(APAGADO)).toBe('No ha salido: el envío de correo estaba apagado en Certifex (05/11/2026 13:00)');
    expect(lineaDeEnvio({ ...APAGADO, resultado: 'sin_correo' })).toMatch(/^No ha salido: el alumno no tenía correo/);
  });
  it('de antes del cambio: sin inventar el correo', () => {
    expect(lineaDeEnvio(ANTIGUO)).toBe('Enviado el 20/10/2026 11:30');
  });
});

describe('Envíos en la ficha del diploma', () => {
  it('lista cada envío, quién lo aprobó y avisa de los antiguos', async () => {
    api.envios.mockResolvedValue({ data: { credencial: { nexpediente: NEXP, centro: 'ISEIE' }, envios: [ENVIADO, APAGADO, ANTIGUO] } });
    render(<EnviosDelDiploma nexpediente={NEXP} />);
    expect(await screen.findByText('Enviado el 05/11/2026 14:03 a ana.alumna@example.com')).toBeTruthy();
    expect(screen.getByText(/No ha salido: el envío de correo estaba apagado/)).toBeTruthy();
    expect(screen.getByText(/De antes de que se guardaran el destinatario/)).toBeTruthy();
    expect(screen.getAllByText(/Aprobado por gestora@prueba\.test/)).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /Descargar justificante/ })).toHaveLength(3);
    expect(api.envios).toHaveBeenCalledWith(NEXP);
  });

  it('«Descargar justificante» pide el PDF de ESE envío', async () => {
    api.envios.mockResolvedValue({ data: { credencial: { nexpediente: NEXP, centro: 'ISEIE' }, envios: [ENVIADO, APAGADO] } });
    render(<EnviosDelDiploma nexpediente={NEXP} />);
    const botones = await screen.findAllByRole('button', { name: /Descargar justificante/ });
    fireEvent.click(botones[1]);
    await waitFor(() => expect(api.justificante).toHaveBeenCalledWith(NEXP, 40));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('sin envíos lo dice; y si Certifex falla, también, sin romper la ficha', async () => {
    api.envios.mockResolvedValue({ data: { credencial: { nexpediente: NEXP, centro: 'ISEIE' }, envios: [] } });
    render(<EnviosDelDiploma nexpediente={NEXP} />);
    expect(await screen.findByText('Aún no se le ha enviado al alumno.')).toBeTruthy();
    cleanup();
    api.envios.mockRejectedValue(new Error('Certifex no responde.'));
    render(<EnviosDelDiploma nexpediente={NEXP} />);
    expect(await screen.findByText(/No se pudieron cargar los envíos: Certifex no responde\./)).toBeTruthy();
  });

  it('si el PDF falla, avisa con el motivo', async () => {
    api.envios.mockResolvedValue({ data: { credencial: { nexpediente: NEXP, centro: 'ISEIE' }, envios: [ENVIADO] } });
    api.justificante.mockRejectedValueOnce(new Error('Diploma no encontrado (o no es de tus campus).'));
    render(<EnviosDelDiploma nexpediente={NEXP} />);
    fireEvent.click(await screen.findByRole('button', { name: /Descargar justificante/ }));
    await waitFor(() => expect(toasts[0]).toMatchObject({ title: 'No se pudo generar el justificante', description: 'Diploma no encontrado (o no es de tus campus).' }));
  });
});
