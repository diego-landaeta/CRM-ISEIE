import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Reintentar» una respuesta que no llegó, en un campus conectado con el plugin (#461).
 *
 * Las respuestas que se guardaron mientras el campus no estaba conectado se quedan con
 * su motivo y el botón «Reintentar». Cuando el campus se conecta con el plugin (#850),
 * el reintento tiene que salir como cualquier respuesta nueva: por el plugin, al chat de
 * grupo de la consulta y en nombre de la tutora que la ESCRIBIÓ, aunque la consulta se
 * haya reasignado después. El envío normal ya tiene su prueba
 * (`moodlePluginSoloEnPruebas689.test.js`); el reintento, no.
 *
 * Sin base ni Moodle: `query` y `fetch` son de mentira y dicen qué se habría hecho.
 */

// La respuesta pendiente: la escribió Laura (2) y la consulta es ahora de Carmen (3).
const PENDIENTE = {
  id: 31, consulta_id: 5, autor: 'tutor', autor_user_id: 2, texto: 'Te lo explico',
  c_project: 7, c_tutor: 3, c_alumno: 900, c_grupo: 77,
};
const MOODLE_DE = { 2: 701, 3: 702 };

const estado = { pendiente: true, apuntes: [] };
const query = vi.fn(async (sql, params = []) => {
  if (/FOR UPDATE OF m SKIP LOCKED/.test(sql)) return { rows: estado.pendiente ? [PENDIENTE] : [] };
  if (/FROM consulta_adjuntos WHERE mensaje_id/.test(sql)) return { rows: [] };
  if (/FROM moodle_plugin_campus WHERE project_id = \$1 AND activo/.test(sql)) return { rows: [{ '?column?': 1 }] };
  if (/SELECT moodle_user_id FROM tutor_campus/.test(sql)) {
    return { rows: MOODLE_DE[params[0]] ? [{ moodle_user_id: MOODLE_DE[params[0]] }] : [] };
  }
  if (/UPDATE consulta_mensajes/.test(sql)) {
    estado.apuntes.push({ mensajeId: params[0], externoId: params[1], error: params[2] });
    return { rows: [{ id: params[0] }] };
  }
  return { rows: [] };
});
vi.mock('../src/shared/config/db.js', () => ({
  query,
  getClient: vi.fn(async () => ({ query, release: () => {} })),
}));
vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus.test', token: 'token-del-campus' })),
}));

const { reintentar } = await import('../src/modules/consultas/consultas.service.js');

/** Lo que el CRM pide al campus, con sus parámetros. */
const alCampus = [];
function campus(responde) {
  return vi.fn(async (_url, { body }) => {
    const p = Object.fromEntries(new URLSearchParams(body));
    alCampus.push(p);
    return { ok: true, status: 200, json: async () => responde(p) };
  });
}

beforeEach(() => {
  estado.pendiente = true;
  estado.apuntes.length = 0;
  alCampus.length = 0;
  query.mockClear();
});

describe('reintentar en un campus conectado con el plugin', () => {
  it('sale por el plugin, al chat de grupo y en nombre de quien la escribió', async () => {
    const fetchImpl = campus(() => ({ id: 4321, conversacion_id: 77 }));
    const r = await reintentar(31, { fetchImpl });

    expect(r).toEqual({ enviado: true, error: null });
    expect(alCampus).toHaveLength(1);
    expect(alCampus[0]).toMatchObject({
      wsfunction: 'local_crm_enviar_mensaje',
      desde: '701', // Laura, que la escribió; no Carmen (702), que la lleva ahora
      para: '900',
      conversacionid: '77',
    });
    expect(alCampus[0].texto).toContain('Te lo explico');
    // Queda apuntada como llegada, con el id que dio Moodle.
    expect(estado.apuntes).toEqual([{ mensajeId: 31, externoId: 4321, error: null }]);
  });

  it('si el campus vuelve a fallar, sigue pendiente con el motivo y se puede reintentar otra vez', async () => {
    const fetchImpl = campus(() => ({ exception: 'moodle_exception', errorcode: 'nopermission', message: 'Sin permiso' }));
    const r = await reintentar(31, { fetchImpl });

    expect(r.enviado).toBe(false);
    expect(r.error).toBeTruthy();
    expect(estado.apuntes).toEqual([{ mensajeId: 31, externoId: null, error: r.error }]);
  });

  it('si la autora ya no tiene su usuario del campus en el CRM, no sale en nombre de otra', async () => {
    const fetchImpl = campus(() => ({ id: 1, conversacion_id: 77 }));
    const sinUsuario = { ...MOODLE_DE };
    delete MOODLE_DE[2];
    try {
      const r = await reintentar(31, { fetchImpl });
      expect(r.enviado).toBe(false);
      expect(r.error).toMatch(/usuario del campus/);
      expect(alCampus).toEqual([]);
    } finally {
      Object.assign(MOODLE_DE, sinUsuario);
    }
  });

  it('una que ya llegó (o que otro está reintentando) no se manda dos veces', async () => {
    estado.pendiente = false;
    const fetchImpl = campus(() => ({ id: 1, conversacion_id: 77 }));
    expect(await reintentar(31, { fetchImpl })).toBeNull();
    expect(alCampus).toEqual([]);
    expect(estado.apuntes).toEqual([]);
  });
});
