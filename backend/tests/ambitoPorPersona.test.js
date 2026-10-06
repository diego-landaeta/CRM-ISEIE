import { describe, it, expect, vi, beforeEach } from 'vitest';

// #245 (06/10): cada pantalla, siempre dentro de los campus de la persona.
//
//   «Perfil de administrador de Mireia, solo tiene acceso a CEDIA. Perfil de
//    admin de Antonio, solo tiene acceso a ICTESS. Perfil de admin de María
//    Eugenia, Academia IA. En tutores de Mireia aparece Aleix (ICTESS).»
//
// El ámbito solo miraba la URL: sin campus ni empresa era «todo el CRM», y con
// el `issuerId` de otra empresa la daba entera.

const EMPRESAS = { 8: [1, 2, 3, 6, 7, 8, 9], 9: [4], 10: [5] }; // CEDIA, ICTESS, Lateral (Academia IA)
const CAMPUS = { 34: EMPRESAS[8], 40: [4], 12: [5], 77: [] };   // Mireia, Antonio, María Eugenia, sin campus
const TUTORES = { 50: [4] };                                     // Aleix, profesor de ICTESS

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params = []) => {
    if (sql.includes('FROM projects WHERE sociedad_emisora_id = $1')) {
      return { rows: (EMPRESAS[params[0]] || []).map((id) => ({ id })) };
    }
    if (sql.includes('FROM user_projects WHERE user_id = $1 AND active = true')) {
      return { rows: (CAMPUS[params[0]] || []).map((project_id) => ({ project_id })) };
    }
    if (sql.includes('FROM user_projects WHERE user_id = $1 AND project_id = ANY($2::int[])')) {
      const suyos = TUTORES[params[0]] || CAMPUS[params[0]] || [];
      return { rows: suyos.some((p) => params[1].includes(p)) ? [{ '?column?': 1 }] : [] };
    }
    return { rows: [] };
  }),
}));

vi.mock('../src/modules/tutores/tutor.model.js', async (original) => ({
  ...(await original()),
  ficha: vi.fn(async (id) => ({ id, nombre: 'Aleix', iban: 'ES00…' })),
  listar: vi.fn(async () => []),
}));

const { proyectosDelAmbito } = await import('../src/shared/utils/ambito.js');
const tutores = await import('../src/modules/tutores/tutor.controller.js');
const tutorModel = await import('../src/modules/tutores/tutor.model.js');

const MIREIA = { userId: 34, role: 'admin' };
const ANTONIO = { userId: 40, role: 'admin' };
const EUGENIA = { userId: 12, role: 'admin' };
const MANUEL = { userId: 2, role: 'superadmin' };
const SOPORTE = { userId: 3, role: 'soporte' };

const ambito = (user, query = {}) => proyectosDelAmbito({ user, query });

async function llamar(fn, user, { params = {}, query = {} } = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await fn({ user, params, query, body: {} }, res, (e) => { error = e; });
  return { salida, error };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('«Todos los proyectos» son SUS campus', () => {
  it('Mireia (CEDIA): solo los siete campus de CEDIA', async () => {
    expect(await ambito(MIREIA)).toEqual({ projectId: null, projectIds: EMPRESAS[8] });
  });

  it('Antonio: solo ICTESS · María Eugenia: solo Academia IA', async () => {
    expect((await ambito(ANTONIO)).projectIds).toEqual([4]);
    expect((await ambito(EUGENIA)).projectIds).toEqual([5]);
  });

  it('sin ningún campus no es «todo»: es nada', async () => {
    expect((await ambito({ userId: 77, role: 'gestor' })).projectIds).toEqual([-1]);
  });

  it('super admin y soporte siguen viéndolo todo', async () => {
    expect(await ambito(MANUEL)).toEqual({ projectId: null, projectIds: null });
    expect(await ambito(SOPORTE)).toEqual({ projectId: null, projectIds: null });
  });
});

describe('una empresa: solo SUS campus de esa empresa', () => {
  it('Mireia pide CEDIA: sus siete', async () => {
    expect((await ambito(MIREIA, { issuerId: '8' })).projectIds).toEqual(EMPRESAS[8]);
  });

  it('Mireia pide ICTESS cambiando la URL: nada', async () => {
    expect((await ambito(MIREIA, { issuerId: '9' })).projectIds).toEqual([-1]);
  });

  it('el super admin pide ICTESS: ICTESS', async () => {
    expect((await ambito(MANUEL, { issuerId: '9' })).projectIds).toEqual([4]);
  });
});

describe('un campus suelto', () => {
  it('el suyo, tal cual', async () => {
    expect(await ambito(ANTONIO, { projectId: '4' })).toEqual({ projectId: 4, projectIds: null });
  });

  it('uno que no es suyo: 403', async () => {
    await expect(ambito(MIREIA, { projectId: '4' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('Tutores: Mireia ya no ve a Aleix (ICTESS)', () => {
  // En MultiCRM aqui va tambien «la lista con "Todos" se pide solo con los
  // campus de CEDIA». En ISEIE la lista de tutores no pasa por el ambito (va por
  // `projectId` y por sociedad, en tutor.model) y hay un solo campus, asi que no
  // aplica. La ficha si: es la que se podia abrir cambiando el id.
  it('su ficha, cambiando el id: «no encontrado»', async () => {
    const { error, salida } = await llamar(tutores.ficha, MIREIA, { params: { id: '50' } });
    expect(error?.statusCode).toBe(404);
    expect(salida).toBeNull();
    expect(tutorModel.ficha).not.toHaveBeenCalled();
  });

  it('Antonio (ICTESS) sí la abre, y el super admin también', async () => {
    expect((await llamar(tutores.ficha, ANTONIO, { params: { id: '50' } })).salida.data.nombre).toBe('Aleix');
    expect((await llamar(tutores.ficha, MANUEL, { params: { id: '50' } })).salida.data.nombre).toBe('Aleix');
  });
});
