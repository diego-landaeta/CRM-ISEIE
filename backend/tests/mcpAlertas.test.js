import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Auditoría visible y alertas del MCP (#195), contra la base de verdad.
 *
 *   · Conexión → MCP → Actividad: super admin todo; admin, solo sus empresas;
 *     filtros por persona, conexión, fechas, consulta y resultado.
 *   · Alertas por correo: ráfagas, red o cliente nuevos, fallos de
 *     desbloqueo y madrugada; sin repetir.
 *   · La auditoría se guarda 12 meses.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/mcpAlertas.test.js
 */

const correos = vi.hoisted(() => ({ sendMcpAlertasEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { revisar, limpiarAuditoria, red, familia } = await import('../src/modules/mcp/mcp.alertas.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MCPALE${Date.now().toString(36)}`;
const ids = { users: [], projects: [], issuers: [] };
const P = {};
const U = {};

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });

async function persona(clave, role, campus) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, usa_mcp) VALUES ($1, $2, 'x', $3, true) RETURNING id, role, email`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, P[c]]);
  U[clave] = u;
  return u;
}

/** Una fila de auditoría a mano, con fecha, red y cliente a gusto. */
const auditar = (u, { herramienta = 'buscar_prospectos', ok = true, ip = '160.79.106.10', cliente = 'Claude-User', cuando = 'NOW()', parametros = null } = {}) => q(
  `INSERT INTO mcp_auditoria (user_id, herramienta, parametros, ok, error, duracion_ms, ip, cliente, created_at)
   VALUES ($1, $2, $3, $4, $5, 12, $6, $7, ${cuando}) RETURNING id`,
  [u.id, herramienta, parametros ? JSON.stringify(parametros) : null, ok, ok ? null : 'rechazada', ip, cliente]
);

/** Todo lo de antes ya está revisado: así cada prueba de alertas mira solo lo suyo. */
const marcarRevisado = () => q(`UPDATE mcp_vigilancia SET ultimo_auditoria_id = (SELECT COALESCE(MAX(id), 0) FROM mcp_auditoria) WHERE id = 1`);

const alertasDe = () => correos.sendMcpAlertasEmail.mock.calls.flatMap(([a]) => a.alertas)
  .filter((a) => ids.users.includes(a.userId));

beforeAll(async () => {
  for (const [clave, nombre] of [['UNO', 'Empresa uno'], ['DOS', 'Empresa dos']]) {
    const [s] = await q(`INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id`, [`${MARCA} ${nombre}`, `${MARCA}-${clave}`]);
    ids.issuers.push(s.id);
    P[`S_${clave}`] = s.id;
  }
  for (const [c, s] of [['A', 'UNO'], ['B', 'UNO'], ['C', 'DOS']]) {
    const [p] = await q(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, P[`S_${s}`]]
    );
    ids.projects.push(p.id);
    P[c] = p.id;
  }
  // Ana: admin del campus A (empresa UNO). Gema: campus B, MISMA empresa.
  // Clara: campus C, OTRA empresa. Super: lo ve todo.
  await persona('ANA', 'admin', ['A']);
  await persona('GEMA', 'gestor', ['B']);
  await persona('CLARA', 'gestor', ['C']);
  await persona('SUPER', 'superadmin', []);
  await persona('GUS', 'gestor', ['A']);
  for (const u of [U.ANA, U.GEMA, U.CLARA]) await auditar(u, { parametros: { texto: `de ${u.email}` } });
  await auditar(U.GEMA, { herramienta: 'listar_ventas', ok: false, cuando: `NOW() - INTERVAL '3 days'` });
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM mcp_alertas WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM invoice_issuers WHERE id = ANY($1::int[])`, [ids.issuers]);
  await pool.end();
}, 60000);

beforeEach(() => {
  correos.sendMcpAlertasEmail.mockClear();
  for (const k of ['MCP_ALERTAS', 'MCP_ALERTA_RAFAGA_CONSULTAS', 'MCP_ALERTA_MADRUGADA', 'MCP_AVISO_EMAIL']) delete process.env[k];
  process.env.MCP_AVISO_EMAIL = 'diego@vigila.test';
  // Las pruebas no quieren la franja de madrugada salvo la suya: si se corren
  // de noche, cualquier consulta la dispararía.
  process.env.MCP_ALERTA_MADRUGADA = '';
});

const actividad = (u, filtros = '') => request.get(`/api/mcp/panel/actividad${filtros}`).set('Authorization', `Bearer ${jwtDe(u)}`);
const personasEn = (r) => [...new Set(r.body.data.filas.map((f) => f.user_id).filter((id) => ids.users.includes(id)))]
  .map((id) => Object.keys(U).find((k) => U[k].id === id)).sort();

// ─── Actividad ────────────────────────────────────────────────────────────

describe('Conexión → MCP → Actividad', () => {
  it('el super admin lo ve todo', async () => {
    const r = await actividad(U.SUPER, '?limite=100');
    expect(r.status).toBe(200);
    expect(personasEn(r)).toEqual(['ANA', 'CLARA', 'GEMA']);
  });

  it('un admin solo lo de sus empresas: Gema (otro campus, misma empresa) sí; Clara (otra empresa) no', async () => {
    const r = await actividad(U.ANA, '?limite=100');
    expect(personasEn(r)).toEqual(['ANA', 'GEMA']);
    expect(r.body.data.opciones.personas.map((p) => p.id)).not.toContain(U.CLARA.id);
  });

  it('una gestora no puede verla', async () => {
    expect((await actividad(U.GEMA)).status).toBe(403);
  });

  it('enseña quién, qué, cuándo, con qué herramienta, resultado y desde dónde', async () => {
    const r = await actividad(U.SUPER, `?persona=${U.ANA.id}`);
    const f = r.body.data.filas[0];
    expect(f).toMatchObject({ persona: `${MARCA} ANA`, herramienta: 'buscar_prospectos', ok: true, ip: '160.79.106.10', cliente: 'Claude-User' });
    expect(f.parametros).toEqual({ texto: `de ${U.ANA.email}` });
    expect(f.created_at).toBeTruthy();
  });

  it('filtros: persona, resultado, consulta y fechas', async () => {
    const soloGema = await actividad(U.SUPER, `?persona=${U.GEMA.id}`);
    expect(soloGema.body.data.filas.every((f) => f.user_id === U.GEMA.id)).toBe(true);

    const errores = await actividad(U.SUPER, `?persona=${U.GEMA.id}&resultado=error`);
    expect(errores.body.data.filas.map((f) => f.herramienta)).toEqual(['listar_ventas']);

    const ventas = await actividad(U.SUPER, `?persona=${U.GEMA.id}&herramienta=listar_ventas`);
    expect(ventas.body.data.total).toBe(1);

    const hoy = new Date().toISOString().slice(0, 10);
    const deHoy = await actividad(U.SUPER, `?persona=${U.GEMA.id}&desde=${hoy}`);
    expect(deHoy.body.data.filas.map((f) => f.herramienta)).toEqual(['buscar_prospectos']);
  });

  it('una consulta real por el MCP queda con su IP y su cliente', async () => {
    const t = await request.post('/api/mcp/panel/tokens').set('Authorization', `Bearer ${jwtDe(U.GUS)}`).send({ nombre: 'Prueba' });
    await request.post(`/api/mcp/u/${t.body.data.token}`)
      .set('Accept', 'application/json, text/event-stream').set('User-Agent', 'claude-code/9.9').set('X-Forwarded-For', '198.51.100.4')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mis_proyectos', arguments: {} } });
    await vi.waitFor(async () => {
      const [f] = await q(`SELECT ip, cliente, token_id FROM mcp_auditoria WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [U.GUS.id]);
      expect(f).toMatchObject({ ip: '198.51.100.4', cliente: 'claude-code/9.9' });
    });
    const r = await actividad(U.ANA, `?persona=${U.GUS.id}&conexion=personal`);
    expect(r.body.data.filas[0]).toMatchObject({ url_nombre: 'Prueba', herramienta: 'mis_proyectos' });
  });
});

// ─── Alertas ──────────────────────────────────────────────────────────────

describe('alertas', () => {
  it('red y familia: se compara la red /24 y el programa, no la IP ni la versión', () => {
    expect(red('160.79.106.175')).toBe('160.79.106.*');
    expect(red('160.79.106.164')).toBe(red('160.79.106.175'));
    expect(familia('claude-code/2.1.288 (claude-vscode, agent-sdk)')).toBe('claude-code');
    expect(familia('Claude-User')).toBe('claude-user');
  });

  it('ráfaga: más de N consultas en M minutos', async () => {
    await marcarRevisado();
    process.env.MCP_ALERTA_RAFAGA_CONSULTAS = '20';
    for (let i = 0; i < 21; i++) await auditar(U.GEMA);
    await revisar();
    const a = alertasDe().filter((x) => x.tipo === 'rafaga');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ userId: U.GEMA.id, detalle: expect.objectContaining({ consultas: expect.any(Number) }) });
    expect(correos.sendMcpAlertasEmail.mock.calls[0][0].para).toEqual([{ email: 'diego@vigila.test' }]);
  });

  it('…y no se repite mientras dura', async () => {
    await marcarRevisado();
    process.env.MCP_ALERTA_RAFAGA_CONSULTAS = '20';
    for (let i = 0; i < 5; i++) await auditar(U.GEMA);
    await revisar();
    expect(alertasDe().filter((x) => x.tipo === 'rafaga')).toHaveLength(0);
  });

  it('red nueva y cliente nuevo; otra IP de la MISMA red no avisa', async () => {
    await marcarRevisado();
    await auditar(U.ANA, { ip: '160.79.106.99' });                           // misma red: nada
    await auditar(U.ANA, { ip: '203.0.113.5' });                             // red nueva
    await auditar(U.ANA, { cliente: 'claude-code/2.1.300' });                // programa nuevo
    await revisar();
    const a = alertasDe().filter((x) => x.userId === U.ANA.id);
    expect(a.map((x) => x.tipo).sort()).toEqual(['cliente_nuevo', 'ip_nueva']);
    expect(a.find((x) => x.tipo === 'ip_nueva').detalle.red).toBe('203.0.113.*');
  });

  it('tras desplegar: el historial SIN IP ni cliente (de antes de la 191) no hace que todo parezca nuevo', async () => {
    const [antiguo] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
      [`${MARCA} ANTIGUO`, `antiguo@${MARCA.toLowerCase()}.test`]
    );
    ids.users.push(antiguo.id);
    await auditar({ id: antiguo.id }, { ip: null, cliente: null });          // como antes de la 191
    await marcarRevisado();
    await auditar({ id: antiguo.id }, { ip: '160.79.106.20', cliente: 'Claude-User' });
    await revisar();
    expect(alertasDe().filter((x) => x.userId === antiguo.id)).toHaveLength(0);
  });

  it('la primera vez de alguien no es «nueva»: no tiene con qué compararse', async () => {
    const [nuevo] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
      [`${MARCA} NUEVO`, `nuevo@${MARCA.toLowerCase()}.test`]
    );
    ids.users.push(nuevo.id);
    await marcarRevisado();
    await auditar({ id: nuevo.id }, { ip: '192.0.2.1', cliente: 'otra-cosa/1' });
    await revisar();
    expect(alertasDe().filter((x) => x.userId === nuevo.id)).toHaveLength(0);
  });

  it('fallos del código de desbloqueo', async () => {
    await marcarRevisado();
    for (let i = 0; i < 3; i++) await auditar(U.CLARA, { herramienta: 'desbloquear', ok: false });
    await revisar();
    const a = alertasDe().filter((x) => x.tipo === 'fallos_desbloqueo');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ userId: U.CLARA.id, detalle: expect.objectContaining({ fallos: 3 }) });
  });

  it('madrugada: una alerta por persona y noche', async () => {
    process.env.MCP_ALERTA_MADRUGADA = '0-6';
    await marcarRevisado();
    const tz = process.env.APP_TIMEZONE || 'Europe/Madrid';
    const las3 = `(date_trunc('day', NOW() AT TIME ZONE '${tz}') + INTERVAL '3 hours') AT TIME ZONE '${tz}'`;
    await auditar(U.GEMA, { cuando: las3 });
    await auditar(U.GEMA, { cuando: `${las3} + INTERVAL '20 minutes'` });
    await revisar();
    const a = alertasDe().filter((x) => x.tipo === 'madrugada' && x.userId === U.GEMA.id);
    expect(a).toHaveLength(1);
    expect(a[0].detalle.consultas).toBe(2);

    correos.sendMcpAlertasEmail.mockClear();
    await marcarRevisado();
    await auditar(U.GEMA, { cuando: `${las3} + INTERVAL '40 minutes'` });
    await revisar();
    expect(alertasDe().filter((x) => x.tipo === 'madrugada' && x.userId === U.GEMA.id)).toHaveLength(0);
  });

  it('madrugada que cruza la medianoche («22-6»): las 23 h y las 3 h cuentan, las 12 h no', async () => {
    process.env.MCP_ALERTA_MADRUGADA = '22-6';
    const tz = process.env.APP_TIMEZONE || 'Europe/Madrid';
    const hora = (h) => `(date_trunc('day', NOW() AT TIME ZONE '${tz}') - INTERVAL '2 days' + INTERVAL '${h} hours') AT TIME ZONE '${tz}'`;
    const [nocturno] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
      [`${MARCA} NOCTURNO`, `nocturno@${MARCA.toLowerCase()}.test`]
    );
    ids.users.push(nocturno.id);
    await marcarRevisado();
    await auditar({ id: nocturno.id }, { cuando: hora(23) });
    await auditar({ id: nocturno.id }, { cuando: hora(12) });
    await revisar();
    const a = alertasDe().filter((x) => x.tipo === 'madrugada' && x.userId === nocturno.id);
    expect(a).toHaveLength(1);
    expect(a[0].detalle.consultas).toBe(1);   // la de las 23 h; la de las 12 h no
  });

  it('con MCP_ALERTAS=false no avisa, pero la marca avanza', async () => {
    process.env.MCP_ALERTAS = 'false';
    await marcarRevisado();
    const mias = [];
    for (const ip of ['198.18.0.1', '198.18.1.1']) mias.push((await auditar(U.ANA, { ip }))[0].id);
    const r = await revisar();
    expect(r.alertas).toBe(0);
    expect(correos.sendMcpAlertasEmail).not.toHaveBeenCalled();
    // Las otras pruebas escriben en la misma base a la vez: se mira que la
    // marca haya pasado por encima de LAS NUESTRAS, no que sea el máximo.
    const [{ ultimo_auditoria_id: marca }] = await q(`SELECT ultimo_auditoria_id FROM mcp_vigilancia`);
    expect(Number(marca)).toBeGreaterThanOrEqual(Math.max(...mias.map(Number)));
  });
});

// ─── Cuánto se guarda ─────────────────────────────────────────────────────

describe('la auditoría se guarda 12 meses', () => {
  it('borra lo de hace más de 12 meses y deja lo reciente', async () => {
    const [vieja] = await auditar(U.ANA, { cuando: `NOW() - INTERVAL '13 months'` });
    const [nueva] = await auditar(U.ANA, { cuando: `NOW() - INTERVAL '11 months'` });
    await limpiarAuditoria();
    expect(await q(`SELECT id FROM mcp_auditoria WHERE id = $1`, [vieja.id])).toHaveLength(0);
    expect(await q(`SELECT id FROM mcp_auditoria WHERE id = $1`, [nueva.id])).toHaveLength(1);
  });
});
