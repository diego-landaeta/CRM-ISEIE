import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Responder una consulta con la cuenta de administración del sitio (excepción, 24/11).
 *
 * El plugin del CRM no envía como el administrador del sitio (1.10.1). Con la excepción
 * confirmada en ese campus, el CRM lo dice claro («responde y corrige desde Moodle"):
 *   · responder: 409 RESPONDE_DESDE_MOODLE, sin guardar una respuesta que no va a llegar;
 *   · reintentar: queda con ese motivo, sin llamar al campus.
 * Sin la excepción, todo como siempre. Y con la excepción y el campus que la tiene en
 * «Administradoras que dan clase» (plugin 1.11.7, `admin_sitio_permitida`, CRM#1118), también:
 * responde por el plugin como cualquier tutora.
 *
 * Sin base ni Moodle: `query` y `fetch` son de mentira.
 */

const estado = { excepcion: true, permitida: false, guardadas: 0, apuntes: [] };
const query = vi.fn(async (sql, params = []) => {
  if (/FROM consultas WHERE id = \$1/.test(sql)) {
    return { rows: [{ id: 5, project_id: 7, tutor_id: 3, estado: 'abierta', alumno_moodle_id: 900, conversacion_externa_id: null, conversacion_grupo_id: 77 }] };
  }
  if (/FOR UPDATE OF m SKIP LOCKED/.test(sql)) {
    return { rows: [{ id: 31, consulta_id: 5, autor: 'tutor', autor_user_id: 3, texto: 'Hola', c_project: 7, c_tutor: 3, c_alumno: 900, c_grupo: 77 }] };
  }
  if (/FROM consulta_adjuntos WHERE mensaje_id/.test(sql)) return { rows: [] };
  if (/FROM moodle_plugin_campus WHERE project_id = \$1 AND activo/.test(sql)) return { rows: [{ '?column?': 1 }] };
  if (/admin_sitio_excepcion_at IS NOT NULL/.test(sql)) {
    // Con «AND NOT admin_sitio_permitida» (1.11.7), la que el campus permite no cuenta.
    const fuera = /NOT admin_sitio_permitida/.test(sql) && estado.permitida;
    return { rows: estado.excepcion && !fuera ? [{ '?column?': 1 }] : [] };
  }
  if (/SELECT moodle_user_id FROM tutor_campus/.test(sql)) return { rows: [{ moodle_user_id: 6 }] };
  if (/INSERT INTO consulta_mensajes/.test(sql)) { estado.guardadas += 1; return { rows: [] }; }
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

const { responder, reintentar } = await import('../src/modules/consultas/consultas.service.js');
const { SOLO_DESDE_MOODLE } = await import('../src/modules/tutores/tutor.campus.js');

const alCampus = [];
const fetchImpl = vi.fn(async (_url, { body }) => {
  alCampus.push(Object.fromEntries(new URLSearchParams(body)));
  return { ok: true, status: 200, json: async () => ({ id: 4321, conversacion_id: 77 }) };
});

beforeEach(() => {
  estado.excepcion = true;
  estado.permitida = false;
  estado.guardadas = 0;
  estado.apuntes.length = 0;
  alCampus.length = 0;
});

describe('responder con la cuenta de administración del sitio (excepción)', () => {
  it('responder: 409 «responde y corrige desde Moodle», sin guardar nada ni llamar al campus', async () => {
    await expect(responder(5, 3, 'Te lo explico', [], { guardarArchivo: vi.fn(), fetchImpl }))
      .rejects.toMatchObject({ statusCode: 409, code: 'RESPONDE_DESDE_MOODLE', message: SOLO_DESDE_MOODLE });
    expect(estado.guardadas).toBe(0);
    expect(alCampus).toEqual([]);
  });

  it('reintentar: queda con ese motivo y no se llama al campus', async () => {
    const r = await reintentar(31, { fetchImpl });
    expect(r).toEqual({ enviado: false, error: SOLO_DESDE_MOODLE });
    expect(alCampus).toEqual([]);
    expect(estado.apuntes).toEqual([{ mensajeId: 31, externoId: null, error: SOLO_DESDE_MOODLE }]);
  });

  it('sin la excepción, el reintento sale por el plugin como siempre', async () => {
    estado.excepcion = false;
    const r = await reintentar(31, { fetchImpl });
    expect(r).toEqual({ enviado: true, error: null });
    expect(alCampus[0]).toMatchObject({ wsfunction: 'local_crm_enviar_mensaje', desde: '6', para: '900' });
  });

  it('con la excepción y el campus que la permite (1.11.7), responde por el plugin como cualquier tutora', async () => {
    estado.permitida = true;
    const r = await reintentar(31, { fetchImpl });
    expect(r).toEqual({ enviado: true, error: null });
    expect(alCampus[0]).toMatchObject({ wsfunction: 'local_crm_enviar_mensaje', desde: '6', para: '900' });
  });

  it('con la excepción y el campus que la permite, responder no contesta «desde Moodle»', async () => {
    estado.permitida = true;
    const guardarArchivo = vi.fn();
    // Lo que pase después (guardar, enviar) es lo de siempre; aquí solo importa que no se corta.
    await responder(5, 3, 'Te lo explico', [], { guardarArchivo, fetchImpl })
      .catch((err) => expect(err.code).not.toBe('RESPONDE_DESDE_MOODLE'));
    expect(estado.guardadas).toBe(1);
  });
});
