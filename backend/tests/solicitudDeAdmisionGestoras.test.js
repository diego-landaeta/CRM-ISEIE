import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Solicitud de admisión (antes «Matrículas»): TODAS las gestoras ven las de SUS campus.
 *
 * Diego, 17/11/2026: «todas las gestoras puedan ver en Matrículas la información […] y
 * que esa sección se llame "Solicitud de admisión"». Lo que se fija aquí:
 *
 *   1. el permiso de ver lo trae el rol Gestora de serie —también a quien lo tiene
 *      como rol de más (`roles_extra`)— y en Roles se llama «Solicitud de admisión»;
 *   2. una gestora ve la lista y la ficha de TODAS las solicitudes de su campus, no
 *      solo las de sus prospectos (las que no tienen prospecto o son de otra gestora
 *      también), con sus datos y sus documentos;
 *   3. nada de otro campus: ni en la lista ni abriendo la ficha por su número;
 *   4. la descarga de documentos sigue protegida: sin firma válida, 403.
 *
 *   npx vitest run tests/solicitudDeAdmisionGestoras.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/matriculas/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { SECCIONES } = await import('../src/modules/permissions/catalogo.js');
const { explicarPermisos } = await import('../src/modules/permissions/permissions.service.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `SDA${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], matriculas: [] };
let P; let OTRO; let ANA; let BEA; let EXTRA; let GESTORA_OTRO;
let DE_ANA; let DE_BEA; let SIN_PROSPECTO; let DEL_OTRO;

// Con sus roles de más, como el token de verdad (sin ellos, quien es colaborador de rol
// principal se queda en las rutas del colaborador).
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role, roles_extra: u.roles_extra || [] }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = [], extra = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra) VALUES ($1, $2, 'x', $3, $4::user_role[]) RETURNING id, role, roles_extra::text[] AS roles_extra`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role, extra]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

async function solicitud(projectId, { responsable = null, conProspecto = true, nombre }) {
  let leadId = null;
  if (conProspecto) {
    const [l] = await q('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [projectId, `${MARCA} ${nombre}`, `${nombre.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`, responsable]);
    ids.leads.push(l.id);
    leadId = l.id;
  }
  const [m] = await q(
    `INSERT INTO matriculas (project_id, lead_id, estado, nombre, dni, dni_doc_key, dni_doc_url)
     VALUES ($1, $2, 'solicitud_admision', $3, '12345678Z', $4, '/api/matriculas/0/doc/dni')
     RETURNING id`,
    [projectId, leadId, `${MARCA} ${nombre}`, `matriculas/${projectId}/${MARCA}-${nombre}-dni.pdf`]);
  ids.matriculas.push(m.id);
  return m.id;
}

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  ANA = await persona('ANA', 'gestor', [P]);
  BEA = await persona('BEA', 'gestor', [P]);
  // Gestora como rol de más: su rol principal es otro (colaborador), y con el de gestora
  // no se le aplica el recorte del colaborador.
  EXTRA = await persona('EXTRA', 'colaborador', [P], ['gestor']);
  GESTORA_OTRO = await persona('OTRA', 'gestor', [OTRO]);
  DE_ANA = await solicitud(P, { responsable: ANA.id, nombre: 'Alumna1' });
  DE_BEA = await solicitud(P, { responsable: BEA.id, nombre: 'Alumna2' });
  SIN_PROSPECTO = await solicitud(P, { conProspecto: false, nombre: 'Alumna3' });
  DEL_OTRO = await solicitud(OTRO, { responsable: GESTORA_OTRO.id, nombre: 'Alumna4' });
}, 60000);

afterAll(async () => {
  await q('DELETE FROM matriculas WHERE id = ANY($1::int[])', [ids.matriculas]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('el permiso, en el catálogo', () => {
  const recurso = SECCIONES.flatMap((s) => s.recursos).find((r) => r.clave === 'matriculas');
  const accion = (a) => recurso.acciones.find((x) => x.accion === a);

  it('se llama «Solicitud de admisión» en Roles (la clave sigue siendo `matriculas`)', () => {
    expect(recurso.nombre).toBe('Solicitud de admisión');
    expect(accion('view').nombre).toBe('Ver solicitudes de admisión');
  });

  it('ver lo trae la gestora de serie; validar, rechazar y borrar, no (solo lectura salvo lo que ya podía)', () => {
    expect(accion('view').roles).toContain('gestor');
    expect(accion('cambiar_estado').roles).not.toContain('gestor');
    expect(accion('delete').roles).not.toContain('gestor');
  });

  it.each([['gestora', () => ANA], ['gestora como rol de más', () => EXTRA]])('%s: tiene `matriculas.view` y no `cambiar_estado`', async (_n, quien) => {
    const { mapa } = await explicarPermisos(quien().id);
    expect(mapa['matriculas.view']).toBe(true);
    expect(mapa['matriculas.cambiar_estado']).not.toBe(true);
  });
});

describe('una gestora ve las solicitudes de SU campus, todas', () => {
  it.each([['Ana', () => ANA], ['Bea', () => BEA], ['la de rol de más', () => EXTRA]])('%s: la lista trae las tres del campus, también las que no son suyas', async (_n, quien) => {
    for (const url of ['/api/matriculas', `/api/matriculas?projectId=${P}`]) {
      const r = await request.get(url).set(como(quien()));
      expect(r.status).toBe(200);
      const vistas = r.body.data.map((m) => m.id);
      expect(vistas).toEqual(expect.arrayContaining([DE_ANA, DE_BEA, SIN_PROSPECTO]));
      expect(vistas).not.toContain(DEL_OTRO);
    }
  });

  it('la ficha de una solicitud de otra gestora del campus se abre, con sus datos y el documento firmado', async () => {
    const r = await request.get(`/api/matriculas/${DE_BEA}`).set(como(ANA));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: DE_BEA, dni: '12345678Z' });
    expect(r.body.data.dni_doc_url).toMatch(new RegExp(`^/api/matriculas/${DE_BEA}/doc/dni\\?.*sig=`));
    expect(r.body.data.historial).toEqual(expect.any(Array));
  });

  it('nada de otro campus: ni en la lista pidiéndolo ni abriendo su ficha', async () => {
    expect((await request.get(`/api/matriculas?projectId=${OTRO}`).set(como(ANA))).status).toBe(403);
    expect((await request.get(`/api/matriculas/${DEL_OTRO}`).set(como(ANA))).status).toBe(403);
    // Y la del otro campus, al revés.
    expect((await request.get(`/api/matriculas/${DE_ANA}`).set(como(GESTORA_OTRO))).status).toBe(403);
  });

  it('solo lectura en lo que no podía: cambiar el estado o borrar sigue siendo 403', async () => {
    expect((await request.post(`/api/matriculas/${DE_ANA}/estado`).set(como(ANA)).send({ estado: 'validada' })).status).toBe(403);
    expect((await request.delete(`/api/matriculas/${DE_ANA}`).set(como(ANA))).status).toBe(403);
    const [m] = await q('SELECT estado FROM matriculas WHERE id = $1', [DE_ANA]);
    expect(m.estado).toBe('solicitud_admision');
  });
});

describe('la descarga de documentos sigue protegida', () => {
  it('sin firma, con una firma inventada o con la de otra solicitud: 403', async () => {
    expect((await request.get(`/api/matriculas/${DE_ANA}/doc/dni`)).status).toBe(403);
    expect((await request.get(`/api/matriculas/${DE_ANA}/doc/dni?exp=9999999999999&sig=inventada`)).status).toBe(403);
    // La firma que recibe la gestora para UNA solicitud no abre otra.
    const ficha = await request.get(`/api/matriculas/${DE_BEA}`).set(como(ANA));
    const firma = ficha.body.data.dni_doc_url.split('?')[1];
    expect((await request.get(`/api/matriculas/${DEL_OTRO}/doc/dni?${firma}`)).status).toBe(403);
  });

  it('con sesión pero sin firma, tampoco: la sesión no sustituye a la firma', async () => {
    expect((await request.get(`/api/matriculas/${DE_ANA}/doc/dni`).set(como(ANA))).status).toBe(403);
  });
});
