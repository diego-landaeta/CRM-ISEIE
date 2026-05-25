#!/usr/bin/env node
// Orquestador de tests de integración. Crea usuarios temporales (superadmin
// y gestor) en el VPS via SSH, corre la suite CRUD + RBAC contra producción,
// y al final los elimina pase lo que pase.
//
// Requiere acceso SSH a root@72.60.90.135 (ya configurado con clave pública).
//
// Uso: npm run test:integration   (desde backend/) o
//      node scripts/run-integration-tests.mjs    (desde raíz del repo)

import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VPS = 'root@72.60.90.135';
const BASE_URL = process.env.CRM_BASE_URL || 'https://crm.iseie.com';

const SUPERADMIN_EMAIL = 'crud-test-temp@iseie.test';
const SUPERADMIN_PASSWORD = 'TestCRM_2026!';
const GESTOR_EMAIL = 'crud-test-gestor@iseie.test';
const GESTOR_PASSWORD = 'GestorTest2026!';

function ssh(cmd) {
  return execSync(`ssh ${VPS} "${cmd}"`, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

function runNode(scriptPath, env) {
  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    proc.on('exit', (code) => resolve(code));
  });
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  CRM-ISEIE · Suite de integración (CRUD + RBAC)            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ─── Setup: crear usuarios temporales ─────────────────────
  console.log('→ Creando usuario superadmin temporal en VPS…');
  ssh('cd /opt/crm-iseie && node scripts/create-test-user.mjs');
  console.log('→ Creando usuario gestor temporal en VPS…');
  ssh('cd /opt/crm-iseie && node scripts/create-test-gestor.mjs');

  let crudCode = 1, rbacCode = 1;

  try {
    // ─── Suite CRUD ───────────────────────────────────────────
    console.log('\n┌─ CRUD suite ─────────────────────────────────────────────┐');
    crudCode = await runNode('scripts/test-crud.mjs', {
      CRM_EMAIL: SUPERADMIN_EMAIL,
      CRM_PASSWORD: SUPERADMIN_PASSWORD,
      CRM_BASE_URL: BASE_URL,
    });
    console.log('└──────────────────────────────────────────────────────────┘');

    // ─── Suite RBAC ───────────────────────────────────────────
    console.log('\n┌─ RBAC suite ─────────────────────────────────────────────┐');
    rbacCode = await runNode('scripts/test-rbac.mjs', {
      GESTOR_EMAIL: GESTOR_EMAIL,
      GESTOR_PASSWORD: GESTOR_PASSWORD,
      CRM_BASE_URL: BASE_URL,
    });
    console.log('└──────────────────────────────────────────────────────────┘');
  } finally {
    // ─── Cleanup: borrar usuarios temporales ─────────────────
    console.log('\n→ Limpiando usuarios temporales…');
    try {
      ssh(`sudo -u postgres psql -d crm_iseie -tAc \\"DELETE FROM users WHERE email IN ('${SUPERADMIN_EMAIL}', '${GESTOR_EMAIL}') RETURNING email;\\"`);
      console.log('  ✓ Usuarios eliminados');
    } catch (err) {
      console.log('  ⚠ No se pudieron eliminar usuarios:', err.message);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`CRUD:  ${crudCode === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
  console.log(`RBAC:  ${rbacCode === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  process.exit(crudCode === 0 && rbacCode === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
