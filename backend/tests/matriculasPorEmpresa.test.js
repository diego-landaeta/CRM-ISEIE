import { describe, it, expect, vi, beforeEach } from 'vitest';

// #199 · el listado de Matrículas, «por empresa y con "Todos los proyectos",
// como el resto del CRM». Antes pedía siempre un campus: con «Todos» el
// servidor respondía 400 y la pantalla se quedaba cargando, y con una empresa
// en la cabecera salía el muro de «elige un campus».

const EMPRESAS = { 8: [1, 2, 3], 9: [4] };   // CEDIA, ICTESS
const CAMPUS = { 34: [1, 2, 3] };            // Mireia, admin de CEDIA
const consultas = [];
const filas = { value: [] };   // lo que devuelve la consulta de la lista
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

// La conexión de las transacciones usa la misma consulta falsa (y anota BEGIN, COMMIT y ROLLBACK).
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(async () => ({ query: (...a) => consultaFalsa(...a), release: vi.fn() })),
  query: vi.fn(async (...a) => consultaFalsa(...a)),
}));
const falla = { evento: false };   // para probar que el historial y el cambio van juntos

async function consultaFalsa(sql, params = []) {
  {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) { transaccion.push(sql); return { rows: [] }; }
    if (sql.includes('INSERT INTO matriculas_eventos') && falla.evento) throw new Error('sin la migración 212');
    if (sql.includes('FROM projects WHERE NOT COALESCE(es_prueba')) return { rows: [{ id: 1, nombre: 'Psiko Aprende' }] };
    if (sql.includes('FROM projects WHERE id = ANY')) return { rows: params[0].map((id) => ({ id, nombre: `Campus ${id}` })) };
    if (sql.includes('FROM projects WHERE sociedad_emisora_id = $1')) {
      return { rows: (EMPRESAS[params[0]] || []).map((id) => ({ id })) };
    }
    if (sql.includes('FROM user_projects WHERE user_id = $1 AND active = true')) {
      return { rows: (CAMPUS[params[0]] || []).map((project_id) => ({ project_id })) };
    }
    consultas.push({ sql, params });
    if (sql.includes('COUNT(*) FROM matriculas')) return { rows: [{ count: '0' }] };
    if (sql.includes('as pendientes')) return { rows: [{ total: 0, pendientes: 0, validadas: 0, rechazadas: 0 }] };
    if (sql.includes('LIMIT')) return { rows: filas.value };
    if (sql.includes('INSERT INTO matriculas (')) return { rows: [{ id: 77 }] };
    if (sql.includes('SELECT DISTINCT')) return { rows: [{ curso: 'Máster en Logopedia' }, { curso: 'Máster en Psicología' }] };
    return { rows: [] };
  }
}
const transaccion = [];

const ctrl = await import('../src/modules/matriculas/matricula.controller.js');

const MANUEL = { userId: 2, role: 'superadmin' };
const MIREIA = { userId: 34, role: 'admin' };

async function listar(user, query = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await ctrl.list({ user, query, params: {}, body: {} }, res, (e) => { error = e; });
  return { salida, error };
}

/** Las consultas de matrículas (la lista, su cuenta y las cifras), sin las del ámbito. */
const deMatriculas = () => consultas.filter((c) => c.sql.includes('matriculas'));

beforeEach(() => { consultas.length = 0; filas.value = []; });

describe('el listado de Matrículas sigue a la cabecera', () => {
  it('con una empresa (CEDIA): solo sus campus, en la lista, en las cifras y en los cursos del filtro', async () => {
    const { salida, error } = await listar(MANUEL, { issuerId: '8' });
    expect(error).toBeNull();
    expect(salida.success).toBe(true);
    const q = deMatriculas();
    expect(q).toHaveLength(4);   // la lista, su cuenta, las cifras y los cursos
    for (const { sql, params } of q) {
      expect(sql).toContain('m.project_id = ANY($1::int[])');
      expect(params[0]).toEqual([1, 2, 3]);
    }
  });

  it('con «Todos los proyectos»: ya no pide un campus, y deja fuera los de pruebas', async () => {
    const { salida, error } = await listar(MANUEL, {});
    expect(error).toBeNull();
    expect(salida.success).toBe(true);
    expect(deMatriculas()).toHaveLength(4);   // la lista, su cuenta, las cifras y los cursos: ninguna sin el límite
    for (const { sql } of deMatriculas()) expect(sql).toContain('NOT IN (SELECT id FROM projects WHERE es_prueba)');
  });

  it('con un campus: solo ese', async () => {
    await listar(MANUEL, { projectId: '4' });
    expect(deMatriculas()).toHaveLength(4);
    for (const { params } of deMatriculas()) expect(params[0]).toEqual([4]);
  });

  it('una admin de CEDIA con «Todos»: sus campus, no todo el CRM', async () => {
    const { error } = await listar(MIREIA, {});
    expect(error).toBeNull();
    expect(deMatriculas()).toHaveLength(4);   // la lista, su cuenta, las cifras y los cursos
    for (const { params } of deMatriculas()) expect(params[0]).toEqual([1, 2, 3]);
  });

  it('una admin de CEDIA que pide ICTESS cambiando la dirección: nada', async () => {
    const { error } = await listar(MIREIA, { issuerId: '9' });
    expect(error).toBeNull();
    expect(deMatriculas()).toHaveLength(4);   // la lista, su cuenta, las cifras y los cursos
    for (const { params } of deMatriculas()) expect(params[0]).toEqual([-1]);
  });

  it('una admin de CEDIA que pide un campus que no es suyo: 403', async () => {
    const { error } = await listar(MIREIA, { projectId: '4' });
    expect(error?.statusCode).toBe(403);
    expect(deMatriculas()).toHaveLength(0);
  });

  it('las cifras cuentan también las Solicitudes (lo que acaba de llegar)', async () => {
    await listar(MANUEL, { issuerId: '8' });
    const cifras = deMatriculas().find((c) => c.sql.includes('as pendientes'));
    expect(cifras.sql).toMatch(/FILTER \(WHERE estado = 'solicitud_admision'\) as solicitudes/);
  });

  it('primero lo que pide acción (Solicitud y Datos validados), después por fecha de llegada', async () => {
    await listar(MANUEL, {});
    const lista = deMatriculas().find((c) => c.sql.includes('LIMIT'));
    expect(lista.sql.replace(/\s+/g, ' ')).toContain(
      "ORDER BY CASE WHEN m.estado IN ('solicitud_admision', 'datos_validados') THEN 0 ELSE 1 END, COALESCE(m.webhook_received_at, m.created_at) DESC");
  });

  it('las columnas de Diego: el curso, el campus y la fecha de llegada salen de la consulta', async () => {
    await listar(MANUEL, {});
    const lista = deMatriculas().find((c) => c.sql.includes('LIMIT')).sql.replace(/\s+/g, ' ');
    expect(lista).toContain("COALESCE(m.curso_solicitado, m.datos_admision->>'curso_solicitado', c.producto_contratado) as curso");
    expect(lista).toContain('p.nombre as campus_nombre');
    expect(lista).toContain('COALESCE(m.webhook_received_at, m.created_at) as recibida_at');
    // La persona del formulario, si aún no hay prospecto vinculado (contrato de la #198).
    expect(lista).toContain("COALESCE(l.nombre, m.nombre, m.datos_admision->>'nombre') as lead_nombre");
  });

  it('cada fila dice cuáles de los cinco documentos de Diego han llegado, con los nombres del contrato de la #198', async () => {
    filas.value = [{ id: 1, dni_doc_key: 'matriculas/1/dni.jpg', titulo_doc_key: null, firma_key: null }];
    const { salida } = await listar(MANUEL, {});
    expect(salida.data[0].documentos).toEqual({ dni_frente: true, dni_dorso: false, foto: false, titulo: false, firma: false });
  });

  it('los filtros de Diego: campus, curso y fechas (el día, en hora de Madrid), sumados a la empresa', async () => {
    await listar(MANUEL, { issuerId: '8', campusId: '2', curso: ' Máster en Logopedia ', desde: '2026-10-01', hasta: '2026-10-12' });
    const lista = deMatriculas().find((c) => c.sql.includes('LIMIT'));
    const sql = lista.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('m.project_id = ANY($1::int[])');
    expect(sql).toContain('m.project_id = $2');
    expect(sql).toContain("COALESCE(m.curso_solicitado, m.datos_admision->>'curso_solicitado', c.producto_contratado) = $3");
    expect(sql).toContain("(COALESCE(m.webhook_received_at, m.created_at) AT TIME ZONE 'Europe/Madrid')::date >= $4::date");
    expect(sql).toContain("(COALESCE(m.webhook_received_at, m.created_at) AT TIME ZONE 'Europe/Madrid')::date <= $5::date");
    expect(lista.params.slice(0, 5)).toEqual([[1, 2, 3], 2, 'Máster en Logopedia', '2026-10-01', '2026-10-12']);
    // La cuenta del total lleva los mismos filtros, y por eso también la venta (el curso puede salir de ahí).
    const cuenta = deMatriculas().find((c) => c.sql.includes('SELECT COUNT(*) FROM matriculas'));
    expect(cuenta.sql).toContain('LEFT JOIN conversions c');
    expect(cuenta.params).toEqual(lista.params.slice(0, 5));
  });

  it('la respuesta trae los cursos del ámbito, para el desplegable «Curso»', async () => {
    const { salida } = await listar(MANUEL, { issuerId: '8' });
    expect(salida.cursos).toEqual(['Máster en Logopedia', 'Máster en Psicología']);
    const cursos = deMatriculas().find((c) => c.sql.includes('SELECT DISTINCT'));
    expect(cursos.params[0]).toEqual([1, 2, 3]);
  });

  it('una fecha mal escrita no filtra (ni llega a la base)', async () => {
    await listar(MANUEL, { desde: '1/10/2026', hasta: "2026-10-12'; DROP TABLE x" });
    const lista = deMatriculas().find((c) => c.sql.includes('LIMIT'));
    expect(lista.sql).not.toContain('Europe/Madrid');
  });

  it('buscar «50%_\\» busca eso tal cual, no como comodines (revisión de la #250)', async () => {
    await listar(MANUEL, { search: '50%_\\' });
    const lista = deMatriculas().find((c) => c.sql.includes('LIMIT'));
    expect(lista.params).toContain('%50\\%\\_\\\\%');
  });

  it('el estado y la búsqueda siguen funcionando con la empresa', async () => {
    await listar(MANUEL, { issuerId: '8', estado: 'validada', search: 'ana' });
    const lista = deMatriculas().find((c) => c.sql.includes('LIMIT'));
    expect(lista.sql).toContain('m.estado = $2');
    expect(lista.params.slice(0, 3)).toEqual([[1, 2, 3], 'validada', '%ana%']);
  });
});

// El historial empieza al crearse la matrícula (#199): por un formulario (el
// webhook de admisión o los formularios del CRM) es «recibida»; a mano, «creada».
describe('el historial empieza al crearse', () => {
  const modelo = () => import('../src/modules/matriculas/matricula.model.js');
  const eventos = () => consultas.filter((c) => c.sql.includes('INSERT INTO matriculas_eventos'));

  it.each([['webhook', 'recibida'], ['form', 'recibida'], ['manual', 'creada']])('con source %s: «%s»', async (source, evento) => {
    const { create } = await modelo();
    await create({ project_id: 1, source, user_id: source === 'manual' ? 2 : null });
    expect(eventos()).toHaveLength(1);
    expect(eventos()[0].params.slice(0, 2)).toEqual([77, evento]);
    expect(eventos()[0].params[6]).toBe(source === 'manual' ? 2 : null);
  });
});

// Revisión final del 15/10: el buscador encuentra a la persona que enseña la lista,
// también la del formulario cuando aún no hay prospecto.
describe('el buscador busca en la misma persona que enseña la lista', () => {
  it('nombre y correo del prospecto o, si no hay, del formulario; y el documento', async () => {
    await listar(MANUEL, { search: 'Lucía' });
    const sql = deMatriculas().find((c) => c.sql.includes('LIMIT')).sql.replace(/\s+/g, ' ');
    expect(sql).toContain("COALESCE(l.nombre, m.nombre, m.datos_admision->>'nombre') ILIKE $");
    expect(sql).toContain("COALESCE(l.email, m.email, m.datos_admision->>'email') ILIKE $");
    expect(sql).toContain("m.datos_admision->>'documento' ILIKE $");
  });
});

// Revisión independiente del 15/10.
describe('lo que salió en la revisión (servidor)', () => {
  beforeEach(() => { transaccion.length = 0; falla.evento = false; });

  it('si no se puede apuntar el historial, la matrícula tampoco se crea (ROLLBACK)', async () => {
    falla.evento = true;
    const { create } = await import('../src/modules/matriculas/matricula.model.js');
    await expect(create({ project_id: 1, source: 'webhook' })).rejects.toThrow('sin la migración 212');
    expect(transaccion).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('si todo va bien, se crea con su historial en la misma transacción (COMMIT)', async () => {
    const { create } = await import('../src/modules/matriculas/matricula.model.js');
    await create({ project_id: 1, source: 'webhook' });
    expect(transaccion).toEqual(['BEGIN', 'COMMIT']);
  });

  it('con un campus filtrado, las cifras son de ese campus', async () => {
    await listar(MANUEL, { issuerId: '8', campusId: '2' });
    const cifras = deMatriculas().find((c) => c.sql.includes('as pendientes'));
    expect(cifras.sql).toContain('AND m.project_id = $2');
    expect(cifras.params).toEqual([[1, 2, 3], 2]);
  });

  it('los campus del filtro: con «Todos» del CRM entero, sin los de pruebas; con una empresa, los suyos', async () => {
    const todos = await listar(MANUEL, {});
    expect(todos.salida.campus).toEqual([{ id: 1, nombre: 'Psiko Aprende' }]);
    const cedia = await listar(MANUEL, { issuerId: '8' });
    expect(cedia.salida.campus.map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
