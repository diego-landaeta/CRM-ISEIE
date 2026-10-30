import { describe, it, expect, vi, beforeEach } from 'vitest';

// Diego, 30/10: «en el tablero se están ligando tareas entre empresas». Con ICTESS US
// arriba salían tareas de CEDIA: el ámbito miraba a la PERSONA, y quien está en las dos
// empresas (Ruth) traía las de las dos. Ahora, con una empresa o un campus arriba, solo
// las tareas cuya empresa (la de su equipo o, sin equipo, la de su campus) es esa.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const { query } = await import('../src/shared/config/db.js');
const model = await import('../src/modules/tasks/tasks.model.js');
const service = await import('../src/modules/tasks/tasks.service.js');

beforeEach(() => vi.clearAllMocks());

describe('el tablero con una empresa arriba', () => {
  it('findTasks filtra por la empresa del equipo de la tarea', async () => {
    query.mockImplementation(async () => ({ rows: [{ hay: true }], rowCount: 1 }));
    await model.findTasks({ de_la_cabecera: [4, 13] });
    const consulta = query.mock.calls.find(([sql]) => /FROM tasks t/.test(sql));
    expect(consulta).toBeTruthy();
    const [sql, params] = consulta;
    expect(sql).toMatch(/pc\.sociedad_emisora_id = tt_c\.issuer_id/);
    expect(params).toContainEqual([4, 13]);
  });

  it('sin nada arriba no se filtra por empresa', async () => {
    query.mockImplementation(async () => ({ rows: [{ hay: true }], rowCount: 1 }));
    await model.findTasks({});
    const [sql] = query.mock.calls.find(([s]) => /FROM tasks t/.test(s));
    expect(sql).not.toMatch(/tt_c/);
  });

  it('un campus arriba cuenta como toda su empresa', async () => {
    query.mockImplementation(async (sql) => {
      if (/sociedad_emisora_id AS|SELECT sociedad_emisora_id/.test(sql)) return { rows: [{ sociedad_emisora_id: 9, id: 9 }] };
      if (/WHERE sociedad_emisora_id = \$1/.test(sql)) return { rows: [{ id: 4 }, { id: 13 }] };
      return { rows: [] };
    });
    expect(await service.campusDeLaCabecera({ projectId: 13 })).toEqual([4, 13]);
    expect(await service.campusDeLaCabecera({})).toBeNull();
  });
});
