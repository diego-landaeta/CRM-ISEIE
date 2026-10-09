import { describe, it, expect, vi, beforeEach } from 'vitest';

// Diego, 09/10: el correo de un recordatorio guarda su campus (en MultiCRM, Carlos vio uno
// en Sistema › Correos y no supo de quién era). Paridad: ISEIE no tiene esa pantalla.

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


describe('el correo de un recordatorio guarda su campus', () => {
  it('con projectId y por la cuenta del CRM (no cambia por dónde sale)', async () => {
    filas = [{ id: 174, lead_id: 4007, fecha_recordatorio: '2026-10-08', nota: 'Enviar la invitación a Skool',
      lead_nombre: 'Carlos Daswani', responsable_id: 12, gestor_nombre: 'M@ Eugenia',
      gestor_email: 'admisiones@academiaia.ai', project_id: 5, proyecto_nombre: 'ACADEMIA IA' }];
    await processDueReminders();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].projectId).toBe(5);
    expect(enviados[0].cuenta).toBe('crm');
    expect(consultas[0].sql).toMatch(/l\.project_id/);
  });
});
