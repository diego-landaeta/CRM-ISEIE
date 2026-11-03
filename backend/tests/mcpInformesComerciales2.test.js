import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Lo que faltaba del CRM en el MCP, parte 2 (#325), contra la base de verdad.
 *
 * Matrículas, catálogo completo, correos, WhatsApp, solicitudes y avisos,
 * nóminas, clientes y la columna META de «Cursos sin tutor». Se comprueba lo que
 * un test con la base grabada no puede: que el SQL funciona, que las cifras son
 * las del campus pedido y no las de otro, que una gestora no ve lo de
 * administración ni lo de otra gestora, y que no sale ningún dato personal (ni
 * un correo, ni un teléfono, ni el texto de un mensaje).
 *
 *   npx vitest run tests/mcpInformesComerciales2.test.js
 *
 * La base es compartida: todo lo que se crea lleva una marca única y se borra al
 * final. Los usuarios son admin y gestoras, nunca super admin.
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { HERRAMIENTAS, INFORMES } = await import('../src/modules/mcp/mcp.tools.js');
const { construirAmbito } = await import('../src/modules/mcp/mcp.acceso.js');
const { protegerDatos } = await import('../src/modules/mcp/mcp.privacidad.js');
const { diasDesdeHoy, hoyLocal } = await import('../src/modules/mcp/mcp.model.js');
const matriculaModel = await import('../src/modules/matriculas/matricula.model.js');
const leadModel = await import('../src/modules/leads/lead.model.js');

const MARCA = `MC2${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [], products: [] };
let P; let OTRO; let ADMIN; let LAURA; let ANA;
let MARTA; let PEDRO; let LEAD_OTRO; let V1; let V2; let V3;
const informe = HERRAMIENTAS.find((h) => h.nombre === 'informe');
const herr = (n) => HERRAMIENTAS.find((h) => h.nombre === n);

const ambito = (u, campus) => construirAmbito(
  { id: u.id, nombre: u.nombre, role: u.role, active: true, usa_mcp: true },
  campus.map((c) => ({ id: c, nombre: `c${c}`, sociedad_id: null, sociedad_nombre: null }))
);
const ver = (u, tipo, extra = {}, campus = [P]) => informe.ejecutar(ambito(u, campus), { tipo, ...extra });
const correr = (n, u, args = {}, campus = [P]) => herr(n).ejecutar(ambito(u, campus), args);
/** Lo que vería Claude de verdad: con la privacidad aplicada. */
const comoClaude = (datos) => JSON.stringify(protegerDatos(datos));

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  return u;
}
async function lead(nombre, { responsable, proyecto = P, email = null, telefono = null }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, responsable_id, email, telefono) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, responsable, email, telefono]
  );
  ids.leads.push(l.id);
  return l.id;
}
async function venta(leadId, proyecto, producto, total, pagado, vendedora, productoId = null) {
  const [c] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion, producto_contratado_id)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7) RETURNING id`,
    [leadId, proyecto, producto, total, pagado, vendedora, productoId]
  );
  ids.conversions.push(c.id);
  if (Number(pagado) > 0) await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, CURRENT_DATE)`, [c.id, pagado]);
  return c.id;
}

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  ADMIN = await persona('ADMIN', 'admin');
  LAURA = await persona('LAURA', 'gestor');
  ANA = await persona('ANA', 'gestor');

  MARTA = await lead('Marta Ruiz', { responsable: LAURA.id, email: `marta@${MARCA.toLowerCase()}.test`, telefono: '600111222' });
  PEDRO = await lead('Pedro Gil', { responsable: ANA.id, email: `pedro@${MARCA.toLowerCase()}.test`, telefono: '600333444' });
  LEAD_OTRO = await lead('Lucia Mora', { responsable: LAURA.id, proyecto: OTRO });

  V1 = await venta(MARTA, P, 'Máster en Coaching', 1000, 400, LAURA.id);
  V2 = await venta(PEDRO, P, 'Curso de Nutrición', 600, 600, ANA.id);
  V3 = await venta(LEAD_OTRO, OTRO, 'Máster en Coaching', 777, 777, LAURA.id);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM wa_conversaciones WHERE instancia LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM email_envios WHERE asunto LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM email_sequences WHERE nombre LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM admin_notifications WHERE title LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM avisos_apagados WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM change_requests WHERE titulo LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM work_hours WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM payroll_periods WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM payroll_plans WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM matriculas WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM tutor_busquedas WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM meta_campaigns WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM wc_import_runs WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM products WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM product_categories WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

const NUEVOS = ['matriculas', 'catalogo_completo', 'correos', 'whatsapp', 'solicitudes_y_avisos', 'nominas'];
const SOLO_ADMIN = ['catalogo_completo', 'correos', 'nominas'];

describe('están, con su descripción, entre los informes de Claude', () => {
  it('cada una figura en el listado de la herramienta «informe»', () => {
    for (const n of NUEVOS) {
      expect(Object.keys(INFORMES)).toContain(n);
      expect(informe.descripcion).toContain(n);
      expect(INFORMES[n].descripcion.length).toBeGreaterThan(40);
    }
  });

  it('lo de administración y dinero va marcado como tal; lo comercial, no', () => {
    for (const n of NUEVOS) expect(INFORMES[n].soloAdmin === true, n).toBe(SOLO_ADMIN.includes(n));
  });

  it('«clientes» es una herramienta propia, de solo lectura', () => {
    expect(herr('clientes')).toBeTruthy();
    expect(herr('clientes').nombre).not.toMatch(/crear|editar|cambiar|borrar|eliminar|actualizar|enviar|marcar/);
  });
});

describe('lo de administración se le niega a una gestora', () => {
  it('catalogo_completo, correos y nominas: MCP_INFORME_SOLO_ADMIN', async () => {
    for (const n of SOLO_ADMIN) {
      await expect(ver(LAURA, n), n).rejects.toMatchObject({ code: 'MCP_INFORME_SOLO_ADMIN' });
    }
  });

  it('un campus ajeno no se puede ni pedir', async () => {
    for (const n of NUEVOS) {
      await expect(ver(ADMIN, n, { proyecto_id: OTRO }), n).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
    }
    await expect(correr('clientes', ADMIN, { proyecto_id: OTRO, pagina: 1, limite: 25 })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
  });
});

// ─── Matrículas ───────────────────────────────────────────────────────────

describe('matriculas: altas por producto, estado y campus', () => {
  beforeAll(async () => {
    await q(`INSERT INTO matriculas (project_id, conversion_id, lead_id, estado) VALUES ($1, $2, $3, 'validada'), ($1, $4, $5, 'pendiente'), ($6, $7, $8, 'rechazada')`,
      [P, V1, MARTA, V2, PEDRO, OTRO, V3, LEAD_OTRO]);
    // Una creada a mano, sin venta ni prospecto.
    await q(`INSERT INTO matriculas (project_id, estado) VALUES ($1, 'solicitud_admision')`, [P]);
  });

  it('las cifras son las del campus pedido y los cuatro números de la pantalla (getStats) cuadran', async () => {
    const { datos } = await ver(ADMIN, 'matriculas');
    expect(datos).toMatchObject({ total: 3, validadas: 1, pendientes: 1, rechazadas: 0, solicitudes_de_admision: 1 });
    const pantalla = await matriculaModel.getStats({ projectId: P });
    expect([datos.total, datos.pendientes, datos.validadas, datos.rechazadas])
      .toEqual([Number(pantalla.total), Number(pantalla.pendientes), Number(pantalla.validadas), Number(pantalla.rechazadas)]);
    // La rechazada del otro campus no entra.
    expect(datos.por_campus).toEqual([expect.objectContaining({ campus: `${MARCA} a`, matriculas: 3 })]);
  });

  it('por producto: el de la venta, y «Sin producto» para la manual', async () => {
    const { datos } = await ver(ADMIN, 'matriculas');
    const por = Object.fromEntries(datos.por_producto.map((p) => [p.producto, p.matriculas]));
    expect(por).toEqual({ 'Máster en Coaching': 1, 'Curso de Nutrición': 1, 'Sin producto': 1 });
    expect(datos.por_producto.find((p) => p.producto === 'Máster en Coaching')).toMatchObject({ validadas: 1, pendientes: 0 });
    expect(datos.por_mes).toHaveLength(1);
  });

  it('el rango de fechas filtra por el alta', async () => {
    expect((await ver(ADMIN, 'matriculas', { desde: '2099-01-01' })).datos.total).toBe(0);
    expect((await ver(ADMIN, 'matriculas', { desde: '2020-01-01', hasta: '2099-01-01' })).datos.total).toBe(3);
  });

  it('una gestora solo cuenta las matrículas de SUS ventas', async () => {
    expect((await ver(LAURA, 'matriculas')).datos).toMatchObject({ total: 1, validadas: 1 });
    expect((await ver(ANA, 'matriculas')).datos).toMatchObject({ total: 1, pendientes: 1, validadas: 0 });
  });

  it('no sale ningún dato personal', async () => {
    const { datos } = await ver(ADMIN, 'matriculas');
    expect(comoClaude(datos)).not.toMatch(/@|600111222/);
  });
});

// ─── Catálogo completo ────────────────────────────────────────────────────

describe('catalogo_completo: activas e inactivas, SKU, categorías e importaciones de WooCommerce', () => {
  beforeAll(async () => {
    const [raiz] = await q(`INSERT INTO product_categories (project_id, nombre) VALUES ($1, $2) RETURNING id`, [P, `${MARCA} Másteres`]);
    const [hija] = await q(`INSERT INTO product_categories (project_id, parent_id, nombre) VALUES ($1, $2, $3) RETURNING id`, [P, raiz.id, `${MARCA} Coaching`]);
    await q(`INSERT INTO products (project_id, nombre, sku, precio, active, categoria_id, subcategoria_id) VALUES
             ($1, $2, 'SKU-REP', 100, true, $5, $6),
             ($1, $3, 'SKU-REP', 0, true, NULL, NULL),
             ($1, $4, NULL, 50, false, NULL, NULL),
             ($7, $8, 'SKU-OTRO', 10, true, NULL, NULL)`,
    [P, `${MARCA} A1`, `${MARCA} A2`, `${MARCA} A3`, raiz.id, hija.id, OTRO, `${MARCA} B1`]);
    await q(`INSERT INTO wc_import_runs (project_id, status, total_fetched, total_created, total_updated, total_skipped, error_message, finished_at)
             VALUES ($1, 'completed', 10, 2, 7, 1, NULL, now()), ($1, 'failed', 0, 0, 0, 0, 'boom http://tienda.test/?consumer_key=CLAVE-SECRETA', now()),
                    ($2, 'completed', 99, 99, 0, 0, NULL, now())`, [P, OTRO]);
  });

  it('cuenta las del campus pedido, no las del otro', async () => {
    const { datos } = await ver(ADMIN, 'catalogo_completo');
    expect(datos.campus).toHaveLength(1);
    expect(datos.campus[0]).toMatchObject({
      campus: `${MARCA} a`, formaciones: 3, activas: 2, inactivas: 1, sin_sku: 1, skus_repetidos: 1, activas_sin_precio: 1, sin_categoria: 2,
    });
    expect(datos.totales).toMatchObject({ formaciones: 3, activas: 2, inactivas: 1 });
  });

  it('el árbol de categorías es el de la pantalla, con sus formaciones', async () => {
    const { datos } = await ver(ADMIN, 'catalogo_completo');
    const [raiz] = datos.campus[0].categorias;
    expect(raiz).toMatchObject({ categoria: `${MARCA} Másteres`, formaciones: 1 });
    expect(raiz.subcategorias).toEqual([expect.objectContaining({ categoria: `${MARCA} Coaching` })]);
  });

  it('el historial de importaciones, sin el texto del error (podría llevar una clave)', async () => {
    const { datos } = await ver(ADMIN, 'catalogo_completo');
    const runs = datos.campus[0].importaciones_woocommerce;
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.estado === 'failed')).toMatchObject({ con_error: true });
    expect(runs.find((r) => r.estado === 'completed')).toMatchObject({ leidos: 10, creados: 2, actualizados: 7, saltados: 1, con_error: false });
    expect(JSON.stringify(datos)).not.toMatch(/CLAVE-SECRETA|consumer_key|tienda\.test/);
  });

  it('con los dos campus salen los dos, cada uno con lo suyo', async () => {
    const { datos } = await ver(ADMIN, 'catalogo_completo', {}, [P, OTRO]);
    expect(datos.campus.map((c) => c.formaciones)).toEqual([3, 1]);
    expect(datos.campus[1].importaciones_woocommerce).toEqual([expect.objectContaining({ leidos: 99 })]);
  });
});

// ─── Correos ──────────────────────────────────────────────────────────────

describe('correos: enviados, recibidos, frenados y fallidos', () => {
  beforeAll(async () => {
    const fila = (estado, direccion, etiquetas, proyecto) => q(
      `INSERT INTO email_envios (destinatarios, asunto, etiquetas, project_id, estado, direccion, remitente)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`secreto@${MARCA.toLowerCase()}.test`, `${MARCA} asunto privado`, etiquetas, proyecto, estado, direccion, `remite@${MARCA.toLowerCase()}.test`]);
    await fila('enviado', 'salida', ['lead-assigned', 'crm'], P);
    await fila('enviado', 'salida', ['lead-assigned', 'crm'], P);
    await fila('bloqueado', 'salida', ['welcome-user', 'crm'], P);
    await fila('fallido', 'salida', ['welcome-user', 'crm'], P);
    await fila('recibido', 'entrada', null, P);
    for (let i = 0; i < 3; i += 1) await fila('enviado', 'salida', ['lead-assigned', 'crm'], OTRO);
    await fila('enviado', 'salida', ['aviso-tutor'], null);
    const [s] = await q(
      `INSERT INTO email_sequences (project_id, nombre, trigger_event, steps) VALUES ($1, $2, 'lead_created', $3::jsonb) RETURNING id`,
      [P, `${MARCA} Bienvenida`, JSON.stringify([{ delay_hours: 0, asunto: 'ASUNTO-DEL-PASO' }, { delay_hours: 24, asunto: 'OTRO' }])]);
    await q(`INSERT INTO email_sequence_runs (sequence_id, lead_id, status, last_error) VALUES ($1, $2, 'active', NULL), ($1, $3, 'completed', 'rebotó')`, [s.id, MARTA, PEDRO]);
  });

  it('las cifras son las del campus pedido (y los sin campus no se cuelan)', async () => {
    const { datos } = await ver(ADMIN, 'correos');
    expect(datos).toMatchObject({ correos: 5, enviados: 2, recibidos: 1, frenados: 1, fallidos: 1 });
    expect(datos.por_campus).toEqual([expect.objectContaining({ campus: `${MARCA} a`, correos: 5 })]);
    const doble = (await ver(ADMIN, 'correos', {}, [P, OTRO])).datos;
    expect(doble).toMatchObject({ correos: 8, enviados: 5 });
  });

  it('por tipo: la etiqueta de cada correo, sin la genérica «crm»', async () => {
    const { datos } = await ver(ADMIN, 'correos');
    const por = Object.fromEntries(datos.por_tipo.map((t) => [t.tipo, t]));
    expect(por['lead-assigned']).toMatchObject({ correos: 2, enviados: 2 });
    expect(por['welcome-user']).toMatchObject({ correos: 2, frenados: 1, fallidos: 1 });
    expect(por.crm).toBeUndefined();
  });

  it('las secuencias, con sus pasos y cómo van', async () => {
    const { datos } = await ver(ADMIN, 'correos');
    expect(datos.secuencias).toEqual([expect.objectContaining({
      secuencia: `${MARCA} Bienvenida`, disparador: 'lead_created', activa: true, pasos: 2, en_curso: 1, completadas: 1, paradas: 0, con_error: 1,
    })]);
  });

  it('el rango de fechas filtra', async () => {
    expect((await ver(ADMIN, 'correos', { desde: '2099-01-01' })).datos.correos).toBe(0);
  });

  it('ni un correo, ni un asunto, ni un paso de secuencia en la respuesta', async () => {
    const texto = comoClaude((await ver(ADMIN, 'correos', {}, [P, OTRO])).datos);
    expect(texto).not.toMatch(/@|asunto privado|ASUNTO-DEL-PASO|rebotó/);
  });
});

// ─── WhatsApp ─────────────────────────────────────────────────────────────

describe('whatsapp: solo cifras', () => {
  beforeAll(async () => {
    const conv = async (instancia, jid, telefono, leadId, proyecto) => (await q(
      `INSERT INTO wa_conversaciones (instancia, jid, telefono, lead_id, project_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [instancia, jid, telefono, leadId, proyecto]))[0].id;
    const msgs = (c, saliente, entrante, tipo = 'texto') => q(
      `INSERT INTO wa_mensajes (conversacion_id, direccion, tipo, texto, estado, ts)
       SELECT $1, d, $4, 'TEXTO-SECRETO-DEL-MENSAJE', CASE WHEN d = 'saliente' THEN 'enviado' END, now()
         FROM (SELECT 'saliente' AS d FROM generate_series(1, $2::int) UNION ALL SELECT 'entrante' FROM generate_series(1, $3::int)) x`,
      [c, saliente, entrante, tipo]);
    const deLaura = `${MARCA}-u${LAURA.id}`;
    const deAna = `${MARCA}-u${ANA.id}`;
    // Marta (de Laura): 3 enviados y 2 recibidos.
    await msgs(await conv(deLaura, `${MARCA}1@s.whatsapp.net`, '34600111222', MARTA, P), 3, 2);
    // Pedro (de Ana): 1 enviado y 4 recibidos.
    await msgs(await conv(deAna, `${MARCA}2@s.whatsapp.net`, '34600333444', PEDRO, P), 1, 4);
    // Una persona sin ficha, en la sesión de Laura: un audio enviado y otro recibido.
    await msgs(await conv(deLaura, `${MARCA}3@s.whatsapp.net`, '34600555666', null, P), 1, 1, 'audio');
    // Un grupo (no cuenta) y un prospecto de otro campus.
    await msgs(await conv(deLaura, `${MARCA}4@g.us`, '34600777888', null, P), 2, 2);
    await msgs(await conv(deLaura, `${MARCA}5@s.whatsapp.net`, '34600999000', LEAD_OTRO, OTRO), 5, 0);
  });

  it('las cifras son las del campus pedido, sin grupos', async () => {
    const { datos } = await ver(ADMIN, 'whatsapp');
    expect(datos).toMatchObject({ mensajes: 12, enviados: 5, recibidos: 7, conversaciones: 3, numeros: 3, prospectos: 2, conversaciones_sin_prospecto: 1 });
    expect(datos.por_campus).toEqual([expect.objectContaining({ campus: `${MARCA} a`, mensajes: 12 })]);
    expect(datos.por_tipo.map((t) => [t.tipo, t.mensajes])).toEqual([['texto', 10], ['audio', 2]]);
  });

  it('por gestora (la sesión) y por prospecto, con el nombre abreviado', async () => {
    const { datos } = await ver(ADMIN, 'whatsapp');
    expect(datos.por_gestora.map((g) => [g.gestora, g.mensajes])).toEqual([[`${MARCA} LAURA`, 7], [`${MARCA} ANA`, 5]]);
    expect(datos.por_prospecto.map((p) => [p.cliente, p.enviados, p.recibidos])).toEqual([[`${MARCA} Marta Ruiz`, 3, 2], [`${MARCA} Pedro Gil`, 1, 4]]);
    const visto = JSON.parse(comoClaude(datos));
    expect(visto.por_prospecto.map((p) => p.cliente)).toEqual([`${MARCA} M.`, `${MARCA} P.`]);
  });

  it('una gestora solo cuenta su sesión y sus prospectos', async () => {
    const laura = (await ver(LAURA, 'whatsapp')).datos;
    expect(laura).toMatchObject({ mensajes: 7, enviados: 4, recibidos: 3, conversaciones: 2 });
    expect(laura.por_gestora).toEqual([expect.objectContaining({ gestora: `${MARCA} LAURA` })]);
    const ana = (await ver(ANA, 'whatsapp')).datos;
    expect(ana).toMatchObject({ mensajes: 5, enviados: 1, recibidos: 4, conversaciones: 1, prospectos: 1 });
  });

  it('el rango de fechas filtra', async () => {
    expect((await ver(ADMIN, 'whatsapp', { desde: '2099-01-01' })).datos.mensajes).toBe(0);
  });

  it('ni el texto de un mensaje ni un teléfono, ni siquiera con datos_completos', async () => {
    const { datos } = await ver(ADMIN, 'whatsapp', {}, [P, OTRO]);
    for (const texto of [comoClaude(datos), JSON.stringify(datos)]) {
      expect(texto).not.toMatch(/TEXTO-SECRETO|34600111222|34600333444|34600555666|34600999000|34600777888|@/);
    }
  });
});

// ─── Solicitudes de cambio y avisos ───────────────────────────────────────

describe('solicitudes_y_avisos', () => {
  beforeAll(async () => {
    const rfc = (codigo, proyecto, solicitante, estado) => q(
      `INSERT INTO change_requests (project_id, codigo_rfc, titulo, solicitante_user_id, estado) VALUES ($1, $2, $3, $4, $5)`,
      [proyecto, codigo, `${MARCA} ${codigo}`, solicitante, estado]);
    await rfc('RFC-9001', P, LAURA.id, 'propuesto');
    await rfc('RFC-9002', P, ANA.id, 'aprobado');
    await rfc('RFC-9003', OTRO, LAURA.id, 'propuesto');
    await rfc('RFC-G-9001', null, LAURA.id, 'propuesto');
    // Avisos de Laura: dos de «prospecto asignado» (uno ya leído) y uno informativo. Y uno de Ana.
    const aviso = (tipo, para, leidoPor = []) => q(
      `INSERT INTO admin_notifications (type, title, message, target_user_ids, read_by_user_ids) VALUES ($1, $2, 'Mensaje con el nombre de un cliente', $3::int[], $4::int[])`,
      [tipo, `${MARCA} aviso`, para, leidoPor]);
    await aviso('lead_asignado', [LAURA.id]);
    await aviso('lead_asignado', [LAURA.id], [LAURA.id]);
    await aviso('lead_deleted', [LAURA.id]);
    await aviso('lead_reminder', [ANA.id]);
    await q(`INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, 'lead_reminder')`, [ANA.id]);
  });

  it('las solicitudes por estado y campus: las del campus pedido, sin las generales ni las de otro', async () => {
    const { datos } = await ver(ADMIN, 'solicitudes_y_avisos');
    expect(datos.solicitudes.total).toBe(2);
    expect(Object.fromEntries(datos.solicitudes.por_estado.map((e) => [e.estado, e.total]))).toEqual({ propuesto: 1, aprobado: 1 });
    expect(datos.solicitudes.por_campus).toEqual([expect.objectContaining({ campus: `${MARCA} a`, total: 2 })]);
    expect(datos.solicitudes.recientes.map((r) => r.codigo).sort()).toEqual(['RFC-9001', 'RFC-9002']);
    expect(datos.solicitudes.recientes.find((r) => r.codigo === 'RFC-9001')).toMatchObject({ solicitante: `${MARCA} LAURA`, estado: 'propuesto' });
  });

  it('una gestora solo ve las solicitudes que pidió ella', async () => {
    expect((await ver(LAURA, 'solicitudes_y_avisos')).datos.solicitudes.total).toBe(1);
    expect((await ver(ANA, 'solicitudes_y_avisos')).datos.solicitudes.total).toBe(1);
    expect((await ver(LAURA, 'solicitudes_y_avisos', {}, [OTRO])).datos.solicitudes.recientes.map((r) => r.codigo)).toEqual(['RFC-9003']);
  });

  it('los avisos pendientes son los de la PERSONA: separa los que piden hacer algo y no cuenta los leídos', async () => {
    const { datos } = await ver(LAURA, 'solicitudes_y_avisos');
    expect(datos.avisos_pendientes).toMatchObject({ total: 2, piden_hacer_algo: 1, solo_informan: 1 });
    expect(datos.avisos_pendientes.por_tipo.map((t) => [t.tipo, t.clase, t.pendientes]).sort())
      .toEqual([['Prospecto asignado', 'accion', 1], ['Prospecto eliminado', 'aviso', 1]]);
  });

  it('un aviso apagado en las preferencias no cuenta, y los de otra persona tampoco', async () => {
    expect((await ver(ANA, 'solicitudes_y_avisos')).datos.avisos_pendientes.total).toBe(0);
    // Un admin ve los avisos para todos los administradores y los suyos, no los dirigidos a Laura:
    // lo mismo que cuenta la campana (visibilityClause), calculado aparte.
    const [esperado] = await q(
      `SELECT COUNT(*)::int AS n FROM admin_notifications n
        WHERE (n.target_user_ids IS NULL OR $1 = ANY(n.target_user_ids))
          AND NOT ($1 = ANY(n.read_by_user_ids))
          AND NOT EXISTS (SELECT 1 FROM avisos_apagados a WHERE a.user_id = $1 AND a.aviso = n.type)`, [ADMIN.id]);
    expect((await ver(ADMIN, 'solicitudes_y_avisos')).datos.avisos_pendientes.total).toBe(esperado.n);
  });

  it('de los avisos solo salen cifras: ni título ni mensaje', async () => {
    const { datos } = await ver(LAURA, 'solicitudes_y_avisos');
    expect(JSON.stringify(datos.avisos_pendientes)).not.toMatch(new RegExp(`nombre de un cliente|${MARCA}`));
  });
});

// ─── Nóminas ──────────────────────────────────────────────────────────────

describe('nominas: planes, periodos y horas', () => {
  const hoy = new Date();
  beforeAll(async () => {
    await q(`INSERT INTO payroll_plans (project_id, user_id, modo_fijo, modo_horas, modo_comisiones, notas) VALUES
             ($1, $2, 1000, NULL, false, 'NOTA-PRIVADA'), ($1, $3, NULL, 15, false, NULL), ($4, $2, 2000, NULL, false, NULL)`,
    [P, LAURA.id, ANA.id, OTRO]);
    await q(`INSERT INTO work_hours (project_id, user_id, fecha, horas) VALUES ($1, $2, CURRENT_DATE, 8), ($1, $2, CURRENT_DATE, 4), ($3, $4, CURRENT_DATE, 99)`,
      [P, ANA.id, OTRO, LAURA.id]);
    await q(`INSERT INTO payroll_periods (project_id, user_id, periodo_year, periodo_month, fijo, horas_total, precio_hora, monto_horas, total, estado, fecha_pago) VALUES
             ($1, $2, $5, $6, 1000, 0, NULL, 0, 1000, 'pagado', CURRENT_DATE),
             ($1, $3, $5, $6, 0, 12, 15, 180, 180, 'abierto', NULL),
             ($4, $2, $5, $6, 2000, 0, NULL, 0, 2000, 'abierto', NULL)`,
    [P, LAURA.id, ANA.id, OTRO, hoy.getFullYear(), hoy.getMonth() + 1]);
  });

  it('planes, periodos y horas del campus pedido, con las cifras de la pantalla', async () => {
    const { datos } = await ver(ADMIN, 'nominas');
    expect(datos.planes).toHaveLength(2);
    expect(datos.planes.find((p) => p.persona === `${MARCA} LAURA`)).toMatchObject({ fijo_mensual: 1000, precio_hora: null, con_comisiones: false, campus: `${MARCA} a` });
    expect(datos.planes.find((p) => p.persona === `${MARCA} ANA`)).toMatchObject({ precio_hora: 15 });
    expect(datos.periodos.total).toBe(2);
    expect(datos.periodos.por_estado).toEqual({ pagado: { periodos: 1, importe: 1000 }, abierto: { periodos: 1, importe: 180 } });
    expect(datos.periodos.detalle.find((p) => p.persona === `${MARCA} ANA`)).toMatchObject({ horas: 12, precio_hora: 15, importe_horas: 180, total: 180 });
    expect(datos.horas).toMatchObject({ total: 12 });
    expect(datos.horas.por_persona).toEqual([{ persona: `${MARCA} ANA`, campus: `${MARCA} a`, horas: 12, registros: 2 }]);
  });

  it('con los dos campus suma los dos', async () => {
    const { datos } = await ver(ADMIN, 'nominas', {}, [P, OTRO]);
    expect(datos.periodos.total).toBe(3);
    expect(datos.horas.total).toBe(111);
  });

  it('un mes fuera del rango no entra', async () => {
    const { datos } = await ver(ADMIN, 'nominas', { desde: '2019-01-01', hasta: '2019-12-31' });
    expect(datos.periodos.total).toBe(0);
    expect(datos.horas.total).toBe(0);
  });

  it('ni correos, ni notas del plan, ni el detalle del cálculo', async () => {
    const texto = comoClaude((await ver(ADMIN, 'nominas', {}, [P, OTRO])).datos);
    expect(texto).not.toMatch(/@|NOTA-PRIVADA|detalle_|email/i);
  });
});

// ─── Clientes ─────────────────────────────────────────────────────────────

describe('clientes: compras, facturado, pendiente y salud de cobro', () => {
  beforeAll(async () => {
    // La venta 1 (1.000 €, 400 cobrados) se paga en dos cuotas: una vencida ayer y otra mañana.
    await q(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento) VALUES
             ($1, 1, 300, CURRENT_DATE - 1), ($1, 2, 300, CURRENT_DATE + 1)`, [V1]);
  });

  const pedir = (u, args = {}, campus = [P]) => correr('clientes', u, { pagina: 1, limite: 25, ...args }, campus);

  it('las cifras de arriba son las de la pantalla: clientes, facturado, cobrado y pendiente', async () => {
    const r = await pedir(ADMIN);
    expect(r.cifras).toEqual({ clientes: 2, facturado: 1600, cobrado: 1000, pendiente: 600 });
    expect(r.total).toBe(2);
    // El mismo listado de Prospectos que pinta la pantalla de Clientes: mismo total y mismos importes.
    const pantalla = await leadModel.findAll({ projectIds: [P], conConversion: true, page: 1, limit: 25 });
    expect(r.total).toBe(pantalla.total);
    const marta = pantalla.leads.find((l) => l.id === MARTA);
    expect(r.clientes.find((c) => c.prospecto_id === MARTA)).toMatchObject({
      compras: 1, facturado: Number(marta.total_compras), cobrado: Number(marta.total_pagado), pendiente: Number(marta.pendiente),
      cuotas: { total: 2, pagadas: 0, pendientes: 2 }, gestora: `${MARCA} LAURA`,
    });
    // Las cifras de arriba son la suma de las filas.
    expect(r.clientes.reduce((s, c) => s + c.facturado, 0)).toBe(r.cifras.facturado);
  });

  it('el cliente del otro campus no entra; con los dos campus, sí', async () => {
    expect((await pedir(ADMIN)).clientes.map((c) => c.prospecto_id).sort()).toEqual([MARTA, PEDRO].sort());
    expect((await pedir(ADMIN, {}, [P, OTRO])).cifras).toMatchObject({ clientes: 3, facturado: 2377 });
  });

  it('la salud de cobro y los próximos cobros: lo vencido aparte y lo que vence mañana', async () => {
    const { cobro } = await pedir(ADMIN);
    expect(cobro.total_pendiente).toBe(600);
    expect(cobro.salud_de_cobro.vencido).toEqual({ cobros: 1, importe: 300 });
    expect(cobro.salud_de_cobro.esta_semana).toEqual({ cobros: 1, importe: 300 });
    expect(cobro.proximos_cobros).toMatchObject({
      vencidos: { cobros: 1, importe: 300 }, hasta_manana: { cobros: 1, importe: 300 }, en_7_dias: { cobros: 1 }, en_30_dias: { cobros: 1 },
    });
  });

  it('filtros: texto, gestora y la fecha de la última compra', async () => {
    expect((await pedir(ADMIN, { texto: 'Marta' })).clientes.map((c) => c.prospecto_id)).toEqual([MARTA]);
    expect((await pedir(ADMIN, { texto: 'Marta' })).cifras.clientes).toBe(1);
    expect((await pedir(ADMIN, { gestora_id: ANA.id })).clientes.map((c) => c.prospecto_id)).toEqual([PEDRO]);
    expect((await pedir(ADMIN, { gestora_id: ANA.id })).cifras).toMatchObject({ clientes: 1, facturado: 600 });
    expect((await pedir(ADMIN, { desde: '2099-01-01' })).total).toBe(0);
    expect((await pedir(ADMIN, { desde: '2020-01-01', hasta: '2099-01-01' })).total).toBe(2);
  });

  it('una gestora ve solo a SUS clientes y no puede pedir los de otra', async () => {
    const laura = await pedir(LAURA);
    expect(laura.clientes.map((c) => c.prospecto_id)).toEqual([MARTA]);
    expect(laura.cifras).toEqual({ clientes: 1, facturado: 1000, cobrado: 400, pendiente: 600 });
    expect(laura.cobro.total_pendiente).toBe(600);
    expect((await pedir(ANA)).cobro.total_pendiente).toBe(0);
    await expect(pedir(ANA, { gestora_id: LAURA.id })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
    expect((await pedir(LAURA, { gestora_id: LAURA.id })).total).toBe(1);
  });

  it('el nombre sale abreviado y no hay ni correo ni teléfono; con datos_completos, el nombre entero', async () => {
    const r = await pedir(ADMIN);
    const visto = comoClaude(r);
    expect(visto).toContain(`${MARCA} M.`);
    expect(visto).not.toMatch(/Ruiz|Gil|@|600111222|600333444/);
    expect(JSON.stringify(protegerDatos(r, { completos: true }))).toContain('Marta Ruiz');
  });
});

describe('los días hasta una fecha (salud de cobro)', () => {
  it('cuenta días enteros desde hoy, con la fecha como texto', () => {
    expect(diasDesdeHoy('2026-10-20', '2026-10-20')).toBe(0);
    expect(diasDesdeHoy('2026-10-21', '2026-10-20')).toBe(1);
    expect(diasDesdeHoy('2026-10-19', '2026-10-20')).toBe(-1);
    expect(diasDesdeHoy('2026-11-19', '2026-10-20')).toBe(30);
    expect(diasDesdeHoy(null)).toBeNull();
    expect(hoyLocal(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30'); // en Madrid ya es lunes
  });
});

// ─── Formaciones sin tutor: la columna META ───────────────────────────────

describe('formaciones_sin_tutor: la columna META completa', () => {
  const productos = {};
  beforeAll(async () => {
    const [camp] = await q(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre, status) VALUES ($1, $2, 'act_1', 'Campaña', 'ACTIVE') RETURNING campaign_id`, [`${MARCA}-c`, P]);
    await q(`INSERT INTO meta_adsets (adset_id, campaign_id, project_id, nombre, status, total_spend, total_leads) VALUES
             ($1, $3, $4, 'Conjunto activo', 'ACTIVE', 120.5, 7), ($2, $3, $4, 'Conjunto pausado', 'PAUSED', 33, 0)`,
    [`${MARCA}-act`, `${MARCA}-pau`, camp.campaign_id, P]);
    for (const [clave, nombre] of Object.entries({ activo: 'Activo', pausado: 'Pausado', buscando: 'Buscando', nada: 'Nada', fantasma: 'Fantasma' })) {
      const [p] = await q(`INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 100) RETURNING id`, [P, `${MARCA} ${nombre}`]);
      ids.products.push(p.id);
      productos[clave] = p.id;
      const l = await lead(`Alumno ${nombre}`, { responsable: LAURA.id });
      await venta(l, P, `${MARCA} ${nombre}`, 100, 100, LAURA.id, p.id);
    }
    const busca = (producto, adset, buscando = true) => q(
      `INSERT INTO tutor_busquedas (product_id, project_id, buscando, adset_id) VALUES ($1, $2, $3, $4)`, [producto, P, buscando, adset]);
    await busca(productos.activo, `${MARCA}-act`);
    await busca(productos.pausado, `${MARCA}-pau`);
    await busca(productos.buscando, null);
    await busca(productos.fantasma, `${MARCA}-ya-no-existe`);
  });

  it('cada formación trae su situación en Meta, igual que la pantalla', async () => {
    const r = await correr('formaciones_sin_tutor', ADMIN, { incluir_anteriores_al_corte: true });
    const meta = (clave) => r.formaciones.find((f) => f.id === productos[clave]).meta;
    expect(meta('activo')).toMatchObject({ situacion: 'anuncio_activo', texto: 'Anuncio activo', estado_en_meta: 'ACTIVE', anuncio: 'Conjunto activo', gasto: 120.5, leads: 7 });
    expect(meta('pausado')).toMatchObject({ situacion: 'anuncio_pausado', gasto: 33, leads: 0 });
    expect(meta('buscando')).toMatchObject({ situacion: 'buscando' });
    expect(meta('nada')).toEqual({ situacion: 'no_se_busca', texto: expect.any(String) });
    expect(meta('fantasma')).toMatchObject({ situacion: 'anuncio_desaparecido' });
    // Lo que ya traía sigue ahí.
    expect(r.formaciones.find((f) => f.id === productos.activo)).toMatchObject({ buscando_tutor: true, cobrado: 100, ventas: 1 });
  });

  it('una gestora sigue sin verla', async () => {
    await expect(correr('formaciones_sin_tutor', LAURA, {})).rejects.toMatchObject({ code: 'MCP_SOLO_ADMIN' });
  });
});
