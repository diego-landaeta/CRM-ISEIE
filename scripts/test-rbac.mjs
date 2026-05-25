#!/usr/bin/env node
// ============================================================
// CRM-ISEIE — Tests RBAC (permisos por rol)
// ============================================================
// Loguea como GESTOR y verifica que NO puede acceder a endpoints
// reservados a admin/superadmin: credentials, expenses, accounting,
// users management, roles/permissions, audit log, dossiers, etc.
//
// Uso (asume que el gestor temporal ya está creado):
//   $env:GESTOR_EMAIL='crud-test-gestor@iseie.test'
//   $env:GESTOR_PASSWORD='GestorTest2026!'
//   node scripts/test-rbac.mjs
// ============================================================

const BASE_URL = process.env.CRM_BASE_URL || 'https://crm.iseie.com';
const EMAIL = process.env.GESTOR_EMAIL;
const PASSWORD = process.env.GESTOR_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('ERROR: define GESTOR_EMAIL y GESTOR_PASSWORD en el entorno.');
  process.exit(1);
}

let accessToken = null;
let projectId = null;
const results = [];

async function api(method, path, body = null) {
  const url = `${BASE_URL}/api${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
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
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`     \x1b[31m${err.message}\x1b[0m`);
  }
}

function expectStatus(res, codes, label) {
  const arr = Array.isArray(codes) ? codes : [codes];
  if (!arr.includes(res.status)) {
    throw new Error(`${label}: esperado ${arr.join('/')}, recibido ${res.status} · ${JSON.stringify(res.data).slice(0, 150)}`);
  }
}

async function run() {
  console.log(`\nCRM-ISEIE · Tests RBAC contra ${BASE_URL}\n`);

  const loginRes = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (loginRes.status !== 200) {
    console.error('Login fallido:', loginRes.status, loginRes.data);
    process.exit(1);
  }
  accessToken = loginRes.data.data.accessToken;
  const user = loginRes.data.data.user;
  projectId = loginRes.data.data.projects?.[0]?.id;
  console.log(`  Login OK como ${user.email} (role=${user.role}) · proyecto: ${projectId}\n`);

  if (user.role !== 'gestor') {
    console.error(`ERROR: usuario es role=${user.role}, esperado 'gestor'. Aborto.`);
    process.exit(1);
  }

  console.log('─── Endpoints PERMITIDOS al gestor ───');
  await test('GET /leads (asignados) → 200', async () => {
    const r = await api('GET', `/leads?projectId=${projectId}&limit=5`);
    expectStatus(r, 200, '/leads');
  });
  await test('GET /products → 200', async () => {
    const r = await api('GET', `/products?projectId=${projectId}`);
    expectStatus(r, 200, '/products');
  });
  await test('GET /conversions → 200', async () => {
    const r = await api('GET', `/conversions?projectId=${projectId}`);
    expectStatus(r, 200, '/conversions');
  });
  await test('GET /commissions/me → 200 (sus propias comisiones)', async () => {
    const r = await api('GET', '/commissions/me');
    expectStatus(r, 200, '/commissions/me');
  });
  await test('GET /leads/today → 200 (notificaciones)', async () => {
    const r = await api('GET', `/leads/today?projectId=${projectId}`);
    expectStatus(r, 200, '/leads/today');
  });

  console.log('\n─── Endpoints DENEGADOS al gestor (deben dar 403) ───');
  await test('GET /credentials → 403', async () => {
    const r = await api('GET', '/credentials');
    expectStatus(r, 403, '/credentials');
  });
  await test('GET /accounting/dashboard → 403', async () => {
    const r = await api('GET', `/accounting/dashboard?projectId=${projectId}`);
    expectStatus(r, 403, '/accounting/dashboard');
  });
  await test('GET /expenses → 403', async () => {
    const r = await api('GET', `/expenses?projectId=${projectId}`);
    expectStatus(r, 403, '/expenses');
  });
  await test('GET /users → 403 (gestión usuarios)', async () => {
    const r = await api('GET', '/users');
    expectStatus(r, 403, '/users');
  });
  await test('GET /users/availability → 403', async () => {
    const r = await api('GET', '/users/availability');
    expectStatus(r, 403, '/users/availability');
  });
  await test('POST /users → 403 (crear usuario)', async () => {
    const r = await api('POST', '/users', { nombre: 'X', email: 'x@x.com', role: 'gestor', projectIds: [projectId] });
    expectStatus(r, 403, 'POST /users');
  });
  await test('POST /payroll/periods/generate → 403 (acción admin)', async () => {
    const r = await api('POST', '/payroll/periods/generate', { projectId, mes: '2026-05' });
    expectStatus(r, 403, 'POST /payroll/periods/generate');
  });
  await test('GET /commissions/rules → 403 (gestión reglas)', async () => {
    const r = await api('GET', '/commissions/rules');
    expectStatus(r, 403, '/commissions/rules');
  });
  await test('POST /products → 403 (crear producto)', async () => {
    const r = await api('POST', '/products', { projectId, nombre: 'Test' });
    expectStatus(r, 403, 'POST /products');
  });
  await test('GET /reports → 403', async () => {
    const r = await api('GET', '/reports');
    expectStatus(r, 403, '/reports');
  });
  await test('GET /leads/spam-reports → 403 (revisión spam admin)', async () => {
    const r = await api('GET', '/leads/spam-reports');
    expectStatus(r, 403, '/leads/spam-reports');
  });
  await test('POST /forms → 403 (crear formulario)', async () => {
    const r = await api('POST', '/forms', { nombre: 'X', projectId });
    expectStatus(r, 403, 'POST /forms');
  });
  await test('POST /dossiers/upload → 403 (subir dossier admin)', async () => {
    const r = await api('POST', '/dossiers/upload', { productId: 1, projectId });
    expectStatus(r, 403, 'POST /dossiers/upload');
  });

  console.log('\n─── Permitido: ver/operar SUS propios datos ───');
  await test('GET /auth/me → 200', async () => {
    const r = await api('GET', '/auth/me');
    expectStatus(r, 200, '/auth/me');
  });
  await test('GET /commissions/me/stats → 200', async () => {
    const r = await api('GET', '/commissions/me/stats');
    expectStatus(r, 200, '/commissions/me/stats');
  });

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Resumen RBAC: ${ok}/${results.length} OK, ${fail} FAIL`);
  if (fail > 0) {
    console.log('\nFalladas:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name}\n    ${r.error}`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
