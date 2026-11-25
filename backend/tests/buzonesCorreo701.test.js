import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { isIP } from 'node:net';

/**
 * Varios buzones de correo conectados desde el panel (CRM-ISEIE#701, traída de
 * `buzonesCorreo1032.test.js` del 360, CRM#1032).
 *
 * Diego, 23/11: «poder conectar varios correos de Hostinger como hicimos en
 * CEDIA». Lo que se fija aquí es lo que pide el «Hecho cuando» de la issue:
 *
 *   · dos o más buzones conectados desde la API, sin tocar el .env;
 *   · se ven en la Bandeja, cada correo con su buzón, y se puede filtrar por uno;
 *   · las credenciales NO están en claro en la base ni salen por la API;
 *   · «Probar conexión» dice si entra o por qué no, sin devolver la contraseña;
 *   · quién puede: el permiso `correos.buzones` y los campus de cada admin;
 *   · el buzón del .env sigue leyéndose si no hay ninguno en la base, y al pasarlo
 *     al panel sus correos se adoptan en vez de duplicarse, y ya no se vuelve a
 *     leer por el .env aunque se quite del panel (CRM#1058);
 *   · el buzón de facturación de una empresa sin correo se ofrece como su correo.
 *
 * El servidor IMAP es de mentira (no se toca ningún buzón real): cada usuario
 * tiene su lista de correos y una contraseña buena.
 *
 *   npx vitest run tests/buzonesCorreo701.test.js
 */

const MARCA = `BZ${Date.now().toString(36)}`;
const dom = `${MARCA.toLowerCase()}.test`;
const CLAVE_BUENA = 'Clave-Buena-701';

const crudo = (id, para, asunto) => Buffer.from(
  `Message-ID: <${id}@${dom}>\r\nFrom: Tutor <tutor@${dom}>\r\nTo: ${para}\r\n`
  + `Subject: ${asunto}\r\nDate: Mon, 23 Nov 2026 10:00:00 +0000\r\n`
  + 'Content-Type: text/plain; charset=utf-8\r\n\r\nHola, os mando la factura.\r\n');

// Lo que hay en cada buzón de mentira. `compartido` llega con copia a los dos.
const FACT = `facturacion@${dom}`;
const SOP = `soporte@${dom}`;
const ENV = `antiguo@${dom}`;
const BUZONES_FALSOS = {
  [FACT]: [crudo('f1', FACT, 'Factura octubre'), crudo('f2', FACT, 'Factura noviembre'),
    crudo('compartido', `${FACT}, ${SOP}`, 'Para los dos')],
  [SOP]: [crudo('s1', SOP, 'No puedo entrar'), crudo('compartido', `${FACT}, ${SOP}`, 'Para los dos')],
  [ENV]: [crudo('e1', ENV, 'Del buzón de siempre'), crudo('e2', ENV, 'Otro del de siempre')],
};
const conexiones = [];

class ImapFlowFalso {
  constructor(opciones) { this.op = opciones; conexiones.push(opciones); }
  on() { return this; }
  async connect() {
    const { user, pass } = this.op.auth;
    if (!BUZONES_FALSOS[user] || pass !== CLAVE_BUENA) {
      const e = new Error('Command failed'); e.authenticationFailed = true; throw e;
    }
  }
  async mailboxOpen(_caja, { readOnly } = {}) {
    // Solo lectura, siempre: el CRM no puede marcar nada como leído.
    if (!readOnly) throw new Error('El CRM abrió el buzón para escribir');
    return { exists: BUZONES_FALSOS[this.op.auth.user].length };
  }
  async search() { return BUZONES_FALSOS[this.op.auth.user].map((_, i) => i + 1); }
  async* fetch(uids) {
    for (const u of uids) yield { source: BUZONES_FALSOS[this.op.auth.user][u - 1] };
  }
  async logout() {}
}
vi.mock('imapflow', () => ({ ImapFlow: ImapFlowFalso }));

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: correos } = await import('../src/modules/correos/index.js');
const { leerBuzon, descifrarConexion } = await import('../src/shared/services/correo-entrante.service.js');
const { resolutor } = await import('../src/shared/services/correo-destino.js');

// DNS de mentira: sin red en las pruebas. Los nombres «interno.» resuelven a una
// privada, «mixto.» a una pública y una privada; el resto, a una pública
// (203.0.113.0/24 es de documentación, no se usa en ningún sitio).
const IP_PUBLICA = '203.0.113.10';
resolutor.lookup = async (host) => {
  // Una IP escrita tal cual se «resuelve» a sí misma, como hace el DNS de verdad.
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  if (host.startsWith('interno.')) return [{ address: '10.0.0.5', family: 4 }];
  if (host.startsWith('mixto.')) return [{ address: IP_PUBLICA, family: 4 }, { address: '192.168.1.9', family: 4 }];
  if (host.startsWith('noexiste.')) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return [{ address: IP_PUBLICA, family: 4 }];
};

const app = express();
app.use(express.json());
app.use(correos.prefix, correos.router);
app.use(errorHandler);
const request = supertest(app);

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = (sql, p) => q(sql, p).then((r) => r[0]);
const ids = { users: [], projects: [], issuers: [], buzones: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let MIO; let AJENO; let EMPRESA_SIN_CORREO; let EMPRESA_CON_CORREO;
let SUPER; let ADMIN; let GESTORA; let PM;

async function persona(n, role, campus = []) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${dom}`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

beforeAll(async () => {
  // Que no quede ningún buzón activo de otra prueba: la compatibilidad con el
  // .env depende de que la tabla esté vacía.
  await q(`UPDATE correo_buzones SET activo = false WHERE activo`);
  const proy = async (c) => {
    const p = await one(
      'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await proy('mio');
  AJENO = await proy('ajeno');
  EMPRESA_SIN_CORREO = (await one(
    'INSERT INTO invoice_issuers (razon_social, nif, project_id) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} CEDIA`, `${MARCA}-C`, MIO])).id;
  EMPRESA_CON_CORREO = (await one(
    'INSERT INTO invoice_issuers (razon_social, nif, project_id, email) VALUES ($1, $2, $3, $4) RETURNING id',
    [`${MARCA} OTRA`, `${MARCA}-O`, MIO, `ya@${dom}`])).id;
  ids.issuers.push(EMPRESA_SIN_CORREO, EMPRESA_CON_CORREO);

  SUPER = await persona('Super', 'superadmin');
  ADMIN = await persona('Admin', 'admin', [MIO]);
  GESTORA = await persona('Gestora', 'gestor', [MIO]);
  PM = await persona('Pm', 'project_manager', [MIO]);
}, 60000);

afterAll(async () => {
  vi.unstubAllEnvs();
  const intenta = (sql, p) => q(sql, p).catch(() => {});
  await intenta(`DELETE FROM email_envios WHERE clave LIKE $1`, [`%@${dom}>%`]);
  await intenta('DELETE FROM correo_buzones WHERE id = ANY($1::int[]) OR direccion LIKE $2', [ids.buzones, `%@${dom}`]);
  await intenta('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await intenta('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

async function conectar(quien, cuerpo) {
  const r = await request.post('/api/correos/buzones').set(como(quien)).send(cuerpo);
  if (r.body?.data?.id) ids.buzones.push(r.body.data.id);
  return r;
}

describe('sin buzones en la base, el del .env como siempre', () => {
  it('sin .env ni base no hay nada que leer, y no es un error', async () => {
    vi.stubEnv('IMAP_USER', '');
    vi.stubEnv('IMAP_PASSWORD', '');
    const r = await leerBuzon();
    expect(r.motivo).toBe('SIN_BUZON');
  });

  it('lee el buzón del .env y guarda sus correos sin buzón', async () => {
    vi.stubEnv('IMAP_USER', ENV);
    vi.stubEnv('IMAP_PASSWORD', CLAVE_BUENA);
    const r = await leerBuzon();
    expect(r.nuevos).toBe(2);
    const filas = await q(`SELECT clave, buzon_id FROM email_envios WHERE clave LIKE $1`, [`%@${dom}>`]);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.buzon_id === null)).toBe(true);
    // La clave de siempre, para no duplicar lo que ya había en los servidores.
    expect(filas.map((f) => f.clave).sort()).toEqual([`entrada:<e1@${dom}>`, `entrada:<e2@${dom}>`]);
  });
});

describe('conectar buzones desde el panel', () => {
  it('superadmin conecta dos, sin tocar el .env', async () => {
    const a = await conectar(SUPER, {
      nombre: 'Facturación CEDIA', direccion: FACT.toUpperCase(), clave: CLAVE_BUENA, project_id: MIO,
    });
    expect(a.status).toBe(201);
    expect(a.body.data.direccion).toBe(FACT);
    expect(a.body.data.configurada).toBe(true);
    const b = await conectar(SUPER, { nombre: 'Soporte', direccion: SOP, clave: CLAVE_BUENA, project_id: MIO });
    expect(b.status).toBe(201);
  });

  it('el mismo buzón dos veces no: 409', async () => {
    const r = await conectar(SUPER, { nombre: 'Otra vez', direccion: FACT, clave: CLAVE_BUENA, project_id: MIO });
    expect(r.status).toBe(409);
  });

  it('la contraseña, el usuario y el servidor NO están en claro en la base', async () => {
    const f = await one(`SELECT * FROM correo_buzones WHERE direccion = $1 AND activo`, [FACT]);
    const fila = JSON.stringify(f);
    expect(fila).not.toContain(CLAVE_BUENA);
    expect(fila).not.toContain('hostinger');
    expect(f.cifrado).toMatch(/^[0-9a-f]+$/);
    // Y se descifra a lo que se guardó, con los valores de Hostinger por defecto.
    expect(descifrarConexion(f)).toEqual({
      host: 'imap.hostinger.com', puerto: 993, usuario: FACT, clave: CLAVE_BUENA,
    });
  });

  it('la API no devuelve la conexión: ni contraseña, ni servidor, ni lo cifrado', async () => {
    const r = await request.get('/api/correos/buzones').set(como(SUPER));
    expect(r.status).toBe(200);
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain(CLAVE_BUENA);
    expect(texto).not.toContain('hostinger');
    for (const b of r.body.data) {
      expect(b).not.toHaveProperty('cifrado');
      expect(b).not.toHaveProperty('iv');
      expect(b).not.toHaveProperty('auth_tag');
      expect(b).not.toHaveProperty('clave');
    }
    expect(r.body.data.filter((b) => b.direccion.endsWith(dom)).map((b) => b.direccion).sort()).toEqual([FACT, SOP]);
  });
});

describe('«Probar conexión»', () => {
  it('con lo escrito, sin guardar: entra y dice cuántos correos hay', async () => {
    const r = await request.post('/api/correos/buzones/probar').set(como(SUPER))
      .send({ direccion: SOP, clave: CLAVE_BUENA });
    expect(r.body.data).toEqual({ ok: true, mensajes: 2 });
  });

  it('con la contraseña mal, lo dice en palabras y no la devuelve', async () => {
    const r = await request.post('/api/correos/buzones/probar').set(como(SUPER))
      .send({ direccion: SOP, clave: 'mala-mala' });
    expect(r.body.data.ok).toBe(false);
    expect(r.body.data.motivo).toMatch(/contraseña/);
    expect(JSON.stringify(r.body)).not.toContain('mala-mala');
  });

  it('uno guardado se prueba con lo guardado, y con 993 va por TLS', async () => {
    const id = (await one(`SELECT id FROM correo_buzones WHERE direccion = $1 AND activo`, [FACT])).id;
    conexiones.length = 0;
    const r = await request.post(`/api/correos/buzones/${id}/probar`).set(como(SUPER)).send({});
    expect(r.body.data.ok).toBe(true);
    // A la IP ya comprobada, con el nombre para el certificado.
    expect(conexiones[0]).toMatchObject({ host: IP_PUBLICA, servername: 'imap.hostinger.com', port: 993, secure: true });
  });

  it('en otro puerto exige STARTTLS: la contraseña no viaja en claro', async () => {
    conexiones.length = 0;
    await request.post('/api/correos/buzones/probar').set(como(SUPER))
      .send({ direccion: SOP, clave: CLAVE_BUENA, host: 'mail.ejemplo.com', puerto: 143 });
    expect(conexiones[0]).toMatchObject({ port: 143, secure: false, doSTARTTLS: true });
  });
});

describe('«Probar» y guardar no conectan a cualquier sitio', () => {
  const probar = (cuerpo) => request.post('/api/correos/buzones/probar').set(como(SUPER))
    .send({ direccion: SOP, clave: CLAVE_BUENA, ...cuerpo });

  it('solo los puertos de IMAP: 993 y 143; el resto, 400 y sin conectar', async () => {
    for (const puerto of [22, 25, 80, 443, 5432, 6379, 3306, 15432]) {
      conexiones.length = 0;
      const r = await probar({ host: 'mail.ejemplo.com', puerto });
      expect(r.status, `puerto ${puerto}`).toBe(400);
      expect(r.body.error).toMatch(/993.*143/);
      expect(conexiones).toHaveLength(0);
    }
    expect((await probar({ host: 'mail.ejemplo.com', puerto: 993 })).status).toBe(200);
  });

  it('un servidor que resuelve a una dirección interna: 400 y sin conectar', async () => {
    for (const host of ['interno.ejemplo.com', 'mixto.ejemplo.com', '127.0.0.1', '169.254.169.254', '10.1.2.3', '::1']) {
      conexiones.length = 0;
      const r = await probar({ host });
      expect(r.status, host).toBe(400);
      // Una IPv6 escrita tal cual ni siquiera pasa la forma del nombre; también es 400.
      expect(r.body.error).toMatch(host === '::1' ? /nombre/ : /interna/);
      expect(conexiones).toHaveLength(0);
    }
  });

  it('un servidor que no existe: 400 que lo dice', async () => {
    const r = await probar({ host: 'noexiste.ejemplo.com' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No se encuentra/);
  });

  it('tampoco se guarda un buzón así, ni se cambia uno hacia ahí', async () => {
    expect((await conectar(SUPER, { nombre: 'x', direccion: `p1@${dom}`, clave: 'x', project_id: MIO, puerto: 6379 })).status).toBe(400);
    expect((await conectar(SUPER, { nombre: 'x', direccion: `p2@${dom}`, clave: 'x', project_id: MIO, host: 'interno.ejemplo.com' })).status).toBe(400);
    const id = (await one(`SELECT id FROM correo_buzones WHERE direccion = $1 AND activo`, [FACT])).id;
    expect((await request.patch(`/api/correos/buzones/${id}`).set(como(SUPER)).send({ host: '192.168.1.1' })).status).toBe(400);
    expect((await request.patch(`/api/correos/buzones/${id}`).set(como(SUPER)).send({ puerto: 25 })).status).toBe(400);
  });

  it('y al LEER se vuelve a mirar justo antes de conectar (rebinding): no conecta', async () => {
    const id = (await one(`SELECT id FROM correo_buzones WHERE direccion = $1 AND activo`, [FACT])).id;
    const antes = resolutor.lookup;
    // Se guardó resolviendo a una pública; ahora el mismo nombre apunta dentro.
    resolutor.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    conexiones.length = 0;
    try {
      const r = await leerBuzon({ buzonId: id });
      expect(r.motivo).toBe('ERROR');
      expect(r.detalle).toMatch(/interna/);
      expect(conexiones).toHaveLength(0);
    } finally { resolutor.lookup = antes; }
  });
});

describe('la Bandeja con varios buzones', () => {
  it('«Traer del buzón» lee los dos de la base y ya no el del .env', async () => {
    const r = await request.post('/api/correos/sincronizar').set(como(SUPER)).send({});
    expect(r.status).toBe(200);
    const mios = r.body.data.buzones.filter((b) => b.direccion?.endsWith(dom));
    expect(mios.map((b) => b.direccion).sort()).toEqual([FACT, SOP]);
    expect(mios.find((b) => b.direccion === FACT).nuevos).toBe(3);
    expect(mios.find((b) => b.direccion === SOP).nuevos).toBe(2);
    expect(r.body.data.buzones.some((b) => b.direccion === ENV)).toBe(false);
  });

  it('releer no duplica nada', async () => {
    const r = await request.post('/api/correos/sincronizar').set(como(SUPER)).send({});
    expect(r.body.data.nuevos).toBe(0);
  });

  it('todos juntos, cada uno con su buzón; el que llegó a los dos sale en los dos', async () => {
    const r = await request.get('/api/correos').query({ direccion: 'entrada', busca: dom, limite: 50 }).set(como(SUPER));
    const filas = r.body.data.filas;
    const de = (n) => filas.filter((f) => f.buzon_nombre === n).map((f) => f.asunto).sort();
    expect(de('Facturación CEDIA')).toEqual(['Factura noviembre', 'Factura octubre', 'Para los dos']);
    expect(de('Soporte')).toEqual(['No puedo entrar', 'Para los dos']);
    // Los del .env siguen, sin buzón.
    expect(filas.filter((f) => f.buzon_id === null)).toHaveLength(2);
  });

  it('elegir un buzón enseña solo lo suyo, con el campus del buzón', async () => {
    const id = (await one(`SELECT id FROM correo_buzones WHERE direccion = $1 AND activo`, [SOP])).id;
    const r = await request.get('/api/correos').query({ buzon: id }).set(como(SUPER));
    expect(r.body.data.total).toBe(2);
    expect(r.body.data.filas.every((f) => f.buzon_id === id && f.project_id === MIO)).toBe(true);
  });

  it('«servidor» es lo que entró por el del .env', async () => {
    const r = await request.get('/api/correos').query({ buzon: 'servidor', busca: dom }).set(como(SUPER));
    expect(r.body.data.filas.map((f) => f.asunto).sort()).toEqual(['Del buzón de siempre', 'Otro del de siempre']);
  });
});

describe('pasar al panel el buzón que se leía por el .env', () => {
  it('sus correos se adoptan, no se duplican', async () => {
    const r = await conectar(SUPER, { nombre: 'El de siempre', direccion: ENV, clave: CLAVE_BUENA, project_id: MIO });
    expect(r.status).toBe(201);
    const s = await request.post('/api/correos/sincronizar').set(como(SUPER)).send({ buzonId: r.body.data.id });
    expect(s.body.data.nuevos).toBe(0);
    const filas = await q(`SELECT buzon_id, clave FROM email_envios WHERE clave LIKE $1`, [`%<e_@${dom}>`]);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.buzon_id === r.body.data.id)).toBe(true);
    expect(filas.every((f) => f.clave.startsWith(`entrada:${ENV}:`))).toBe(true);
  });
});

describe('quién puede', () => {
  it('la gestora no ve los buzones ni conecta ninguno', async () => {
    expect((await request.get('/api/correos/buzones').set(como(GESTORA))).status).toBe(403);
    expect((await conectar(GESTORA, { nombre: 'x', direccion: `g@${dom}`, clave: 'x', project_id: MIO })).status).toBe(403);
  });

  it('el project manager los ve pero no los toca', async () => {
    expect((await request.get('/api/correos/buzones').set(como(PM))).status).toBe(200);
    expect((await conectar(PM, { nombre: 'x', direccion: `pm@${dom}`, clave: 'x', project_id: MIO })).status).toBe(403);
  });

  it('un admin conecta en SU campus, no en otro ni sin campus', async () => {
    expect((await conectar(ADMIN, { nombre: 'x', direccion: `a1@${dom}`, clave: 'x', project_id: AJENO })).status).toBe(403);
    expect((await conectar(ADMIN, { nombre: 'x', direccion: `a2@${dom}`, clave: 'x' })).status).toBe(400);
    expect((await conectar(ADMIN, { nombre: 'Admisiones', direccion: `a3@${dom}`, clave: 'x', project_id: MIO })).status).toBe(201);
  });

  it('el de otro campus, para un admin, no existe', async () => {
    const ajeno = await conectar(SUPER, { nombre: 'Ajeno', direccion: `ajeno@${dom}`, clave: 'x', project_id: AJENO });
    const lista = await request.get('/api/correos/buzones').set(como(ADMIN));
    expect(lista.body.data.some((b) => b.id === ajeno.body.data.id)).toBe(false);
    expect((await request.patch(`/api/correos/buzones/${ajeno.body.data.id}`).set(como(ADMIN)).send({ nombre: 'mío' })).status).toBe(404);
    expect((await request.delete(`/api/correos/buzones/${ajeno.body.data.id}`).set(como(ADMIN))).status).toBe(404);
    expect((await request.post('/api/correos/sincronizar').set(como(ADMIN)).send({ buzonId: ajeno.body.data.id })).status).toBe(404);
  });
});

describe('cambiar y quitar', () => {
  it('cambiar el nombre no toca la conexión; cambiar la contraseña, sí', async () => {
    const f = await one(`SELECT id, cifrado FROM correo_buzones WHERE direccion = $1 AND activo`, [SOP]);
    await request.patch(`/api/correos/buzones/${f.id}`).set(como(SUPER)).send({ nombre: 'Soporte ISEIH' });
    expect((await one('SELECT cifrado FROM correo_buzones WHERE id = $1', [f.id])).cifrado).toBe(f.cifrado);
    const r = await request.patch(`/api/correos/buzones/${f.id}`).set(como(SUPER)).send({ clave: 'Otra-Clave' });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('Otra-Clave');
    const d = descifrarConexion(await one('SELECT * FROM correo_buzones WHERE id = $1', [f.id]));
    expect(d).toMatchObject({ usuario: SOP, clave: 'Otra-Clave', host: 'imap.hostinger.com' });
  });

  it('quitarlo no borra sus correos y deja volver a conectarlo', async () => {
    const f = await one(`SELECT id FROM correo_buzones WHERE direccion = $1 AND activo`, [SOP]);
    expect((await request.delete(`/api/correos/buzones/${f.id}`).set(como(SUPER))).status).toBe(200);
    const lista = await request.get('/api/correos/buzones').set(como(SUPER));
    expect(lista.body.data.some((b) => b.id === f.id)).toBe(false);
    // Un buzón quitado no guarda su contraseña, ni cifrada.
    expect((await one('SELECT cifrado, iv, auth_tag FROM correo_buzones WHERE id = $1', [f.id])))
      .toEqual({ cifrado: '', iv: '', auth_tag: '' });
    const r = await request.get('/api/correos').query({ buzon: f.id }).set(como(SUPER));
    expect(r.body.data.total).toBe(2);
    expect((await conectar(SUPER, { nombre: 'Soporte', direccion: SOP, clave: CLAVE_BUENA, project_id: MIO })).status).toBe(201);
  });
});

describe('el buzón de facturación de una empresa sin correo', () => {
  it('se ofrece como su correo de facturación, y se pone solo si sigue vacío', async () => {
    const r = await conectar(ADMIN, {
      nombre: 'Facturación empresa', direccion: `fact-empresa@${dom}`, clave: 'x',
      project_id: MIO, empresa_id: EMPRESA_SIN_CORREO,
    });
    expect(r.status).toBe(201);
    expect(r.body.ofrecerCorreoEmpresa).toMatchObject({ empresaId: EMPRESA_SIN_CORREO, direccion: `fact-empresa@${dom}` });

    const usar = await request.post(`/api/correos/buzones/${r.body.data.id}/correo-de-empresa`).set(como(ADMIN));
    expect(usar.body.data.email).toBe(`fact-empresa@${dom}`);
    expect((await one('SELECT email FROM invoice_issuers WHERE id = $1', [EMPRESA_SIN_CORREO])).email).toBe(`fact-empresa@${dom}`);

    // Ya tiene: no se pisa.
    const otra = await request.post(`/api/correos/buzones/${r.body.data.id}/correo-de-empresa`).set(como(ADMIN));
    expect(otra.body.motivo).toBe('YA_TIENE_CORREO');
  });

  it('si la empresa ya tiene correo, ni se ofrece ni se cambia', async () => {
    const r = await conectar(ADMIN, {
      nombre: 'Facturación otra', direccion: `fact-otra@${dom}`, clave: 'x',
      project_id: MIO, empresa_id: EMPRESA_CON_CORREO,
    });
    expect(r.body.ofrecerCorreoEmpresa).toBeNull();
    await request.post(`/api/correos/buzones/${r.body.data.id}/correo-de-empresa`).set(como(ADMIN));
    expect((await one('SELECT email FROM invoice_issuers WHERE id = $1', [EMPRESA_CON_CORREO])).email).toBe(`ya@${dom}`);
  });
});

describe('en ISEIE la Bandeja es solo de lo recibido', () => {
  it('lo que sale (Brevo) no aparece en la lista, ni se abre, ni cuenta', async () => {
    const salida = await one(
      `INSERT INTO email_envios (clave, destinatarios, asunto, estado, cuerpo_html)
       VALUES ($1, $2, 'Aviso que salió por Brevo', 'enviado', '<p>secreto</p>') RETURNING id`,
      [`salida:<s1@${dom}>`, `alguien@${dom}`]);
    const lista = await request.get('/api/correos').query({ busca: dom, limite: 200 }).set(como(SUPER));
    expect(lista.status).toBe(200);
    expect(lista.body.data.filas.length).toBeGreaterThan(0);
    expect(lista.body.data.filas.every((f) => f.direccion === 'entrada')).toBe(true);
    expect(lista.body.data.filas.some((f) => f.id === salida.id)).toBe(false);
    expect((await request.get(`/api/correos/${salida.id}`).set(como(SUPER))).status).toBe(404);
    const rec = await request.get('/api/correos/recuento').set(como(SUPER));
    expect(Object.keys(rec.body.data)).toEqual(['recibido']);
  });

  it('un correo recibido se abre con su texto; uno de otro campus, para un admin, no existe', async () => {
    const mio = await one(`SELECT id FROM email_envios WHERE direccion = 'entrada' AND project_id = $1 AND clave LIKE $2 LIMIT 1`, [MIO, `%@${dom}>`]);
    const r = await request.get(`/api/correos/${mio.id}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.cuerpo_html).toContain('os mando la factura');
    const ajeno = await one(
      `INSERT INTO email_envios (clave, direccion, remitente, destinatarios, asunto, estado, project_id, cuerpo_html)
       VALUES ($1, 'entrada', $2, $4, 'De otro campus', 'recibido', $3, '<p>x</p>') RETURNING id`,
      [`entrada:<ajeno@${dom}>`, `otro@${dom}`, AJENO, `buzon@${dom}`]);
    expect((await request.get(`/api/correos/${ajeno.id}`).set(como(ADMIN))).status).toBe(404);
    const lista = await request.get('/api/correos').query({ busca: dom, limite: 200 }).set(como(ADMIN));
    expect(lista.body.data.filas.some((f) => f.id === ajeno.id)).toBe(false);
  });

  it('un id que no es un número es un 404, no un error de la base', async () => {
    expect((await request.get('/api/correos/abc').set(como(SUPER))).status).toBe(404);
    expect((await request.patch('/api/correos/buzones/abc').set(como(SUPER)).send({ nombre: 'x' })).status).toBe(404);
  });
});

// Diego (CRM#1058): «cuando se adopta deja de leerse para que no salga
// duplicado». El mismo arreglo que el 360 en CRM#1058.
describe('el buzón del .env ya adoptado (CRM#1058)', () => {
  it('no se vuelve a leer, ni aunque se quite del panel', async () => {
    vi.stubEnv('IMAP_USER', ENV); vi.stubEnv('IMAP_PASSWORD', CLAVE_BUENA);
    const adoptado = await one(`SELECT id FROM correo_buzones WHERE direccion = $1 AND activo`, [ENV]);
    expect((await request.delete(`/api/correos/buzones/${adoptado.id}`).set(como(SUPER))).status).toBe(200);
    // Ninguno activo en la base: lo que antes hacía volver a leer el del .env,
    // con la clave sin buzón, y guardar sus correos otra vez.
    await q(`UPDATE correo_buzones SET activo = false WHERE activo AND direccion LIKE $1`, [`%@${dom}`]);
    conexiones.length = 0;
    const r = await leerBuzon();
    expect(r.motivo).toBe('SIN_BUZON');
    expect(conexiones).toHaveLength(0);
    // Sus dos correos, una vez y con el buzón al que se adoptaron.
    const filas = await q(`SELECT buzon_id FROM email_envios WHERE clave LIKE $1`, [`%<e_@${dom}>`]);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.buzon_id === adoptado.id)).toBe(true);
  });

  it('un .env que nunca se conectó en el panel sí se lee si no hay ninguno en la base', async () => {
    const NUEVO = `nuevo@${dom}`;
    BUZONES_FALSOS[NUEVO] = [crudo('n1', NUEVO, 'Del nuevo')];
    vi.stubEnv('IMAP_USER', NUEVO); vi.stubEnv('IMAP_PASSWORD', CLAVE_BUENA);
    conexiones.length = 0;
    const r = await leerBuzon();
    expect(r.nuevos).toBe(1);
    expect(conexiones.map((c) => c.auth.user)).toEqual([NUEVO]);
  });
});
