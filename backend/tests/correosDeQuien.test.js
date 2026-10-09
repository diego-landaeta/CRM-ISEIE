import { describe, it, expect, vi, beforeEach } from 'vitest';

// Diego, 09/10: un recordatorio ya no manda correo; va en «Tu día y lo de mañana».

const consultas = [];
let filas = [];
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));
const enviados = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (o) => { enviados.push(o); return { sent: true }; }),
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({ notifyUsers: vi.fn(async () => {}) }));
vi.mock('../src/jobs/latido.js', () => ({ vigilar: vi.fn() }));

const { processDueReminders } = await import('../src/jobs/reminderScheduler.js');

beforeEach(() => { consultas.length = 0; enviados.length = 0; filas = []; });


describe('un recordatorio ya no manda correo (Diego, 09/10: va en «Tu día y lo de mañana»)', () => {
  it('avisa en la campanita y lo marca como avisado, sin gastar Brevo', async () => {
    const { notifyUsers } = await import('../src/modules/notifications/notifications.service.js');
    filas = [{ id: 174, lead_id: 4007, fecha_recordatorio: '2026-10-08', nota: 'Enviar la invitación a Skool',
      lead_nombre: 'Carlos Daswani', responsable_id: 12, gestor_nombre: 'M@ Eugenia',
      gestor_email: 'admisiones@academiaia.ai', project_id: 5, proyecto_nombre: 'ACADEMIA IA' }];
    await processDueReminders();
    expect(enviados).toHaveLength(0);
    expect(notifyUsers).toHaveBeenCalledWith(expect.objectContaining({ targetUserIds: [12], type: 'lead_reminder' }));
    expect(consultas.some((c) => /UPDATE lead_reminders SET notificado_at/.test(c.sql))).toBe(true);
  });
});
