import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * Avisar cuando el Moodle de un campus deja de responder (#335), con la base de verdad y
 * Moodle simulado.
 *
 *   · hacen falta DOS vueltas seguidas con fallo: un tropiezo no avisa;
 *   · no se repite el aviso del mismo campus en 24 horas;
 *   · que a un token le falte una función no es «el Moodle está caído»;
 *   · cada motivo dice qué hacer, y el aviso lleva al campus.
 *
 *   npx vitest run tests/moodleAvisos.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const credenciales = await import('../src/modules/credentials/credentials.model.js');
const { vuelta, _reiniciar, TIPO } = await import('../src/jobs/moodleAvisosScheduler.js');

const MARCA = `MAV${Date.now().toString(36)}`;
const ORIGEN = `https://${MARCA.toLowerCase()}.avisos.moodle.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });

let CAMPUS; let PERSONA; let credId;
/** Qué hace el Moodle simulado: 'bien' | 'token' | 'apagado' | 'sin_funcion'. */
let modo = 'bien';

beforeAll(async () => {
  const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  CAMPUS = p.id;
  const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${MARCA} PERSONA`, `persona@${MARCA.toLowerCase()}.test`]);
  PERSONA = u.id;
  const cred = await credenciales.upsert({ project_id: CAMPUS, service: 'moodle', entorno: 'produccion', value: JSON.stringify({ url: ORIGEN, token: TOKEN }) });
  credId = cred.id;
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM admin_notifications WHERE type = $1 AND (metadata->>'campus_id')::int = $2`, [TIPO, CAMPUS]);
  await q(`DELETE FROM api_credentials WHERE id = $1`, [credId]);
  await q(`DELETE FROM users WHERE id = $1`, [PERSONA]);
  await q(`DELETE FROM projects WHERE id = $1`, [CAMPUS]);
  await pool.end();
}, 60000);

beforeEach(async () => {
  _reiniciar();
  modo = 'bien';
  await q(`DELETE FROM admin_notifications WHERE type = $1 AND (metadata->>'campus_id')::int = $2`, [TIPO, CAMPUS]);
  // NINGUNA llamada sale de verdad: el Moodle de mi campus es el simulado, y los demás campus
  // conectados que haya en la base (el de Psiko en local) contestan «bien».
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url) !== `${ORIGEN}/webservice/rest/server.php`) return json([]);
    if (modo === 'apagado') throw new TypeError('fetch failed');
    if (modo === 'token') return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'x' });
    if (modo === 'sin_funcion') return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'x' });
    return json([]);
  }));
});

const avisos = () => q(`SELECT title, message, link_path, target_user_ids, metadata FROM admin_notifications WHERE type = $1 AND (metadata->>'campus_id')::int = $2`, [TIPO, CAMPUS]);
const girar = (n = 1) => (async () => { for (let i = 0; i < n; i += 1) await vuelta({ destinatarios: [PERSONA] }); })();

describe('avisos del Moodle de los campus', () => {
  it('con el Moodle bien, no avisa nunca', async () => {
    await girar(3);
    expect(await avisos()).toHaveLength(0);
  });

  it('un tropiezo no avisa: hacen falta dos vueltas seguidas con fallo', async () => {
    modo = 'token';
    await girar(1);
    expect(await avisos()).toHaveLength(0);
    modo = 'bien';
    await girar(1); // se recupera: la cuenta vuelve a cero
    modo = 'token';
    await girar(1);
    expect(await avisos()).toHaveLength(0);
  });

  it('con dos vueltas seguidas fallando avisa, dice qué hacer y lleva al campus', async () => {
    modo = 'token';
    await girar(2);
    const [a, ...resto] = await avisos();
    expect(resto).toHaveLength(0);
    expect(a.title).toBe(`El Moodle de ${MARCA} Campus no responde`);
    expect(a.message).toMatch(/inválido o ha caducado.*Conexión → Moodle/);
    expect(a.link_path).toBe(`/conexion/moodle/${CAMPUS}`);
    expect(a.target_user_ids).toEqual([PERSONA]);
    expect(a.metadata).toMatchObject({ campus_id: CAMPUS, motivo: 'token_no_valido' });
  });

  it('no se repite el aviso del mismo campus en 24 horas', async () => {
    modo = 'token';
    await girar(6);
    expect(await avisos()).toHaveLength(1);
  });

  it('un Moodle caído dice otra cosa que un token malo', async () => {
    modo = 'apagado';
    await girar(2);
    const [a] = await avisos();
    expect(a.message).toMatch(/no contesta/);
    expect(a.metadata.motivo).toBe('sin_respuesta');
  });

  it('que al token le falte la función de la comprobación no es un Moodle caído', async () => {
    modo = 'sin_funcion';
    await girar(4);
    expect(await avisos()).toHaveLength(0);
  });

  it('ni el token ni la dirección salen en el aviso', async () => {
    modo = 'token';
    await girar(2);
    const texto = JSON.stringify(await avisos());
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(ORIGEN);
  });
});
