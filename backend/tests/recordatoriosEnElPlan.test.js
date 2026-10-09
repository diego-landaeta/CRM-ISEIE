import { describe, it, expect, vi, beforeEach } from 'vitest';

// Diego, 09/10: «que los recordatorios vayan en el reporte, no un correo por
// cada uno: eso es gastar Brevo por gusto». Van en «Tu día y lo de mañana».

const consultas = [];
let filas = [];
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));

const { recordatoriosPendientes, bloqueRecordatorios } = await import('../src/jobs/correosDelEquipo.js');

beforeEach(() => { consultas.length = 0; filas = []; });

describe('los recordatorios, uno por uno, en el correo de la noche', () => {
  it('trae los de la persona hasta mañana, sin completar ni borrados, por fecha', async () => {
    filas = [{ id: 1, lead_id: 9, fecha: '2026-10-08', nota: 'Llamar', lead_nombre: 'Ana', campus: 'ISEIH', total: '3' }];
    const r = await recordatoriosPendientes(12, [1, 2], '2026-10-10');
    expect(r.total).toBe(3);
    const { sql, params } = consultas[0];
    expect(sql).toMatch(/l\.responsable_id = \$1/);
    expect(sql).toMatch(/r\.completado = false/);
    expect(sql).toMatch(/l\.deleted_at IS NULL/);
    expect(sql).toMatch(/r\.fecha_recordatorio <= \$3::date/);
    expect(params).toEqual([12, [1, 2], '2026-10-10', 15]);
  });

  it('pinta cuándo toca, el prospecto con enlace a su ficha y la nota; y cuántos quedan', () => {
    const html = bloqueRecordatorios({
      filas: [
        { lead_id: 9, fecha: '2026-10-07', nota: 'Mandar el dossier', lead_nombre: 'Ana <Pérez>', campus: 'ISEIH' },
        { lead_id: 10, fecha: '2026-10-09', nota: null, lead_nombre: 'Luis', campus: 'Psiko' },
        { lead_id: 11, fecha: '2026-10-10', nota: 'Segunda llamada', lead_nombre: 'Marta', campus: 'Psiko' },
      ],
      total: 5,
    }, { hoyIso: '2026-10-09', mananaIso: '2026-10-10', variosCampus: true });
    expect(html).toMatch(/vencido · 7 de octubre/);
    expect(html).toMatch(/<strong>hoy<\/strong>/);
    expect(html).toMatch(/<strong>mañana<\/strong>/);
    expect(html).toMatch(/\/leads\/9"/);
    expect(html).toMatch(/Ana &lt;Pérez&gt;/);
    expect(html).toMatch(/Mandar el dossier/);
    expect(html).toMatch(/· Psiko/);
    expect(html).toMatch(/Y 2 más en el CRM/);
  });

  it('sin recordatorios, no pinta nada', () => {
    expect(bloqueRecordatorios({ filas: [], total: 0 }, { hoyIso: '2026-10-09', mananaIso: '2026-10-10' })).toBe('');
  });
});
