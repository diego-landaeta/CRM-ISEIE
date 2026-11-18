import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Los adjuntos van a una carpeta temporal, no a la de la máquina.
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inc253-'));

const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');

/**
 * Incidencias (#253), contra la API y la base de verdad.
 *
 * Lo que pidió Diego el 27/10:
 *
 *   - se crea, se edita y se cierra una incidencia con su enlace a la ficha,
 *     y la ve el resto de admin;
 *   - la gestora no ve las de otras, EN LA API y no solo en la pantalla;
 *   - las cifras cuadran con la lista;
 *
 * y lo que pide el resto del CRM: un admin no ve las de otra empresa (#245) ni
 * cuelga una incidencia en un campus que no es suyo.
 *
 * Tres empresas: E1 con los campus A y A2, E2 con el campus B, E3 con el C.
 */

const request = supertest(app);
const MARCA = `INC253_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
const P = {};
const E = {};

async function persona(clave, role, campus = []) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  U[clave] = u.id;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });

/**
 * El superadmin NO se crea: se usa el que ya hay en la base (el del seed).
 * Uno nuevo y activo le cae a `certifexDiplomas`, que espera avisar a todos los
 * superadmin activos, cuando las dos pruebas corren a la vez en la CI (pasó en
 * la PR #612). Diego, 22/10 (#423): nunca crear usuarios con más alcance del
 * necesario en la base compartida. No se borra al final: no es nuestro.
 */
async function superadminDeLaBase() {
  const u = await one(`SELECT id, email FROM users WHERE role = 'superadmin' AND active ORDER BY id LIMIT 1`);
  if (!u) throw new Error('La base de pruebas no tiene ningún superadmin activo (npm run db:preparar -- --datos)');
  U.superadmin = u.id;
  T.superadmin = jwt.sign({ userId: u.id, email: u.email, role: 'superadmin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/** Solo las de esta prueba: en la base hay también las del seed. */
const nuestras = (lista) => lista.filter((i) => i.quePaso.startsWith(MARCA)).map((i) => i.quePaso.slice(MARCA.length + 1)).sort();

async function apuntar(datos) {
  return one(
    `INSERT INTO incidencias (que_paso, tipos, project_id, sociedad_id, causada_por, detectada_por, creada_por, ocurrio_at, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), COALESCE($9, 'open')) RETURNING id`,
    [`${MARCA} ${datos.que}`, datos.tipos || ['capa8'], datos.campus ? P[datos.campus] : null,
      datos.empresa ? E[datos.empresa] : null, datos.causa ? U[datos.causa] : null,
      datos.detecta ? U[datos.detecta] : null, datos.crea ? U[datos.crea] : null, datos.cuando || null, datos.estado || null]);
}

const I = {};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  for (const e of ['E1', 'E2', 'E3']) {
    E[e] = (await one(`INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id`,
      [`${MARCA} ${e}`, `${MARCA}-${e}`])).id;
  }
  for (const [c, e] of [['A', 'E1'], ['A2', 'E1'], ['B', 'E2'], ['C', 'E3']]) {
    P[c] = (await one(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, E[e]])).id;
  }
  await superadminDeLaBase();
  await persona('soporte', 'soporte');
  await persona('adminA', 'admin', ['A']);
  await persona('adminA_bis', 'admin', ['A']);
  await persona('adminB', 'admin', ['B']);
  await persona('gestoraA', 'gestor', ['A']);
  await persona('gestoraA2', 'gestor', ['A']);
  await persona('gestoraB', 'gestor', ['B']);
  await persona('tutorA', 'tutor', ['A']);

  I.deGestoraA = (await apuntar({ que: 'causó gestoraA en A', campus: 'A', causa: 'gestoraA', crea: 'adminA' })).id;
  I.detectoGestoraA = (await apuntar({ que: 'detectó gestoraA en A', campus: 'A', causa: 'gestoraA2', detecta: 'gestoraA', crea: 'adminA' })).id;
  I.deGestoraA2 = (await apuntar({ que: 'causó gestoraA2 en A', campus: 'A', causa: 'gestoraA2', tipos: ['capa8', 'fallo_crm'], crea: 'adminA', estado: 'closed' })).id;
  I.campusA2 = (await apuntar({ que: 'en A2, de la misma empresa', campus: 'A2', tipos: ['dato_mal'] })).id;
  I.empresaE1 = (await apuntar({ que: 'de la empresa E1', empresa: 'E1', tipos: ['externo'] })).id;
  I.campusB = (await apuntar({ que: 'en B', campus: 'B', causa: 'adminB', crea: 'adminB' })).id;
  I.sinCampus = (await apuntar({ que: 'sin campus', tipos: ['fallo_crm'] })).id;
}, 60000);

afterAll(async () => {
  // Las personas que creó esta prueba: el superadmin es el de la base y se queda.
  const ids = Object.entries(U).filter(([k]) => k !== 'superadmin').map(([, id]) => id);
  await q('DELETE FROM incidencias WHERE que_paso LIKE $1', [`${MARCA}%`]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [Object.values(P)]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [Object.values(E)]);
  await pool.end();
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
});

const lista = async (quien, params = {}) => {
  const r = await request.get('/api/incidencias').query({ limit: 200, ...params }).set(como(quien));
  expect(r.status).toBe(200);
  return nuestras(r.body.data);
};

describe('quién ve qué (#253)', () => {
  it('el superadmin y soporte las ven todas', async () => {
    expect(await lista('superadmin')).toHaveLength(7);
    expect(await lista('soporte')).toHaveLength(7);
  });

  // PR #612 (Diego): «nadie ve incidencias de otra empresa». Las de «todo el
  // CRM» solo superadmin, soporte y quien está en ella.
  it('un admin ve las de su campus, las de su empresa y las suyas; las de «todo el CRM», no', async () => {
    expect(await lista('adminA')).toEqual([
      'causó gestoraA en A', 'causó gestoraA2 en A', 'de la empresa E1', 'detectó gestoraA en A',
    ]);
  });

  it('el resto de admin de su campus las ve igual, aunque no las haya apuntado él', async () => {
    expect(await lista('adminA_bis')).toEqual(await lista('adminA'));
  });

  it('ni las de otro campus de su misma empresa que no lleva: sus campus, no la empresa entera (#245)', async () => {
    expect(await lista('adminA')).not.toContain('en A2, de la misma empresa');
  });

  it('el admin de la otra empresa no ve ninguna de E1', async () => {
    expect(await lista('adminB')).toEqual(['en B']);
  });

  it('una sin campus apuntada por un admin la ve él, no el admin de otra empresa ni su compañero', async () => {
    const legada = (await apuntar({ que: 'sin campus de adminA', crea: 'adminA' })).id;
    try {
      expect(await lista('adminA')).toContain('sin campus de adminA');
      expect(await lista('adminB')).not.toContain('sin campus de adminA');
      expect(await lista('adminA_bis')).not.toContain('sin campus de adminA');
      expect(await lista('soporte')).toContain('sin campus de adminA');
      const porId = await request.get(`/api/incidencias/${legada}`).set(como('adminB'));
      expect(porId.status).toBe(404);
    } finally {
      await q('DELETE FROM incidencias WHERE id = $1', [legada]);
    }
  });

  it('la gestora ve solo las que causó; ni las de su compañera, ni las que detectó y causó otra', async () => {
    expect(await lista('gestoraA')).toEqual(['causó gestoraA en A']);
    expect(await lista('gestoraB')).toEqual([]);
  });

  it('la gestora tampoco abre por id una de su compañera: 404, como si no existiera', async () => {
    const ajena = await request.get(`/api/incidencias/${I.deGestoraA2}`).set(como('gestoraA'));
    const detectada = await request.get(`/api/incidencias/${I.detectoGestoraA}`).set(como('gestoraA'));
    const noExiste = await request.get('/api/incidencias/2147483000').set(como('gestoraA'));
    expect([ajena.status, detectada.status, noExiste.status]).toEqual([404, 404, 404]);
    expect(ajena.body.error).toBe(noExiste.body.error);
  });

  it('un id que no es un número es un 404, no un 500', async () => {
    for (const malo of ['abc', '1.5', '99999999999', '-3']) {
      const r = await request.get(`/api/incidencias/${malo}`).set(como('superadmin'));
      expect(r.status, malo).toBe(404);
    }
  });

  it('la gestora no puede apuntar ni editar: 403', async () => {
    const nueva = await request.post('/api/incidencias').set(como('gestoraA'))
      .send({ tipos: ['capa8'], quePaso: `${MARCA} no debería entrar` });
    const cambio = await request.patch(`/api/incidencias/${I.deGestoraA}`).set(como('gestoraA'))
      .send({ estado: 'closed' });
    expect(nueva.status).toBe(403);
    expect(cambio.status).toBe(403);
  });

  it('un tutor no entra: 403', async () => {
    const r = await request.get('/api/incidencias').set(como('tutorA'));
    expect(r.status).toBe(403);
  });

  it('el selector de arriba acota dentro de lo suyo: empresa E1 = sus campus y la de la empresa', async () => {
    expect(await lista('superadmin', { issuerId: E.E1 })).toEqual([
      'causó gestoraA en A', 'causó gestoraA2 en A', 'de la empresa E1',
      'detectó gestoraA en A', 'en A2, de la misma empresa',
    ]);
    expect(await lista('adminB', { projectId: P.A })).toEqual([]);
  });

  it('una página imposible es un 400, no un 500', async () => {
    const r = await request.get('/api/incidencias').query({ page: '1e20' }).set(como('superadmin'));
    expect(r.status).toBe(400);
  });
});

describe('crear, editar y cerrar (#253)', () => {
  let id;

  it('un admin apunta una incidencia con todos los campos y su enlace a la ficha', async () => {
    const r = await request.post('/api/incidencias').set(como('adminA')).send({
      ocurrioAt: '2026-10-06T15:10:00+02:00',
      projectId: P.A,
      tipos: ['capa8', 'fallo_crm', 'capa8'],
      causadaPor: U.gestoraA,
      entidadTipo: 'lead',
      entidadId: 4033,
      quePaso: `${MARCA} alta en el campus equivocado`,
      impacto: 'No se pudo convertir',
      gravedad: 'high',
    });
    expect(r.status).toBe(201);
    id = r.body.data.id;
    expect(r.body.data).toMatchObject({
      projectId: P.A, causadaPor: U.gestoraA, entidadTipo: 'lead', entidadId: 4033,
      gravedad: 'high', estado: 'open', crm: 'multicrm',
      // Repetidos fuera: «capa 8, capa 8» contaría dos veces en las cifras.
      tipos: ['capa8', 'fallo_crm'],
      // Quien la detectó, si no se dice, es quien la apunta.
      detectadaPor: U.adminA, creadaPor: U.adminA,
    });
    expect(new Date(r.body.data.ocurrioAt).toISOString()).toBe('2026-10-06T13:10:00.000Z');
  });

  it('el otro admin de su campus la ve, y la gestora que la causó también; el de otra empresa, no', async () => {
    expect(await lista('adminA_bis')).toContain('alta en el campus equivocado');
    expect(await lista('gestoraA')).toContain('alta en el campus equivocado');
    expect(await lista('adminB')).not.toContain('alta en el campus equivocado');
  });

  it('«Nadie del CRM» en quién la detectó se respeta: no se pone a quien la apunta', async () => {
    const r = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.A, tipos: ['externo'], detectadaPor: null, quePaso: `${MARCA} la vio un alumno` });
    expect(r.status).toBe(201);
    expect(r.body.data.detectadaPor).toBeNull();
  });

  it('se edita: cómo se arregló y por quién', async () => {
    const r = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({
      comoSeArreglo: 'Se pasó al campus bueno', arregladaPor: U.adminA, estado: 'in_review',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ comoSeArreglo: 'Se pasó al campus bueno', arregladaPor: U.adminA, estado: 'in_review' });
    expect(r.body.data.arregladaAt).toBeNull();
  });

  it('al cerrarla sin decir cuándo se arregló, se pone la fecha de ahora; al reabrir no se borra', async () => {
    const cerrada = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ estado: 'closed' });
    expect(cerrada.body.data.estado).toBe('closed');
    expect(cerrada.body.data.arregladaAt).not.toBeNull();
    const reabierta = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ estado: 'open' });
    expect(reabierta.body.data.arregladaAt).toBe(cerrada.body.data.arregladaAt);
  });

  // Auditoría final del 02/11: al crearla ya resuelta no se ponía la fecha.
  it('apuntada ya resuelta y sin fecha de arreglo, se pone la de ahora; con la suya, la suya', async () => {
    const sin = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.A, tipos: ['capa8'], estado: 'resolved', quePaso: `${MARCA} ya resuelta` });
    expect(sin.status).toBe(201);
    expect(sin.body.data.arregladaAt).not.toBeNull();
    const con = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.A, tipos: ['capa8'], estado: 'closed', arregladaAt: '2026-10-06T10:00:00Z', quePaso: `${MARCA} cerrada con fecha` });
    expect(new Date(con.body.data.arregladaAt).toISOString()).toBe('2026-10-06T10:00:00.000Z');
    const abierta = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.A, tipos: ['capa8'], quePaso: `${MARCA} abierta` });
    expect(abierta.body.data.arregladaAt).toBeNull();
  });

  it('campus O empresa: pasarla a la empresa le quita el campus', async () => {
    const r = await request.patch(`/api/incidencias/${id}`).set(como('superadmin')).send({ sociedadId: E.E1 });
    expect(r.body.data).toMatchObject({ sociedadId: E.E1, projectId: null });
    const vuelta = await request.patch(`/api/incidencias/${id}`).set(como('superadmin')).send({ projectId: P.A });
    expect(vuelta.body.data).toMatchObject({ sociedadId: null, projectId: P.A });
  });

  it('un admin no la cuelga en un campus ni en una empresa que no son suyos: 403', async () => {
    const campus = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.B, tipos: ['capa8'], quePaso: `${MARCA} en campus ajeno` });
    const empresa = await request.post('/api/incidencias').set(como('adminA'))
      .send({ sociedadId: E.E2, tipos: ['capa8'], quePaso: `${MARCA} en empresa ajena` });
    const mover = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ projectId: P.B });
    expect([campus.status, empresa.status, mover.status]).toEqual([403, 403, 403]);
  });

  // PR #612: sin campus la vería solo quien ve todo el CRM; un admin la sacaba
  // así de su empresa.
  it('un admin no la deja sin campus ni empresa, ni al apuntarla ni al editarla: 400', async () => {
    const nueva = await request.post('/api/incidencias').set(como('adminA'))
      .send({ tipos: ['capa8'], quePaso: `${MARCA} sin campus por un admin` });
    const vaciar = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ projectId: null });
    expect([nueva.status, vaciar.status]).toEqual([400, 400]);
    expect(nueva.body.error).toMatch(/campus o la empresa/);
    const sigue = await request.get(`/api/incidencias/${id}`).set(como('adminA'));
    expect(sigue.body.data.projectId).toBe(P.A);
  });

  it('una suya que ya estaba sin campus no se guarda sin elegirle uno; con uno, sí', async () => {
    const legada = (await apuntar({ que: 'sin campus de antes', crea: 'adminA' })).id;
    const solo = await request.patch(`/api/incidencias/${legada}`).set(como('adminA')).send({ estado: 'closed' });
    expect(solo.status).toBe(400);
    const conCampus = await request.patch(`/api/incidencias/${legada}`).set(como('adminA')).send({ projectId: P.A, estado: 'closed' });
    expect(conCampus.status).toBe(200);
    expect(conCampus.body.data.projectId).toBe(P.A);
  });

  it('el superadmin y soporte sí la apuntan para todo el CRM', async () => {
    for (const quien of ['superadmin', 'soporte']) {
      const r = await request.post('/api/incidencias').set(como(quien))
        .send({ tipos: ['fallo_crm'], quePaso: `${MARCA} todo el CRM por ${quien}` });
      expect(r.status, quien).toBe(201);
      expect(r.body.data).toMatchObject({ projectId: null, sociedadId: null });
    }
  });

  it('un admin no pone como causante a alguien de otra empresa: le abriría la incidencia', async () => {
    const r = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.A, tipos: ['capa8'], causadaPor: U.gestoraB, quePaso: `${MARCA} causante ajena` });
    expect(r.status).toBe(400);
    expect(await lista('gestoraB')).toEqual([]);
  });

  // Auditoría del 02/11: el diálogo vuelve a mandar las personas que ya había.
  // Una que apuntó el superadmin (detectó: él, que no está en el campus) no
  // dejaba al admin del campus guardarla ni cerrarla: 400.
  it('el admin del campus guarda y cierra una que apuntó el superadmin, mandando todo como el diálogo', async () => {
    const alta = await request.post('/api/incidencias').set(como('superadmin'))
      .send({ projectId: P.A, tipos: ['capa8'], causadaPor: U.gestoraA, quePaso: `${MARCA} la apuntó el superadmin` });
    expect(alta.status).toBe(201);
    expect(alta.body.data.detectadaPor).toBe(U.superadmin);
    const r = await request.patch(`/api/incidencias/${alta.body.data.id}`).set(como('adminA')).send({
      tipos: ['capa8'], causadaPor: U.gestoraA, detectadaPor: U.superadmin, arregladaPor: U.adminA,
      quePaso: `${MARCA} la apuntó el superadmin`, comoSeArreglo: 'Cerrada por el admin del campus', estado: 'closed',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'closed', detectadaPor: U.superadmin, arregladaPor: U.adminA });
  });

  it('pero cambiar a alguien por una persona de otra empresa sigue sin valer: 400', async () => {
    const r = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ causadaPor: U.gestoraB });
    expect(r.status).toBe(400);
    expect(await lista('gestoraB')).toEqual([]);
  });

  it('se puede borrar «cuándo se arregló» una vez puesto', async () => {
    const puesta = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ arregladaAt: '2026-10-20T10:00:00Z' });
    expect(puesta.body.data.arregladaAt).not.toBeNull();
    const r = await request.patch(`/api/incidencias/${id}`).set(como('adminA')).send({ arregladaAt: null });
    expect(r.status).toBe(200);
    expect(r.body.data.arregladaAt).toBeNull();
  });

  // Auditoría final del 02/11: borrada en una resuelta, volvía al guardar otra
  // cosa (el diálogo manda siempre el estado).
  it('borrada en una resuelta, guardar otra cosa no la vuelve a poner', async () => {
    const alta = await request.post('/api/incidencias').set(como('adminA'))
      .send({ projectId: P.A, tipos: ['capa8'], estado: 'resolved', quePaso: `${MARCA} resuelta sin fecha` });
    const otra = alta.body.data.id;
    await request.patch(`/api/incidencias/${otra}`).set(como('adminA')).send({ arregladaAt: null, estado: 'resolved' });
    const r = await request.patch(`/api/incidencias/${otra}`).set(como('adminA')).send({ impacto: 'otra cosa', estado: 'resolved' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ impacto: 'otra cosa', arregladaAt: null });
    // Pero reabrirla y volver a cerrarla sí la pone: eso es cerrarla.
    await request.patch(`/api/incidencias/${otra}`).set(como('adminA')).send({ estado: 'open' });
    const cerrada = await request.patch(`/api/incidencias/${otra}`).set(como('adminA')).send({ estado: 'closed' });
    expect(cerrada.body.data.arregladaAt).not.toBeNull();
  });

  // Auditoría final del 02/11: el desplegable no las ofrecía, pero la API sí las aceptaba.
  it('una persona desactivada no se puede poner, ni por el admin del campus ni por el superadmin', async () => {
    await persona('gestoraA_baja', 'gestor', ['A']);
    await q('UPDATE users SET active = false WHERE id = $1', [U.gestoraA_baja]);
    for (const quien of ['adminA', 'superadmin']) {
      const r = await request.patch(`/api/incidencias/${id}`).set(como(quien)).send({ causadaPor: U.gestoraA_baja });
      expect(r.status, quien).toBe(400);
    }
  });

  it('el admin de otra empresa no la edita: 404', async () => {
    const r = await request.patch(`/api/incidencias/${id}`).set(como('adminB')).send({ estado: 'closed' });
    expect(r.status).toBe(404);
  });

  it('lo que no vale es un 400 con su motivo, no un 500', async () => {
    const casos = [
      { tipos: [], quePaso: `${MARCA} sin tipo` },
      { tipos: ['capa9'], quePaso: `${MARCA} tipo raro` },
      { tipos: ['capa8'], quePaso: '' },
      { tipos: ['capa8'], quePaso: `${MARCA} dos ámbitos`, projectId: P.A, sociedadId: E.E1 },
      { tipos: ['capa8'], quePaso: `${MARCA} fecha imposible`, ocurrioAt: '2026-13-45' },
      { tipos: ['capa8'], quePaso: `${MARCA} persona que no existe`, causadaPor: 2147483000 },
    ];
    for (const c of casos) {
      const r = await request.post('/api/incidencias').set(como('superadmin')).send(c);
      expect(r.status, JSON.stringify(c)).toBe(400);
    }
  });
});

// «Sobre qué»: la issue pide «con su id y enlace a la ficha». Facturas y
// usuarios no tienen ficha propia: como el buscador (Ctrl K, #591), la factura
// lleva a su venta y el usuario a Usuarios con su nombre. Solo si son de los
// campus de quien mira: con un id cualquiera no se sabe nada de otra empresa.
describe('el enlace de una factura o un usuario (#253)', () => {
  const D = {};
  beforeAll(async () => {
    D.lead = (await one(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, $2, $3, '+34600111222') RETURNING id`,
      [P.B, `${MARCA} cliente`, `cliente.${MARCA.toLowerCase()}@test.local`])).id;
    D.venta = (await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
      VALUES ($1, $2, 'x', 500, 100, CURRENT_DATE) RETURNING id`, [D.lead, P.B])).id;
    D.factura = (await one(`INSERT INTO invoices (project_id, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, total, lead_id, conversion_id)
      VALUES ($1, 2026, 987253, $2, $3, 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 100, 121, $4, $5) RETURNING id`,
      [P.B, `${MARCA}-F`, `${MARCA} cliente`, D.lead, D.venta])).id;
  });
  afterAll(async () => {
    await q('DELETE FROM invoices WHERE id = $1', [D.factura]);
    await q('DELETE FROM conversions WHERE id = $1', [D.venta]);
    await q('DELETE FROM leads WHERE id = $1', [D.lead]);
  });

  // En el campus de quien la apunta: un admin no puede dejarla sin campus (PR #612).
  const apuntar = (quien, entidadTipo, entidadId) => request.post('/api/incidencias').set(como(quien))
    .send({ projectId: quien === 'adminB' ? P.B : P.A, tipos: ['capa8'], entidadTipo, entidadId,
      quePaso: `${MARCA} sobre ${entidadTipo} ${entidadId}` });

  it('la factura de su campus lleva a su venta, en la ficha y en la lista', async () => {
    const r = await apuntar('adminB', 'factura', D.factura);
    expect(r.status).toBe(201);
    expect(r.body.data.entidadVentaId).toBe(D.venta);
    const ficha = await request.get(`/api/incidencias/${r.body.data.id}`).set(como('adminB'));
    expect(ficha.body.data.entidadVentaId).toBe(D.venta);
    const lista = await request.get('/api/incidencias').query({ limit: 200 }).set(como('superadmin'));
    expect(lista.body.data.find((i) => i.id === r.body.data.id).entidadVentaId).toBe(D.venta);
  });

  it('el usuario de su campus lleva a Usuarios con su nombre', async () => {
    const r = await apuntar('adminA', 'usuario', U.gestoraA);
    expect(r.body.data.entidadNombre).toBe(`${MARCA} gestoraA`);
  });

  // Auditoría del 03/11: a la gestora el enlace la llevaba a Usuarios, que no
  // puede abrir (`users.view` es de admin y soporte).
  it('a la gestora no se le da el nombre: no puede abrir Usuarios', async () => {
    const alta = await request.post('/api/incidencias').set(como('superadmin')).send({
      projectId: P.A, tipos: ['capa8'], causadaPor: U.gestoraA, entidadTipo: 'usuario', entidadId: U.gestoraA2,
      quePaso: `${MARCA} sobre su compañera`,
    });
    expect(alta.status).toBe(201);
    const suya = await request.get(`/api/incidencias/${alta.body.data.id}`).set(como('gestoraA'));
    expect(suya.status).toBe(200);
    expect(suya.body.data.entidadNombre).toBeNull();
    const admin = await request.get(`/api/incidencias/${alta.body.data.id}`).set(como('adminA'));
    expect(admin.body.data.entidadNombre).toBe(`${MARCA} gestoraA2`);
  });

  it('de otra empresa no se sabe nada: ni la venta de la factura ni el nombre', async () => {
    const f = await apuntar('adminA', 'factura', D.factura);
    expect(f.status).toBe(201);
    expect(f.body.data.entidadVentaId).toBeNull();
    const u = await apuntar('adminA', 'usuario', U.gestoraB);
    expect(u.body.data.entidadNombre).toBeNull();
    // El superadmin, que ve todo el CRM, sí.
    const s = await request.get(`/api/incidencias/${u.body.data.id}`).set(como('superadmin'));
    expect(s.body.data.entidadNombre).toBe(`${MARCA} gestoraB`);
  });
});

// Auditoría del 02/11 (2.ª): el diálogo cargaba /users, sin recortar por campus,
// y un admin elegía a alguien que luego el servidor no le aceptaba.
describe('las personas que se pueden elegir (#253)', () => {
  const nombres = async (quien) => {
    const r = await request.get('/api/incidencias/personas').set(como(quien));
    expect(r.status, quien).toBe(200);
    return r.body.data.map((p) => p.id);
  };

  it('un admin, solo las de sus campus (y él): las mismas que el servidor acepta al guardar', async () => {
    const ids = await nombres('adminA');
    for (const k of ['adminA', 'adminA_bis', 'gestoraA', 'gestoraA2']) expect(ids, k).toContain(U[k]);
    for (const k of ['adminB', 'gestoraB', 'superadmin']) expect(ids, k).not.toContain(U[k]);
  });

  it('el superadmin, cualquiera', async () => {
    const ids = await nombres('superadmin');
    for (const k of ['adminA', 'gestoraB', 'adminB']) expect(ids, k).toContain(U[k]);
  });

  it('la gestora no: 403', async () => {
    expect((await request.get('/api/incidencias/personas').set(como('gestoraA'))).status).toBe(403);
  });
});

describe('los adjuntos (#253)', () => {
  let adjunto;

  it('quien la apunta sube una captura; un SVG no se acepta', async () => {
    const r = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('adminA'))
      .attach('file', PNG, { filename: 'captura.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
    adjunto = r.body.data.id;
    const svg = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('adminA'))
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(400);
  });

  it('sale en la ficha y lo descargan quien la ve: el admin del campus y la gestora que la causó', async () => {
    const ficha = await request.get(`/api/incidencias/${I.deGestoraA}`).set(como('adminA'));
    expect(ficha.body.data.adjuntos.map((a) => a.name)).toEqual(['captura.png']);
    for (const quien of ['adminA', 'adminA_bis', 'gestoraA']) {
      const r = await request.get(`/api/incidencias/adjuntos/${adjunto}`).set(como(quien));
      expect(r.status, quien).toBe(200);
      expect(r.headers['content-type']).toMatch(/image\/png/);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('nadie más: la compañera, el admin de otra empresa, sin sesión, ni un id raro', async () => {
    for (const quien of ['gestoraA2', 'adminB']) {
      const r = await request.get(`/api/incidencias/adjuntos/${adjunto}`).set(como(quien));
      expect(r.status, quien).toBe(404);
    }
    expect((await request.get(`/api/incidencias/adjuntos/${adjunto}`)).status).toBe(401);
    expect((await request.get('/api/incidencias/adjuntos/abc').set(como('superadmin'))).status).toBe(404);
  });

  it('la gestora no sube adjuntos: 403', async () => {
    const r = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('gestoraA'))
      .attach('file', PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(r.status).toBe(403);
  });

  // Auditoría del 02/11 (2.ª): estos dos salían como un 500.
  it('un fichero de más de 10 MB es un 400, no un 500', async () => {
    const r = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('adminA'))
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'grande.png', contentType: 'image/png' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FILE_TOO_LARGE');
  });

  it('un envío cortado a medias es un 400, no un 500', async () => {
    const r = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('adminA'))
      .set('Content-Type', 'multipart/form-data; boundary=XYZ')
      .send('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc');
    expect(r.status).toBe(400);
  });

  it('un nombre con tildes y eñes se guarda bien («año», no «aÃ±o»)', async () => {
    const r = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('adminA'))
      .attach('file', PNG, { filename: 'captura-año-Peña.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
    expect(r.body.data.name).toBe('captura-año-Peña.png');
  });

  // Auditoría corta del 02/11: sin «ñ» ni «é» a la vista no se arreglaban.
  it('y también una raya, un nombre en chino o la tilde suelta de un Mac', async () => {
    const casos = [
      ['informe—final.png', 'informe—final.png'],
      ['截图.png', '截图.png'],
      ['café.png', 'café.png'],
    ];
    for (const [envia, queda] of casos) {
      const r = await request.post(`/api/incidencias/${I.sinCampus}/adjuntos`).set(como('superadmin'))
        .attach('file', PNG, { filename: envia, contentType: 'image/png' });
      expect(r.status, envia).toBe(201);
      expect(r.body.data.name, envia).toBe(queda);
    }
  });

  it('un nombre de más de 255 caracteres se guarda recortado, con su extensión', async () => {
    const r = await request.post(`/api/incidencias/${I.deGestoraA}/adjuntos`).set(como('adminA'))
      .attach('file', PNG, { filename: `${'a'.repeat(300)}.png`, contentType: 'image/png' });
    expect(r.status).toBe(201);
    expect(r.body.data.name).toHaveLength(255);
    expect(r.body.data.name.endsWith('.png')).toBe(true);
  });

  // Auditoría del 02/11: el tope de 5 solo estaba en la pantalla.
  it('como mucho 5 por incidencia, también por la API: el sexto es un 400', async () => {
    const subir = (n) => request.post(`/api/incidencias/${I.campusB}/adjuntos`).set(como('adminB'))
      .attach('file', PNG, { filename: `c${n}.png`, contentType: 'image/png' });
    for (let n = 1; n <= 5; n++) expect((await subir(n)).status, `el ${n}.º`).toBe(201);
    const sexto = await subir(6);
    expect(sexto.status).toBe(400);
    expect(sexto.body.code).toBe('DEMASIADOS_ADJUNTOS');
  });
});

describe('las cifras cuadran con la lista (#253)', () => {
  it('por persona y por mes suman el total, que es lo que da la lista', async () => {
    for (const quien of ['superadmin', 'adminA', 'gestoraA']) {
      const r = await request.get('/api/incidencias/metricas').query({ issuerId: E.E1 }).set(como(quien));
      expect(r.status).toBe(200);
      const m = r.body.data;
      const l = await request.get('/api/incidencias').query({ issuerId: E.E1, limit: 200 }).set(como(quien));
      expect(m.total, quien).toBe(l.body.pagination.total);
      expect(m.porPersona.reduce((s, p) => s + p.total, 0), quien).toBe(m.total);
      expect(m.porMes.reduce((s, p) => s + p.total, 0), quien).toBe(m.total);
    }
  });

  it('con los mismos filtros que la lista: estado, tipo y persona', async () => {
    for (const filtro of [{ estado: 'closed' }, { tipo: 'fallo_crm' }, { causadaPor: U.gestoraA2 }]) {
      const params = { issuerId: E.E1, ...filtro };
      const m = await request.get('/api/incidencias/metricas').query(params).set(como('superadmin'));
      const l = await request.get('/api/incidencias').query({ ...params, limit: 200 }).set(como('superadmin'));
      expect(m.body.data.total, JSON.stringify(filtro)).toBe(l.body.pagination.total);
    }
  });

  it('una con dos tipos cuenta en los dos; por persona se ve el desglose', async () => {
    const r = await request.get('/api/incidencias/metricas').query({ projectId: P.A }).set(como('adminA'));
    const a2 = r.body.data.porPersona.find((p) => p.userId === U.gestoraA2);
    // gestoraA2 causó dos en A: «detectó gestoraA» (capa 8) y la de capa 8 + fallo del CRM.
    expect(a2).toMatchObject({ total: 2, capa8: 2, fallo_crm: 1 });
  });

  it('la gestora solo cuenta las suyas: su compañera no le sale en las cifras', async () => {
    const r = await request.get('/api/incidencias/metricas').set(como('gestoraA'));
    const quienes = r.body.data.porPersona.map((p) => p.userId);
    expect(quienes).not.toContain(U.gestoraA2);
    expect(quienes).not.toContain(U.adminB);
    expect(r.body.data.total).toBe((await lista('gestoraA')).length);
  });

  it('el mes va en hora de Madrid: el 1/11 a las 00:30 es noviembre aunque en UTC sea 31/10', async () => {
    await apuntar({ que: 'primera hora de noviembre', campus: 'C', cuando: '2026-11-01T00:30:00+01:00' });
    const r = await request.get('/api/incidencias/metricas').query({ projectId: P.C }).set(como('superadmin'));
    expect(r.body.data.porMes.map((m) => m.mes)).toEqual(['2026-11']);
  });

  it('con «meses», solo los últimos meses contando el actual', async () => {
    await apuntar({ que: 'de hace dos años', campus: 'C', cuando: '2024-06-15T12:00:00+02:00' });
    const todo = await request.get('/api/incidencias/metricas').query({ projectId: P.C }).set(como('superadmin'));
    const reciente = await request.get('/api/incidencias/metricas').query({ projectId: P.C, meses: 12 }).set(como('superadmin'));
    expect(todo.body.data.total).toBe(2);
    expect(reciente.body.data.total).toBe(1);
  });
});
