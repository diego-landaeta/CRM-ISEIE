import { describe, it, expect, vi } from 'vitest';

// Diego, 30/10: «medir actividad, si está activa en el WhatsApp respondiendo».
// Por gestora: chats que le escribieron, respondidos, sin responder y lo que tarda,
// sacado de su número conectado (instancia «…-u<id>»), sin grupos.

vi.mock('../src/shared/config/db.js', () => ({ getClient: vi.fn(), query: vi.fn(async () => ({ rows: [] })) }));
const { query } = await import('../src/shared/config/db.js');
const { actividadEnWhatsapp } = await import('../src/modules/whatsapp/actividad.model.js');

describe('actividad en WhatsApp por gestora', () => {
  it('mide respuestas desde su número, sin grupos, y lo apuntado en la ficha', async () => {
    await actividadEnWhatsapp({ projectIds: [10], desde: '2026-10-24', hasta: '2026-10-30' });
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([[10], '2026-10-24', '2026-10-30']);
    expect(sql).toMatch(/NOT LIKE '%@g\.us'/);
    expect(sql).toMatch(/-u\(\[0-9\]\+\)\$/);
    expect(sql).toMatch(/s\.direccion = 'saliente' AND s\.ts > pr\.ts/);
    expect(sql).toMatch(/ultima = 'entrante'/);
    expect(sql).toMatch(/lead_interactions/);
  });
  it('sin campus elegido, todos menos los de pruebas', async () => {
    query.mockClear();
    await actividadEnWhatsapp({ projectIds: null, desde: '2026-10-30', hasta: '2026-10-30' });
    expect(query.mock.calls[0][1][0]).toBeNull();
    expect(query.mock.calls[0][0]).toMatch(/es_prueba/);
  });
});
