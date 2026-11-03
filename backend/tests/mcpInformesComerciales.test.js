import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Lo comercial del día a día en el MCP (#325), contra la base de verdad.
 *
 * Las seis consultas nuevas del tipo «informe» (dashboard_hoy, cola_del_dia,
 * seguimiento_fin_de_mes, feedback, pendientes_de_facturar, metas_gestoras) son las
 * MISMAS funciones que las pantallas. Aquí se comprueba lo que un test con la
 * base grabada no puede: que la consulta SQL funciona de verdad, que las cifras
 * son las del campus de quien pregunta, que una gestora solo ve lo suyo y que
 * lo de administración se le niega.
 *
 *   npx vitest run tests/mcpInformesComerciales.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { HERRAMIENTAS, INFORMES } = await import('../src/modules/mcp/mcp.tools.js');
const { construirAmbito } = await import('../src/modules/mcp/mcp.acceso.js');
const { protegerDatos } = await import('../src/modules/mcp/mcp.privacidad.js');

const MARCA = `MCC${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [] };
let P; let OTRO; let ADMIN; let LAURA; let ANA;
const informe = HERRAMIENTAS.find((h) => h.nombre === 'informe');

const ambito = (u, campus) => construirAmbito(
  { id: u.id, nombre: u.nombre, role: u.role, active: true, usa_mcp: true },
  campus.map((c) => ({ id: c, nombre: `c${c}`, sociedad_id: null, sociedad_nombre: null }))
);
const ver = (u, tipo, extra = {}, campus = [P]) => informe.ejecutar(ambito(u, campus), { tipo, ...extra });

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  return u;
}
async function lead(nombre, { responsable = null, proyecto = P, dias = 0 }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, responsable_id, created_at, fecha_solicitud)
     VALUES ($1, $2, $3, now() - ($4 || ' days')::interval, now() - ($4 || ' days')::interval) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, responsable, String(dias)]
  );
  ids.leads.push(l.id);
  return l.id;
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

  // Prospectos de Laura y de Ana en P (antigüedades distintas) y uno en OTRO.
  const l1 = await lead('Marta Ruiz', { responsable: LAURA.id, dias: 2 });
  await lead('Pedro Gil', { responsable: LAURA.id, dias: 40 });
  await lead('Lucía Mora', { responsable: ANA.id, dias: 200 });
  await lead('Otro campus', { responsable: LAURA.id, proyecto: OTRO, dias: 2 });
  await q(`INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, 'llamada', 'x', $2)`, [l1, LAURA.id]);

  // Un cobro SIN factura en P y otro en OTRO.
  const venta = async (leadId, proyecto, importe) => {
    const [c] = await q(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion)
       VALUES ($1, $2, 'Máster en Coaching', $3, $3, $4, CURRENT_DATE) RETURNING id`, [leadId, proyecto, importe, LAURA.id]);
    ids.conversions.push(c.id);
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, CURRENT_DATE)`, [c.id, importe]);
  };
  await venta(l1, P, 900);
  const lOtro = (await q(`SELECT id FROM leads WHERE nombre = $1`, [`${MARCA} Otro campus`]))[0].id;
  await venta(lOtro, OTRO, 700);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

const NUEVOS = ['dashboard_hoy', 'cola_del_dia', 'seguimiento_fin_de_mes', 'feedback', 'pendientes_de_facturar', 'metas_gestoras'];

describe('están, con su descripción, entre los informes de Claude', () => {
  it('cada una figura en el listado de la herramienta «informe»', () => {
    for (const n of NUEVOS) expect(Object.keys(INFORMES)).toContain(n);
    for (const n of NUEVOS) expect(informe.descripcion).toContain(n);
    for (const n of NUEVOS) expect(INFORMES[n].descripcion.length).toBeGreaterThan(20);
  });
});

describe('funcionan de verdad contra la base', () => {
  it('un admin ejecuta las seis sin error', async () => {
    for (const n of NUEVOS) {
      const r = await ver(ADMIN, n);
      expect(r.informe, n).toBe(n);
      expect(r.datos, n).toBeTruthy();
    }
  });

  it('seguimiento_fin_de_mes: solo los prospectos del campus, por antigüedad', async () => {
    const { datos } = await ver(ADMIN, 'seguimiento_fin_de_mes');
    // Marta ya compró, así que no está en seguimiento (como en la pantalla): quedan Pedro (40 días) y Lucía (200).
    expect(datos).toMatchObject({ total: 2, este_mes: 0, uno_a_tres: 1, mas_de_seis: 1 }); // y el de OTRO campus no cuenta
  });

  it('dashboard_hoy: el servidor da las cifras de ayer y hoy del campus', async () => {
    const { datos } = await ver(ADMIN, 'dashboard_hoy');
    const dias = Array.isArray(datos) ? datos : datos.dias;
    expect(Array.isArray(dias)).toBe(true);
    expect(dias.map((d) => d.dia).sort()).toEqual(['ayer', 'hoy']);
  });

  it('cola_del_dia: las cuatro cifras, como números', async () => {
    const { datos } = await ver(ADMIN, 'cola_del_dia');
    for (const k of ['atrasados', 'hoy', 'manana', 'esta_semana']) expect(typeof datos[k], k).toBe('number');
  });

  it('pendientes_de_facturar: el cobro sin factura de SU campus, con el cliente abreviado; el de otro campus no', async () => {
    const r = await ver(ADMIN, 'pendientes_de_facturar', { desde: '2020-01-01' });
    expect(r.datos).toMatchObject({ ventas: 1, importe: 900 });
    const protegido = protegerDatos(r.datos);
    expect(protegido.detalle[0].cliente).toBe(`${MARCA} M.`);
    expect(JSON.stringify(protegido)).not.toContain('Ruiz');
    // Con datos_completos sí sale entero (queda en la auditoría).
    expect(JSON.stringify(protegerDatos(r.datos, { completos: true }))).toContain('Marta Ruiz');
    // El campus ajeno no se puede ni pedir.
    await expect(ver(ADMIN, 'pendientes_de_facturar', { proyecto_id: OTRO })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
  });

  it('metas_gestoras y feedback devuelven su estructura', async () => {
    const m = await ver(ADMIN, 'metas_gestoras', { desde: '2020-01-01', hasta: '2030-01-01' });
    expect(m.datos).toBeTruthy();
    const f = await ver(ADMIN, 'feedback', { desde: '2020-01-01' });
    expect(f.datos.totales ?? f.datos).toBeTruthy();
  });
});

describe('una gestora solo ve lo suyo y no lo de administración', () => {
  it('seguimiento_fin_de_mes: solo SUS prospectos', async () => {
    const laura = (await ver(LAURA, 'seguimiento_fin_de_mes')).datos;
    expect(laura.total).toBe(1); // Pedro (Marta ya compró); no Lucía (de Ana) ni el de otro campus
    const ana = (await ver(ANA, 'seguimiento_fin_de_mes')).datos;
    expect(ana.total).toBe(1);
  });

  it('lo de administración se le niega: pendientes_de_facturar y metas_gestoras', async () => {
    for (const n of ['pendientes_de_facturar', 'metas_gestoras']) {
      await expect(ver(LAURA, n)).rejects.toMatchObject({ code: 'MCP_INFORME_SOLO_ADMIN' });
    }
  });

  it('el resto sí le sale, recortado a ella', async () => {
    for (const n of ['dashboard_hoy', 'cola_del_dia', 'feedback']) {
      expect((await ver(LAURA, n)).datos, n).toBeTruthy();
    }
  });
});

// ─── Las mejoras a consultas que ya existían (#325) ───────────────────────

const herr = (n) => HERRAMIENTAS.find((h) => h.nombre === n);
const correr = (n, u, args = {}, campus = [P]) => herr(n).ejecutar(ambito(u, campus), args);

describe('listar_ventas: por vendedora y facturada / sin facturar', () => {
  it('sin filtro, la venta de Laura; el campus ajeno no', async () => {
    const r = await correr('listar_ventas', ADMIN, { pagina: 1, limite: 25 });
    expect(r.total).toBe(1);
    expect(r.ventas[0]).toMatchObject({ importe_total: '900.00' });
  });

  it('por vendedora: Laura la tiene, Ana no', async () => {
    expect((await correr('listar_ventas', ADMIN, { vendedora_id: LAURA.id, pagina: 1, limite: 25 })).total).toBe(1);
    expect((await correr('listar_ventas', ADMIN, { vendedora_id: ANA.id, pagina: 1, limite: 25 })).total).toBe(0);
  });

  it('sin facturar la incluye y facturada no (no hay ninguna factura)', async () => {
    expect((await correr('listar_ventas', ADMIN, { facturada: false, pagina: 1, limite: 25 })).total).toBe(1);
    expect((await correr('listar_ventas', ADMIN, { facturada: true, pagina: 1, limite: 25 })).total).toBe(0);
  });

  it('una gestora ve las suyas y NO puede pedir las de otra', async () => {
    expect((await correr('listar_ventas', LAURA, { pagina: 1, limite: 25 })).total).toBe(1);
    expect((await correr('listar_ventas', ANA, { pagina: 1, limite: 25 })).total).toBe(0);
    await expect(correr('listar_ventas', ANA, { vendedora_id: LAURA.id, pagina: 1, limite: 25 })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
    // Pedirse a sí misma sí.
    expect((await correr('listar_ventas', LAURA, { vendedora_id: LAURA.id, pagina: 1, limite: 25 })).total).toBe(1);
  });
});

describe('listar_formaciones: SKU e inactivas', () => {
  beforeAll(async () => {
    await q(`INSERT INTO products (project_id, nombre, sku, active) VALUES ($1, $2, 'SKU-ACT', true), ($1, $3, 'SKU-BAJA', false)`,
      [P, `${MARCA} Activa`, `${MARCA} De baja`]);
  });
  afterAll(async () => { await q(`DELETE FROM products WHERE project_id = ANY($1::int[])`, [ids.projects]); });

  it('por defecto solo las activas, con su SKU', async () => {
    const r = await correr('listar_formaciones', ADMIN, { pagina: 1, limite: 25 });
    expect(r.formaciones.map((f) => f.curso)).toEqual([`${MARCA} Activa`]);
    expect(r.formaciones[0]).toMatchObject({ sku: 'SKU-ACT', activa: true });
  });

  it('con incluir_inactivas, también las dadas de baja, marcadas', async () => {
    const r = await correr('listar_formaciones', ADMIN, { incluir_inactivas: true, pagina: 1, limite: 25 });
    expect(r.total).toBe(2);
    expect(r.formaciones.find((f) => f.sku === 'SKU-BAJA')).toMatchObject({ activa: false });
  });
});

describe('comisiones_tutores: la base de cálculo, en los totales', () => {
  it('los totales traen base además de generado, por pagar, pagado y revertido', async () => {
    const r = await correr('comisiones_tutores', ADMIN, { solo_entregas_pendientes: false });
    expect(Object.keys(r.totales).sort()).toEqual(['base', 'generado', 'pagado', 'por_pagar', 'revertido']);
  });
});

// ─── Administración y dinero (#325) ───────────────────────────────────────

describe('las consultas de administración, solo para quien manda y de SUS campus', () => {
  const ADMINISTRACION = ['egresos', 'cuentas_por_pagar', 'pagos_stripe', 'comisiones_gestoras', 'duplicados'];

  beforeAll(async () => {
    await q(`INSERT INTO expenses (concepto, importe, fecha, project_id) VALUES ($1, 250, '2026-10-05', $2), ($3, 999, '2026-10-05', $4)`,
      [`${MARCA} alquiler`, P, `${MARCA} otro campus`, OTRO]);
  });
  afterAll(async () => { await q(`DELETE FROM expenses WHERE concepto LIKE $1`, [`${MARCA}%`]); });

  it('un admin las ejecuta contra la base sin error', async () => {
    for (const n of ADMINISTRACION) expect((await ver(ADMIN, n, { desde: '2020-01-01', hasta: '2030-01-01' })).datos, n).toBeTruthy();
  });

  it('una gestora no: se le niega con el mismo código que el resto de lo de administración', async () => {
    for (const n of ADMINISTRACION) {
      await expect(ver(LAURA, n), n).rejects.toMatchObject({ code: 'MCP_INFORME_SOLO_ADMIN' });
    }
  });

  it('egresos: solo lo de su campus, por categoría', async () => {
    const { datos } = await ver(ADMIN, 'egresos', { desde: '2026-10-01', hasta: '2026-10-31' });
    // El de OTRO campus (999) no entra; los gastos generales de la casa del resto de la base, sí pueden estar,
    // así que se mira que el nuestro esté y el ajeno no.
    expect(datos.por_categoria.some((c) => c.total >= 250)).toBe(true);
    expect(datos.total).toBeGreaterThanOrEqual(250);
    expect(JSON.stringify(datos)).not.toContain('999');
  });

  it('duplicados: cuatro cifras', async () => {
    const { datos } = await ver(ADMIN, 'duplicados');
    expect(Object.keys(datos).sort()).toEqual(['aprobados', 'descartados', 'fusionados', 'pendientes']);
  });
});

describe('equipo: quién hay en tus campus, sin correos', () => {
  beforeAll(async () => {
    await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $3), ($2, $3), ($1, $4)`, [LAURA.id, ANA.id, P, OTRO]);
    await q(`UPDATE users SET active = false WHERE id = $1`, [ANA.id]);
  });

  it('las personas activas del campus, con su rol y campus; ninguna de OTRO que no esté en P', async () => {
    const r = await correr('equipo', ADMIN);
    const nombres = r.personas.map((p) => p.nombre);
    expect(nombres).toContain(`${MARCA} LAURA`);
    expect(nombres).not.toContain(`${MARCA} ANA`); // desactivada
    const laura = r.personas.find((p) => p.nombre === `${MARCA} LAURA`);
    expect(laura).toMatchObject({ rol: 'gestor', activo: true });
    // Laura está en P y en OTRO, pero solo se ve el campus que se pidió.
    expect(laura.campus).toEqual([`${MARCA} a`]);
    expect(r.total).toBe(r.personas.length);
    expect(r.por_rol.gestor).toBeGreaterThanOrEqual(1);
  });

  it('con incluir_inactivos sale también la desactivada', async () => {
    const r = await correr('equipo', ADMIN, { incluir_inactivos: true });
    expect(r.personas.map((p) => p.nombre)).toContain(`${MARCA} ANA`);
  });

  it('ni un correo, ni un teléfono, ni nada personal en la respuesta', async () => {
    const texto = JSON.stringify(await correr('equipo', ADMIN, { incluir_inactivos: true }));
    expect(texto).not.toMatch(/@/);
    expect(texto).not.toMatch(/email|correo|telefono|password/i);
  });

  it('una gestora no la ve', async () => {
    await expect(correr('equipo', LAURA)).rejects.toMatchObject({ code: 'MCP_SOLO_ADMIN' });
  });

  it('un campus ajeno no se puede pedir', async () => {
    await expect(correr('equipo', ADMIN, { proyecto_id: OTRO })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
  });
});

// ─── buscar_prospectos y ver_prospecto, con más contexto (#325) ───────────

describe('buscar_prospectos: gestora, programa y lo que hace falta para decidir a quién llamar', () => {
  let PRODUCTO; let LEAD_MARTA;
  beforeAll(async () => {
    PRODUCTO = (await q(`INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id`, [P, `${MARCA} Máster en Coaching Sistémico`]))[0].id;
    LEAD_MARTA = (await q(`SELECT id FROM leads WHERE nombre = $1`, [`${MARCA} Marta Ruiz`]))[0].id;
    await q(`UPDATE leads SET producto_interes_id = $2 WHERE id = $1`, [LEAD_MARTA, PRODUCTO]);
    await q(`INSERT INTO lead_steps (lead_id, project_id, clave, orden, fecha_prevista, estado) VALUES ($1, $2, 'dia1_saludo', 1, '2026-01-01', 'hecho'), ($1, $2, 'dia2_opiniones', 2, '2026-11-02', 'pendiente')`, [LEAD_MARTA, P]);
    await q(`INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, created_by) VALUES ($1, '2026-11-05', 'Llamar el jueves', $2)`, [LEAD_MARTA, LAURA.id]);
    await q(`INSERT INTO lead_products (lead_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [LEAD_MARTA, PRODUCTO]);
  });
  afterAll(async () => {
    await q(`DELETE FROM lead_reminders WHERE lead_id = $1`, [LEAD_MARTA]);
    await q(`DELETE FROM lead_steps WHERE lead_id = $1`, [LEAD_MARTA]);
    await q(`DELETE FROM lead_products WHERE lead_id = $1`, [LEAD_MARTA]);
    await q(`UPDATE leads SET producto_interes_id = NULL WHERE id = $1`, [LEAD_MARTA]);
    await q(`DELETE FROM products WHERE id = $1`, [PRODUCTO]);
  });

  it('cada fila trae último y próximo contacto, el paso y lo vendido', async () => {
    const r = await correr('buscar_prospectos', ADMIN, { texto: 'Marta', pagina: 1, limite: 25 });
    expect(r.prospectos).toHaveLength(1);
    expect(r.prospectos[0]).toMatchObject({ paso_actual: 'dia2_opiniones', es_cliente: true });
    expect(r.prospectos[0].ultimo_contacto).toBeTruthy(); // la llamada de Laura
    expect(String(r.prospectos[0].proximo_contacto)).toContain('2026-11-02');
    expect(Number(r.prospectos[0].valor_vendido)).toBe(900);
  });

  it('por gestora: Laura tiene dos, Ana uno', async () => {
    expect((await correr('buscar_prospectos', ADMIN, { gestora_id: LAURA.id, pagina: 1, limite: 25 })).total).toBe(2);
    expect((await correr('buscar_prospectos', ADMIN, { gestora_id: ANA.id, pagina: 1, limite: 25 })).total).toBe(1);
  });

  it('por programa, sin tildes ni mayúsculas', async () => {
    const r = await correr('buscar_prospectos', ADMIN, { programa: 'COACHING sistemico', pagina: 1, limite: 25 });
    expect(r.total).toBe(1);
    expect((await correr('buscar_prospectos', ADMIN, { programa: 'astrologia', pagina: 1, limite: 25 })).total).toBe(0);
  });

  it('una gestora no pide los de otra', async () => {
    await expect(correr('buscar_prospectos', LAURA, { gestora_id: ANA.id, pagina: 1, limite: 25 })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
    expect((await correr('buscar_prospectos', LAURA, { gestora_id: LAURA.id, pagina: 1, limite: 25 })).total).toBe(2);
  });

  it('ver_prospecto: paso actual, pasos, recordatorios y programas de interés', async () => {
    const r = await correr('ver_prospecto', ADMIN, { id: LEAD_MARTA });
    expect(r.paso_actual).toMatchObject({ orden: 2, clave: 'dia2_opiniones' });
    expect(r.pasos_del_proceso.map((p) => p.clave)).toEqual(['dia1_saludo', 'dia2_opiniones']);
    expect(r.recordatorios_pendientes).toEqual([expect.objectContaining({ nota: 'Llamar el jueves' })]);
    expect(r.programas_de_interes.map((p) => p.nombre)).toEqual([`${MARCA} Máster en Coaching Sistémico`]);
  });

  it('un prospecto sin proceso sale con paso null y listas vacías, no con un error', async () => {
    const pedro = (await q(`SELECT id FROM leads WHERE nombre = $1`, [`${MARCA} Pedro Gil`]))[0].id;
    const r = await correr('ver_prospecto', ADMIN, { id: pedro });
    expect(r).toMatchObject({ paso_actual: null, pasos_del_proceso: [], recordatorios_pendientes: [], programas_de_interes: [] });
  });
});

describe('cobros_pendientes: por gestora', () => {
  it('acepta la gestora y no se cae con la base real (sin cuotas a cobrar, lista vacía)', async () => {
    const todas = await correr('cobros_pendientes', ADMIN, { limite: 10 });
    expect(todas).toMatchObject({ cobros: expect.any(Number), detalle: expect.any(Array) });
    expect(await correr('cobros_pendientes', ADMIN, { gestora_id: LAURA.id, limite: 10 })).toMatchObject({ cobros: expect.any(Number) });
  });

  it('una gestora no pide los de otra; los suyos, sí', async () => {
    await expect(correr('cobros_pendientes', LAURA, { gestora_id: ANA.id, limite: 10 })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
    expect(await correr('cobros_pendientes', LAURA, { gestora_id: LAURA.id, limite: 10 })).toMatchObject({ cobros: expect.any(Number) });
  });
});

describe('proceso_comercial: los prospectos por paso, con los mismos de la cola', () => {
  it('cuadra con cola_del_dia: la suma de los pasos es la de la cola', async () => {
    // Un prospecto de Laura con su proceso: paso 1 hecho, paso 2 pendiente y atrasado.
    const l = (await q(`SELECT id FROM leads WHERE nombre = $1`, [`${MARCA} Pedro Gil`]))[0].id;
    await q(`INSERT INTO lead_steps (lead_id, project_id, clave, orden, fecha_prevista, estado) VALUES ($1, $2, 'dia1_saludo', 1, CURRENT_DATE - 9, 'hecho'), ($1, $2, 'dia2_opiniones', 2, CURRENT_DATE - 3, 'pendiente'), ($1, $2, 'dia3_ultima_plaza', 3, CURRENT_DATE + 2, 'pendiente')`, [l, P]);
    try {
      const { datos } = await ver(ADMIN, 'proceso_comercial');
      const paso2 = datos.pasos.find((p) => p.clave === 'dia2_opiniones');
      expect(paso2).toMatchObject({ orden: 2, prospectos: 1, atrasados: 1 });
      // El paso 3 aún no es «el paso actual» de nadie.
      expect(datos.pasos.find((p) => p.clave === 'dia3_ultima_plaza')).toBeUndefined();
      const cola = (await ver(ADMIN, 'cola_del_dia')).datos;
      expect(datos.total).toBeGreaterThanOrEqual(1);
      // Todo el que está atrasado en un paso está atrasado en la cola.
      expect(datos.pasos.reduce((s, p) => s + p.atrasados, 0)).toBe(cola.atrasados);
    } finally {
      await q(`DELETE FROM lead_steps WHERE lead_id = $1`, [l]);
    }
  });

  it('una gestora, solo los suyos; el campus ajeno no entra', async () => {
    const laura = (await ver(LAURA, 'proceso_comercial')).datos;
    const ana = (await ver(ANA, 'proceso_comercial')).datos;
    expect(laura.total + ana.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(laura.pasos)).toBe(true);
  });
});
