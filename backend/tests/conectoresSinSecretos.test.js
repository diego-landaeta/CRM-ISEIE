import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/shared/config/db.js';

/**
 * Las credenciales de un conector no salen por la API (#6).
 *
 * `project_connectors.config` guarda el `consumer_secret` de WooCommerce, la
 * contraseña de aplicación de WordPress y el `bearer_token` de una API propia.
 * El modelo hace `SELECT *`, así que esos valores viajaban al navegador enteros
 * en cada carga de la pantalla.
 *
 * Se descubrió al ir a construir la pantalla de conectores: antes de pintar un
 * campo hay que saber qué llega, y llegaba el secreto en texto plano.
 *
 * Se tapa en el controlador y no en el modelo a propósito: el `preview` y el
 * importador leen del modelo y necesitan el valor de verdad para llamar al API
 * externo. Lo que no puede salir es por la puerta HTTP.
 *
 * Y la segunda regla, que es la que muerde en cuanto existe la pantalla:
 * **guardar no puede borrar el secreto que no se mandó.**
 */

let token;
let projectId;
let conectorId;
let saId;
let proyectoNuevo = false;

const SECRETO = 'cs_secreto_de_prueba_123456';

beforeAll(async () => {
  // La base local de ISEIE sale sin datos de ejemplo: el super admin y el
  // proyecto los pone la prueba (en MultiCRM vienen de los datos de ejemplo).
  const { default: jwt } = await import('jsonwebtoken');
  const u = await query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('SA conectores', $1, 'x', 'superadmin') RETURNING id, email`,
    [`sa.conectores.${Date.now()}@prueba.test`]);
  saId = u.rows[0].id;
  token = jwt.sign({ userId: saId, email: u.rows[0].email, role: 'superadmin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const p = await query('SELECT id FROM projects ORDER BY id LIMIT 1');
  projectId = p.rows[0]?.id;
  if (!projectId) {
    projectId = (await query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Prueba conectores', $1, $1) RETURNING id`,
      [`prueba-conectores-${Date.now()}`])).rows[0].id;
    proyectoNuevo = true;
  }

  const creado = await request(app).post('/api/connectors')
    .set('Authorization', `Bearer ${token}`)
    .send({
      project_id: projectId,
      type: 'woocommerce_products',
      label: '[prueba] conector de test',
      destination: 'product',
      config: {
        base_url: 'https://ejemplo.test',
        consumer_key: 'ck_publica',
        consumer_secret: SECRETO,
      },
    });
  expect(creado.status, JSON.stringify(creado.body)).toBe(201);
  conectorId = creado.body.data.id;
});

afterAll(async () => {
  if (conectorId) await query('DELETE FROM project_connectors WHERE id = $1', [conectorId]);
  if (proyectoNuevo) await query('DELETE FROM projects WHERE id = $1', [projectId]);
  if (saId) await query('DELETE FROM users WHERE id = $1', [saId]);
});

describe('el secreto no sale por la API', () => {
  it('ni al crearlo', async () => {
    // La respuesta del POST es lo primero que ve la pantalla.
    const r = await request(app).get(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(r.body)).not.toContain(SECRETO);
  });

  it('ni al listar', async () => {
    const r = await request(app).get(`/api/connectors?projectId=${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(SECRETO);
  });

  it('pero se dice que HAY uno guardado, que es lo que la pantalla necesita', async () => {
    // Sin esto la pantalla no puede distinguir «sin configurar» de «configurado»,
    // y acabaria pidiendo la clave otra vez cada vez que se edita la etiqueta.
    const r = await request(app).get(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.body.data.secretos_guardados).toMatchObject({ consumer_secret: true });
  });

  it('lo que no es secreto sí viaja', async () => {
    const r = await request(app).get(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.body.data.config.base_url).toBe('https://ejemplo.test');
    expect(r.body.data.config.consumer_key).toBe('ck_publica');
    expect(r.body.data.config).not.toHaveProperty('consumer_secret');
  });

  it('y sigue estando en la base, que el importador lo necesita', async () => {
    const { rows } = await query('SELECT config FROM project_connectors WHERE id = $1', [conectorId]);
    expect(rows[0].config.consumer_secret).toBe(SECRETO);
  });
});

describe('guardar no borra el secreto que no se mando', () => {
  it('cambiar solo la etiqueta lo deja intacto', async () => {
    const r = await request(app).patch(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: '[prueba] renombrado' });
    expect(r.status).toBe(200);

    const { rows } = await query('SELECT config FROM project_connectors WHERE id = $1', [conectorId]);
    expect(rows[0].config.consumer_secret).toBe(SECRETO);
  });

  it('devolver el config tal y como lo recibio la pantalla TAMPOCO lo borra', async () => {
    // Este es el caso de verdad: la pantalla recibe el config sin secretos, el
    // usuario cambia la URL, y lo manda entero. Sin fusionar, aqui se perdia la
    // clave y la siguiente importacion fallaba con un 401 que nadie relacionaria.
    const leido = await request(app).get(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`);
    const config = { ...leido.body.data.config, base_url: 'https://otra.test' };

    const r = await request(app).patch(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config });
    expect(r.status).toBe(200);

    const { rows } = await query('SELECT config FROM project_connectors WHERE id = $1', [conectorId]);
    expect(rows[0].config.consumer_secret, 'se borro el secreto al guardar').toBe(SECRETO);
    expect(rows[0].config.base_url).toBe('https://otra.test');
  });

  it('mandarlo vacio SÍ lo borra: eso es explicito', async () => {
    await request(app).patch(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { consumer_secret: '' } });

    const { rows } = await query('SELECT config FROM project_connectors WHERE id = $1', [conectorId]);
    expect(rows[0].config.consumer_secret).toBe('');

    // Se repone para las demas pruebas del fichero.
    await request(app).patch(`/api/connectors/${conectorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { consumer_secret: SECRETO } });
  });
});
