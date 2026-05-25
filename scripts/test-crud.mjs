#!/usr/bin/env node
// ============================================================
// CRM-ISEIE — Suite de tests CRUD end-to-end
// ============================================================
// Corre contra la API real (producción por defecto). Loguea con un usuario
// admin/superadmin, ejecuta CRUD completo sobre los recursos principales, y
// reporta qué pasa y qué falla con el endpoint + payload + respuesta exacta.
//
// Uso:
//   $env:CRM_EMAIL='manuel@empresa.com'
//   $env:CRM_PASSWORD='****'
//   $env:CRM_BASE_URL='https://crm.iseie.com'   # opcional, default prod
//   node scripts/test-crud.mjs
//
// Salida:
//   ✓ Test X (200ms)
//   ✗ Test Y · POST /api/leads · 400 · {"error":"..."}
//   ...
//   Resumen: 23/24 OK, 1 FAIL
// ============================================================

const BASE_URL = process.env.CRM_BASE_URL || 'https://crm.iseie.com';
const EMAIL = process.env.CRM_EMAIL;
const PASSWORD = process.env.CRM_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('ERROR: define CRM_EMAIL y CRM_PASSWORD en el entorno.');
  process.exit(1);
}

let accessToken = null;
let projectId = null;
const cleanup = []; // { resource, id }
const results = []; // { name, ok, ms, error }

// ----------------------------------------------------------------
// HTTP helpers
// ----------------------------------------------------------------
async function api(method, path, body = null, opts = {}) {
  const url = `${BASE_URL}/api${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken && !opts.noAuth) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, ok: true, ms });
    console.log(`  \x1b[32m✓\x1b[0m ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ name, ok: false, ms, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name} (${ms}ms)`);
    console.log(`     \x1b[31m${err.message}\x1b[0m`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertStatus(res, expected, label) {
  if (res.status !== expected) {
    throw new Error(`${label}: esperado ${expected}, recibido ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
  }
}

// ----------------------------------------------------------------
// LOGIN + bootstrap
// ----------------------------------------------------------------
async function login() {
  const res = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, { noAuth: true });
  if (!res.ok) throw new Error(`Login fallido: ${res.status} · ${JSON.stringify(res.data)}`);
  accessToken = res.data.data.accessToken;
  const projects = res.data.data.projects || [];
  if (projects.length === 0) throw new Error('Usuario no tiene proyectos asignados');
  projectId = res.data.data.activeProjectId || projects[0].id;
  console.log(`\n  Login OK · proyecto activo: ${projects.find((p) => p.id === projectId)?.nombre || projectId}\n`);
}

// ----------------------------------------------------------------
// TESTS
// ----------------------------------------------------------------
async function runTests() {
  console.log(`\nCRM-ISEIE · Test CRUD contra ${BASE_URL}\n`);
  await login();

  // ====================================================
  console.log('─── Lecturas básicas ───');

  await test('GET /health (sin auth)', async () => {
    const res = await api('GET', '/health', null, { noAuth: true });
    assertStatus(res, 200, 'health');
    assert(res.data?.data?.status === 'ok', 'status !== ok');
  });

  await test('GET /auth/me', async () => {
    const res = await api('GET', '/auth/me');
    assertStatus(res, 200, '/auth/me');
    assert(res.data?.data?.user?.email === EMAIL.toLowerCase(), 'email mismatch');
  });

  await test('GET /projects', async () => {
    const res = await api('GET', '/projects');
    assertStatus(res, 200, '/projects');
    assert(Array.isArray(res.data?.data), 'data no es array');
  });

  await test('GET /leads?projectId=X', async () => {
    const res = await api('GET', `/leads?projectId=${projectId}&limit=10`);
    assertStatus(res, 200, '/leads');
    assert(Array.isArray(res.data?.data), 'data no es array');
  });

  await test('GET /leads/stats?projectId=X', async () => {
    const res = await api('GET', `/leads/stats?projectId=${projectId}`);
    assertStatus(res, 200, '/leads/stats');
  });

  await test('GET /leads/dashboard-summary?projectId=X', async () => {
    const res = await api('GET', `/leads/dashboard-summary?projectId=${projectId}&days=30`);
    assertStatus(res, 200, '/leads/dashboard-summary');
  });

  await test('GET /products?projectId=X', async () => {
    const res = await api('GET', `/products?projectId=${projectId}`);
    assertStatus(res, 200, '/products');
    assert(Array.isArray(res.data?.data) || Array.isArray(res.data), 'data no es array');
  });

  await test('GET /accounting/dashboard', async () => {
    const res = await api('GET', `/accounting/dashboard?projectId=${projectId}`);
    assertStatus(res, 200, '/accounting/dashboard');
  });

  await test('GET /commissions', async () => {
    const res = await api('GET', `/commissions?projectId=${projectId}`);
    assertStatus(res, 200, '/commissions');
  });

  await test('GET /users/availability', async () => {
    const res = await api('GET', '/users/availability');
    assertStatus(res, 200, '/users/availability');
  });

  await test('GET /leads/spam-reports', async () => {
    const res = await api('GET', '/leads/spam-reports');
    assertStatus(res, 200, '/leads/spam-reports');
  });

  await test('GET /credentials', async () => {
    const res = await api('GET', '/credentials');
    assertStatus(res, 200, '/credentials');
  });

  // ====================================================
  console.log('\n─── CRUD Leads ───');

  let testLeadId = null;
  const testNombre = `TestSuite_${Date.now()}`;
  const testEmail = `test+${Date.now()}@crud-test.iseie.test`;

  await test('POST /leads · crear lead manual', async () => {
    const res = await api('POST', '/leads', {
      project_id: projectId,
      nombre: testNombre,
      email: testEmail,
      telefono: '+34 600 999 888',
      canal: 'directo',
      notas: 'Lead creado por test-crud.mjs',
    });
    assertStatus(res, 201, 'POST /leads');
    // La API devuelve { success, data: { lead_id, responsable_id, ... } }
    const leadId = res.data?.data?.lead_id ?? res.data?.data?.id;
    assert(leadId, `sin lead_id en response: ${JSON.stringify(res.data).slice(0, 200)}`);
    testLeadId = leadId;
    cleanup.push({ resource: 'lead', id: testLeadId });
  });

  await test('GET /leads/:id · leer el lead creado', async () => {
    if (!testLeadId) throw new Error('skip: no testLeadId');
    const res = await api('GET', `/leads/${testLeadId}`);
    assertStatus(res, 200, `/leads/${testLeadId}`);
    assert(res.data?.data?.nombre === testNombre, 'nombre no coincide');
  });

  await test('PATCH /leads/:id/status · cambiar estado (con motivo)', async () => {
    if (!testLeadId) throw new Error('skip');
    const res = await api('PATCH', `/leads/${testLeadId}/status`, {
      status: 'contactado',
      motivo: 'Test suite — pasando a contactado',
    });
    assertStatus(res, 200, `/leads/${testLeadId}/status`);
  });

  await test('PATCH /leads/:id/status · SIN motivo debe fallar 400', async () => {
    if (!testLeadId) throw new Error('skip');
    const res = await api('PATCH', `/leads/${testLeadId}/status`, { status: 'en_seguimiento' });
    if (res.status !== 400) throw new Error(`esperado 400, recibido ${res.status}`);
  });

  await test('PATCH /leads/:id · actualizar notas', async () => {
    if (!testLeadId) throw new Error('skip');
    const res = await api('PATCH', `/leads/${testLeadId}`, { notas: 'Nota actualizada por test suite' });
    assertStatus(res, 200, `PATCH /leads/${testLeadId}`);
  });

  await test('POST /leads/:id/interactions · añadir interacción', async () => {
    if (!testLeadId) throw new Error('skip');
    const res = await api('POST', `/leads/${testLeadId}/interactions`, {
      tipo: 'llamada',
      nota: 'Llamada de test suite',
    });
    assert(res.status === 200 || res.status === 201, `esperado 200/201, recibido ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
  });

  await test('POST /leads/:id/reminders · añadir recordatorio', async () => {
    if (!testLeadId) throw new Error('skip');
    const dia = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = await api('POST', `/leads/${testLeadId}/reminders`, {
      fecha_recordatorio: dia,
      nota: 'Recordatorio de test',
    });
    assert(res.status === 200 || res.status === 201, `esperado 200/201, recibido ${res.status}`);
  });

  await test('POST /leads/:id/report-spam · levantar reporte spam', async () => {
    if (!testLeadId) throw new Error('skip');
    const res = await api('POST', `/leads/${testLeadId}/report-spam`, { motivo: 'Test suite — falso reporte' });
    assertStatus(res, 201, `/leads/${testLeadId}/report-spam`);
  });

  await test('POST /leads/:id/report-spam · duplicado debe fallar 409', async () => {
    if (!testLeadId) throw new Error('skip');
    const res = await api('POST', `/leads/${testLeadId}/report-spam`, { motivo: 'Duplicado' });
    if (res.status !== 409) throw new Error(`esperado 409, recibido ${res.status}`);
  });

  await test('GET /leads/spam-reports/count · debe haber al menos 1 pendiente', async () => {
    const res = await api('GET', '/leads/spam-reports/count');
    assertStatus(res, 200, '/leads/spam-reports/count');
    assert((res.data?.data?.count ?? 0) >= 1, `count debe ser ≥ 1, recibido ${res.data?.data?.count}`);
  });

  await test('POST /leads/bulk · bulk create (2 leads)', async () => {
    const res = await api('POST', '/leads/bulk', {
      projectId,
      leads: [
        { nombre: `BulkTest1_${Date.now()}`, email: `bulk1+${Date.now()}@test.iseie.test`, canal: 'directo' },
        { nombre: `BulkTest2_${Date.now()}`, email: `bulk2+${Date.now()}@test.iseie.test`, canal: 'directo' },
      ],
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`/leads/bulk: esperado 200/201, recibido ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const ok = res.data?.data?.ok ?? res.data?.data?.created?.length ?? 0;
    assert(ok >= 2, `esperado 2 ok, recibido ${ok}`);
    (res.data?.data?.created || []).forEach((l) => cleanup.push({ resource: 'lead', id: l.lead_id ?? l.id }));
  });

  // ====================================================
  console.log('\n─── User availability ───');

  let currentUserId = null;
  await test('GET /auth/me · capturar userId', async () => {
    const res = await api('GET', '/auth/me');
    assertStatus(res, 200, '/auth/me');
    currentUserId = res.data.data.user.id;
  });

  await test('PATCH /users/:id/availability · pausar', async () => {
    if (!currentUserId) throw new Error('skip');
    const res = await api('PATCH', `/users/${currentUserId}/availability`, {
      is_available: false,
      motivo: 'Test suite — pausa temporal',
    });
    assertStatus(res, 200, `/users/${currentUserId}/availability`);
  });

  await test('PATCH /users/:id/availability · reactivar', async () => {
    if (!currentUserId) throw new Error('skip');
    const res = await api('PATCH', `/users/${currentUserId}/availability`, { is_available: true });
    assertStatus(res, 200, `/users/${currentUserId}/availability`);
  });

  let blockId = null;
  await test('POST /users/:id/availability-blocks · crear bloque', async () => {
    if (!currentUserId) throw new Error('skip');
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await api('POST', `/users/${currentUserId}/availability-blocks`, {
      fecha_inicio: today,
      fecha_fin: tomorrow,
      motivo: 'Test suite block',
    });
    assertStatus(res, 201, 'POST availability-blocks');
    blockId = res.data?.data?.id;
  });

  await test('DELETE /users/availability-blocks/:id · borrar bloque', async () => {
    if (!blockId) throw new Error('skip: no blockId');
    const res = await api('DELETE', `/users/availability-blocks/${blockId}`);
    assertStatus(res, 200, `DELETE availability-blocks/${blockId}`);
  });

  // ====================================================
  console.log('\n─── CRUD Productos ───');

  let testProductId = null;
  await test('POST /products · crear producto', async () => {
    const res = await api('POST', '/products', {
      projectId,
      nombre: `TestProduct_${Date.now()}`,
      descripcion: 'Producto creado por test-crud.mjs',
      precio: 999.99,
      moneda: 'EUR',
      active: true,
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`status ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const id = res.data?.data?.id ?? res.data?.id;
    assert(id, 'sin id en response');
    testProductId = id;
  });

  await test('GET /products/:id · leer producto', async () => {
    if (!testProductId) throw new Error('skip');
    const res = await api('GET', `/products/${testProductId}?projectId=${projectId}`);
    assertStatus(res, 200, 'GET product');
  });

  await test('PATCH /products/:id · actualizar precio', async () => {
    if (!testProductId) throw new Error('skip');
    const res = await api('PATCH', `/products/${testProductId}?projectId=${projectId}`, { precio: 1299.50 });
    assertStatus(res, 200, 'PATCH product');
  });

  await test('GET /products/leads-stats · KPI de productos', async () => {
    const res = await api('GET', `/products/leads-stats?projectId=${projectId}`);
    assertStatus(res, 200, '/products/leads-stats');
  });

  // ====================================================
  console.log('\n─── CRUD Conversions (sobre un lead nuevo) ───');

  let convLeadId = null;
  let conversionId = null;
  await test('POST /leads · crear lead para conversión', async () => {
    const res = await api('POST', '/leads', {
      project_id: projectId,
      nombre: `ConvLead_${Date.now()}`,
      email: `conv+${Date.now()}@test.iseie.test`,
      canal: 'directo',
    });
    assertStatus(res, 201, 'POST /leads para conversion');
    convLeadId = res.data?.data?.lead_id ?? res.data?.data?.id;
    cleanup.push({ resource: 'lead', id: convLeadId });
  });

  await test('POST /conversions · crear conversión', async () => {
    if (!convLeadId) throw new Error('skip');
    const res = await api('POST', '/conversions', {
      lead_id: convLeadId,
      project_id: projectId,
      producto_contratado: 'Test producto académico',
      importe_total: 500,
      importe_pagado: 0,
      metodo_pago: 'tarjeta',
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`status ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    conversionId = res.data?.data?.id;
    assert(conversionId, 'sin id en conversion');
  });

  await test('GET /conversions/:id · leer conversión', async () => {
    if (!conversionId) throw new Error('skip');
    const res = await api('GET', `/conversions/${conversionId}`);
    assertStatus(res, 200, 'GET conversion');
  });

  await test('POST /conversions/:id/payments · registrar cobro', async () => {
    if (!conversionId) throw new Error('skip');
    const res = await api('POST', `/conversions/${conversionId}/payments`, {
      importe: 200,
      fecha: new Date().toISOString().slice(0, 10),
      notas: 'Test pago parcial',
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`status ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
    }
  });

  await test('GET /conversions/by-lead/:leadId · conversiones por lead', async () => {
    if (!convLeadId) throw new Error('skip');
    const res = await api('GET', `/conversions/by-lead/${convLeadId}`);
    assertStatus(res, 200, '/conversions/by-lead');
  });

  // ====================================================
  console.log('\n─── CRUD Expenses ───');

  let expenseId = null;
  await test('POST /expenses · crear egreso', async () => {
    const res = await api('POST', '/expenses', {
      project_id: projectId,
      concepto: `TestExpense_${Date.now()}`,
      importe: 150.5,
      fecha: new Date().toISOString().slice(0, 10),
      categoria: 'servicios',
      notas: 'Egreso test-crud.mjs',
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`status ${res.status} · ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    expenseId = res.data?.data?.id;
    assert(expenseId, 'sin id en expense');
  });

  await test('GET /expenses · listar egresos', async () => {
    const res = await api('GET', `/expenses?projectId=${projectId}`);
    assertStatus(res, 200, '/expenses');
  });

  await test('PATCH /expenses/:id · actualizar concepto', async () => {
    if (!expenseId) throw new Error('skip');
    const res = await api('PATCH', `/expenses/${expenseId}`, {
      concepto: 'TestExpense actualizado',
    });
    assertStatus(res, 200, `PATCH /expenses/${expenseId}`);
  });

  await test('DELETE /expenses/:id · eliminar', async () => {
    if (!expenseId) throw new Error('skip');
    const res = await api('DELETE', `/expenses/${expenseId}`);
    if (res.status !== 200 && res.status !== 204) throw new Error(`status ${res.status}`);
  });

  // ====================================================
  console.log('\n─── Document preview (invoice) ───');

  await test('POST /documents/preview · HTML factura persona_natural', async () => {
    const res = await api('POST', '/documents/preview', {
      type: 'invoice',
      data: {
        tipo: 'persona_natural',
        numero: 1,
        fecha: '2026-05-25',
        cliente_nombre: 'Test User',
        cliente_dni: '12345678A',
        cliente_direccion: 'Calle Test 1, Madrid',
        cliente_telefono: '+34 600 000 000',
        lineas: [{ descripcion: 'Test curso', cantidad: 1, precio: 100 }],
      },
    });
    assertStatus(res, 200, '/documents/preview');
    // res.data es texto HTML (no JSON parsed) cuando el backend retorna text/html
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    assert(html.includes('ISEIE INNOVATION SCHOOL'), 'preview no contiene cabecera ISEIE');
    assert(html.includes('FACTURA A:'), 'preview no contiene FACTURA A:');
  });

  await test('POST /documents/preview · HTML factura contado', async () => {
    const res = await api('POST', '/documents/preview', {
      type: 'invoice',
      data: {
        tipo: 'contado',
        numero: 2,
        fecha: '2026-05-25',
        lineas: [{ descripcion: 'Test contado', cantidad: 1, precio: 280 }],
      },
    });
    assertStatus(res, 200, '/documents/preview');
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    assert(html.includes('FACTURA DE CONTADO'), 'preview contado no muestra título');
    assert(html.includes('art. 20'), 'preview contado no muestra exención IVA');
  });

  await test('GET /documents/next-number?type=invoice · número siguiente', async () => {
    const res = await api('GET', `/documents/next-number?projectId=${projectId}&type=invoice`);
    assertStatus(res, 200, '/documents/next-number');
    assert(typeof res.data?.data?.number === 'number', 'sin number en response');
  });

  // ====================================================
  console.log('\n─── Auth & seguridad ───');

  await test('POST /auth/login · credenciales incorrectas → 401', async () => {
    const res = await api('POST', '/auth/login', { email: EMAIL, password: 'wrong-password' }, { noAuth: true });
    if (res.status !== 401) throw new Error(`esperado 401, recibido ${res.status}`);
  });

  await test('POST /auth/login · email inválido → 400', async () => {
    const res = await api('POST', '/auth/login', { email: 'not-an-email', password: 'x' }, { noAuth: true });
    if (res.status !== 400) throw new Error(`esperado 400, recibido ${res.status}`);
  });

  await test('GET /auth/me sin token → 401', async () => {
    const res = await api('GET', '/auth/me', null, { noAuth: true });
    if (res.status !== 401) throw new Error(`esperado 401, recibido ${res.status}`);
  });

  await test('POST /auth/change-password · contraseña actual incorrecta → 401', async () => {
    const res = await api('POST', '/auth/change-password', {
      currentPassword: 'wrong-current',
      newPassword: 'NewPass1234',
      confirmPassword: 'NewPass1234',
    });
    if (res.status !== 401) throw new Error(`esperado 401, recibido ${res.status}`);
  });

  await test('POST /auth/change-password · confirmación no coincide → 400', async () => {
    const res = await api('POST', '/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'NewPass1234',
      confirmPassword: 'Different5678',
    });
    if (res.status !== 400) throw new Error(`esperado 400, recibido ${res.status}`);
  });

  await test('PATCH /auth/me · actualizar nombre del usuario actual', async () => {
    const res = await api('PATCH', '/auth/me', { nombre: 'CRUD Test (renamed)' });
    assertStatus(res, 200, 'PATCH /auth/me');
    // Restaurar
    await api('PATCH', '/auth/me', { nombre: 'CRUD Test (temporal)' });
  });

  await test('GET /status · sin auth (público)', async () => {
    const res = await api('GET', '/status', null, { noAuth: true });
    // El endpoint puede ser 200 (operativo) o 404 si no expone listado en GET raíz
    if (res.status !== 200 && res.status !== 404) {
      throw new Error(`status ${res.status}`);
    }
  });

  await test('GET /health/detailed · DB + integraciones + schedulers', async () => {
    const res = await api('GET', '/health/detailed', null, { noAuth: true });
    assertStatus(res, 200, '/health/detailed');
    assert(res.data?.data?.database?.status === 'ok', 'DB no responde ok');
    assert(typeof res.data?.data?.process?.uptime_seconds === 'number', 'sin uptime');
    assert(res.data?.data?.schedulers, 'sin schedulers info');
  });

  // ====================================================
  console.log('\n─── Limpieza ───');

  if (testProductId) {
    await test(`DELETE /products/${testProductId} · cleanup`, async () => {
      const res = await api('DELETE', `/products/${testProductId}?projectId=${projectId}`);
      if (res.status !== 200 && res.status !== 204) throw new Error(`status ${res.status}`);
    });
  }

  for (const item of cleanup) {
    if (item.resource === 'lead') {
      await test(`DELETE /leads/${item.id} · cleanup soft-delete`, async () => {
        const res = await api('DELETE', `/leads/${item.id}`);
        if (res.status !== 200 && res.status !== 204) throw new Error(`status ${res.status}`);
      });
    }
  }

  // ====================================================
  // Resumen
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const total = results.length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Resumen: ${ok}/${total} OK, ${fail} FAIL`);
  console.log(`Tiempo total: ${results.reduce((s, r) => s + r.ms, 0)}ms`);
  if (fail > 0) {
    console.log(`\nFalladas:`);
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name}\n    ${r.error}`));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('\n\x1b[31mFATAL:\x1b[0m', err.message);
  process.exit(1);
});
