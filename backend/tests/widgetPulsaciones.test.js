import { describe, it, expect, vi, beforeEach } from 'vitest';

// Las pulsaciones del botón de WhatsApp de las webs (Diego, 29/10: «así medimos
// cuáles pulsan y cuántos pasan a la conversación»). El código de la web avisa
// de cada pulsación y, cuando la gestora da de alta un lead de WhatsApp, se le
// cruza su última pulsación de las 24 h anteriores.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
}));

const { query } = await import('../src/shared/config/db.js');
const P = await import('../src/modules/widget/widget.pulsaciones.js');
const ctrl = await import('../src/modules/widget/widget.controller.js');

beforeEach(() => { vi.clearAllMocks(); P._recientes.clear(); });

describe('la página de la pulsación', () => {
  it('quita el ancla y los parámetros que no son de seguimiento', () => {
    expect(P.limpiarPagina('https://iseie.com/master-x/?utm_source=fb&s=hola#top'))
      .toBe('https://iseie.com/master-x/?utm_source=fb');
  });
  it('no acepta lo que no es una dirección web', () => {
    expect(P.limpiarPagina('javascript:alert(1)')).toBeNull();
    expect(P.limpiarPagina(42)).toBeNull();
  });
});

describe('apuntar una pulsación', () => {
  it('solo para una gestora del botón de ese campus', async () => {
    await P.apuntarPulsacion({ projectId: 10, userId: 51, pagina: 'https://iseie.com/x', idioma: 'es', quien: 'a' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/whatsapp_widget_active/);
    expect(sql).toMatch(/user_projects/);
    expect(params).toEqual([10, 51, 'https://iseie.com/x', 'es']);
  });
  it('el doble clic de la misma visita cuenta una vez', async () => {
    const ahora = 1_000_000;
    expect(await P.apuntarPulsacion({ projectId: 10, userId: 51, quien: 'a', ahora })).toBe(true);
    expect(await P.apuntarPulsacion({ projectId: 10, userId: 51, quien: 'a', ahora: ahora + 2000 })).toBe(false);
    expect(await P.apuntarPulsacion({ projectId: 10, userId: 51, quien: 'b', ahora: ahora + 2000 })).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('ids que no son números, ni se intenta', async () => {
    expect(await P.apuntarPulsacion({ projectId: 10, userId: 'x' })).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('el punto público de la web', () => {
  const llamar = async (req) => {
    let estado = null;
    const res = { setHeader: vi.fn(), status(s) { estado = s; return res; }, end: vi.fn() };
    await ctrl.widgetClic(req, res);
    return estado;
  };
  it('lee el texto de sendBeacon y contesta 204', async () => {
    const estado = await llamar({ params: { projectId: '10' }, body: JSON.stringify({ g: 51, u: 'https://iseie.com/x', l: 'es' }), ip: '1.2.3.4' });
    expect(estado).toBe(204);
    expect(query.mock.calls[0][1]).toEqual([10, 51, 'https://iseie.com/x', 'es']);
  });
  it('con basura también contesta 204 y no escribe nada', async () => {
    expect(await llamar({ params: { projectId: '10' }, body: 'no es json', ip: '1.2.3.4' })).toBe(204);
    expect(await llamar({ params: { projectId: 'abc' }, body: '{}', ip: '1.2.3.4' })).toBe(204);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('cruzar el alta con la pulsación', () => {
  it('se lleva la última pulsación sin cruzar de su gestora y le pone la página al lead', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, pagina: 'https://iseie.com/master-x/', creado_at: new Date() }] });
    const p = await P.cruzarConPulsacion({ leadId: 900, projectId: 10, userId: 51 });
    expect(p.id).toBe(7);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/lead_id IS NULL/);
    expect(sql).toMatch(/ORDER BY creado_at DESC LIMIT 1/);
    expect(params).toEqual([900, 10, 51, P.HORAS_PARA_CRUZAR]);
    const [sqlLead, paramsLead] = query.mock.calls[1];
    expect(sqlLead).toMatch(/COALESCE\(landing_url, ''\) = ''/);
    expect(paramsLead).toEqual([900, 'https://iseie.com/master-x/']);
  });
  it('sin pulsación, no toca el lead', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await P.cruzarConPulsacion({ leadId: 900, projectId: 10, userId: 51 })).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('las cifras por campus, por empresa o de todos (30/10)', () => {
  it('con los campus de una empresa, solo esos', async () => {
    query.mockResolvedValue({ rows: [] });
    await P.resumenDePulsaciones({ projectIds: [1, 2, 3], from: '2026-10-24', to: '2026-10-30' });
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([[1, 2, 3], '2026-10-24', '2026-10-30']);
    expect(sql).toMatch(/project_id = ANY\(\$1::int\[\]\)/);
  });
  it('con «Todos» (null), todos menos los campus de pruebas', async () => {
    query.mockResolvedValue({ rows: [] });
    await P.resumenDePulsaciones({ projectIds: null, from: '2026-10-24', to: '2026-10-30' });
    const [sql, params] = query.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(sql).toMatch(/es_prueba/);
  });
});
