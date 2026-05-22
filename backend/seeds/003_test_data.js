#!/usr/bin/env node
// Seed test data — leads + products + conversions + expenses por proyecto.
// Idempotente: detecta su marca (notas LIKE '[seed-test]%') y omite si ya hay datos.
// Uso:
//   node seeds/003_test_data.js                  → siembra
//   node seeds/003_test_data.js --reset          → borra solo los datos del seed
//   node seeds/003_test_data.js --project iseie-es  → solo un país
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, getClient } from '../src/shared/config/db.js';

const TAG = '[seed-test]';
const PASSWORD = 'Test1234!';

const args = process.argv.slice(2);
const RESET = args.includes('--reset');
const PROJECT_FILTER = (() => {
  const i = args.indexOf('--project');
  return i >= 0 ? args[i + 1] : null;
})();

const PRODUCT_TEMPLATES = [
  { nombre: 'Máster en Gestión Educativa',       precio: 3400 },
  { nombre: 'Máster en Psicopedagogía Clínica',  precio: 3200 },
  { nombre: 'Máster en RR.HH. y Desarrollo',     precio: 3000 },
  { nombre: 'Diplomado en Liderazgo Pedagógico', precio: 1200 },
  { nombre: 'Curso Experto en Coaching',         precio:  890 },
  { nombre: 'Curso de Inteligencia Emocional',   precio:  450 },
];

const FIRST_NAMES = [
  'Lucía', 'María', 'Carmen', 'Ana', 'Sofía', 'Elena', 'Paula', 'Andrea',
  'Diego', 'Carlos', 'Javier', 'Pablo', 'Luis', 'Sergio', 'Miguel', 'David',
  'Camila', 'Valentina', 'Mateo', 'Santiago', 'Tomás', 'Daniela',
];
const LAST_NAMES = [
  'García', 'Rodríguez', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez',
  'Fernández', 'Hernández', 'Jiménez', 'Ruiz', 'Torres', 'Vargas', 'Castillo',
  'Romero', 'Ramos', 'Reyes', 'Alvarez', 'Mendoza', 'Suárez',
];
const CANALES = ['web', 'instagram', 'facebook', 'whatsapp', 'recomendacion', 'google'];
const STATUSES = ['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'convertido', 'no_interesado'];
const PAYMENT_METHODS = ['transferencia', 'tarjeta', 'efectivo', 'fraccionado'];
const EXPENSE_CATEGORIES = ['salarios', 'alquiler', 'proveedores', 'software', 'publicidad', 'impuestos', 'servicios'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

function makeName() {
  return `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)} ${rand(LAST_NAMES)}`;
}

function makeEmail(name, projectSlug) {
  const slug = name.toLowerCase().replace(/\s+/g, '.').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return `${slug}.${randInt(100, 999)}@test-${projectSlug}.iseie.test`;
}

function makePhone(projectSlug) {
  const prefixes = { 'iseie-es': '+34', 'iseie-mx': '+52', 'iseie-co': '+57', 'iseie-cl': '+56',
    'iseie-ec': '+593', 'iseie-pe': '+51', 'iseie-pa': '+507', 'iseie-cr': '+506',
    'iseie-ar': '+54', 'iseie-br': '+55', 'iseie-cn': '+86' };
  const p = prefixes[projectSlug] || '+34';
  return `${p} ${randInt(600, 699)} ${randInt(100, 999)} ${randInt(100, 999)}`;
}

async function resetSeed(client) {
  console.log(`${TAG} reset: borrando datos de prueba`);
  await client.query(`DELETE FROM expenses WHERE notas LIKE '${TAG}%'`);
  await client.query(`DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions c JOIN leads l ON l.id = c.lead_id WHERE l.notas LIKE '${TAG}%')`);
  await client.query(`DELETE FROM conversions WHERE lead_id IN (SELECT id FROM leads WHERE notas LIKE '${TAG}%')`);
  await client.query(`DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE notas LIKE '${TAG}%')`);
  await client.query(`DELETE FROM lead_reminders WHERE lead_id IN (SELECT id FROM leads WHERE notas LIKE '${TAG}%')`);
  await client.query(`DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE notas LIKE '${TAG}%')`);
  await client.query(`DELETE FROM leads WHERE notas LIKE '${TAG}%'`);
  await client.query(`DELETE FROM products WHERE descripcion LIKE '${TAG}%'`);
  await client.query(`DELETE FROM user_projects WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-seed.iseie.test')`);
  await client.query(`DELETE FROM users WHERE email LIKE '%@test-seed.iseie.test'`);
  console.log(`${TAG} reset OK`);
}

async function ensureTestGestores(client, project) {
  // 2 gestores de test por proyecto. Idempotente.
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const gestores = [
    { nombre: `Gestor Uno (${project.slug})`, email: `gestor1.${project.slug}@test-seed.iseie.test` },
    { nombre: `Gestor Dos (${project.slug})`, email: `gestor2.${project.slug}@test-seed.iseie.test` },
  ];
  const ids = [];
  for (const g of gestores) {
    const { rows } = await client.query(
      `INSERT INTO users (nombre, email, password_hash, role, active)
       VALUES ($1, $2, $3, 'gestor', true)
       ON CONFLICT (email) DO UPDATE SET active = true
       RETURNING id`,
      [g.nombre, g.email, passwordHash]
    );
    const userId = rows[0].id;
    await client.query(
      `INSERT INTO user_projects (user_id, project_id, orden_cola, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, project_id) DO UPDATE SET active = true`,
      [userId, project.id, ids.length]
    );
    ids.push(userId);
  }
  return ids;
}

async function seedProducts(client, project) {
  const products = [];
  for (const t of PRODUCT_TEMPLATES) {
    const { rows } = await client.query(
      `INSERT INTO products (project_id, nombre, descripcion, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING
       RETURNING id, nombre`,
      [project.id, t.nombre, `${TAG} ${t.precio} EUR`]
    );
    if (rows[0]) products.push({ ...rows[0], precio: t.precio });
    else {
      const { rows: existing } = await client.query(
        `SELECT id, nombre FROM products WHERE project_id = $1 AND nombre = $2 LIMIT 1`,
        [project.id, t.nombre]
      );
      if (existing[0]) products.push({ ...existing[0], precio: t.precio });
    }
  }
  return products;
}

async function seedLeads(client, project, gestores, products, count = 30) {
  let createdLeads = 0;
  let createdConversions = 0;
  let createdPayments = 0;

  for (let i = 0; i < count; i++) {
    const nombre = makeName();
    const email = makeEmail(nombre, project.slug);
    const telefono = makePhone(project.slug);
    const status = i < count * 0.3 ? 'nuevo'
      : i < count * 0.5 ? 'por_contactar'
      : i < count * 0.65 ? 'contactado'
      : i < count * 0.8 ? 'en_seguimiento'
      : i < count * 0.95 ? 'convertido'
      : 'no_interesado';
    const canal = rand(CANALES);
    const responsable = rand(gestores);
    const producto = rand(products);
    const fechaSolicitud = daysAgo(randInt(0, 180));

    const { rows } = await client.query(
      `INSERT INTO leads (project_id, nombre, email, telefono, producto_interes_id,
          status, responsable_id, notas, landing_url, fecha_solicitud)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [project.id, nombre, email, telefono, producto.id, status, responsable,
       `${TAG} canal=${canal}`, `https://iseie.com/${producto.nombre.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '')}`,
       fechaSolicitud]
    );
    const leadId = rows[0].id;
    createdLeads++;

    // Algunas interactions para los contactados
    if (['contactado', 'en_seguimiento', 'convertido'].includes(status)) {
      await client.query(
        `INSERT INTO lead_interactions (lead_id, created_by, fecha, tipo, nota)
         VALUES ($1, $2, $3, 'llamada', $4)`,
        [leadId, responsable, daysAgo(randInt(1, 30)), `${TAG} primer contacto`]
      );
    }

    // Recordatorio para algunos en_seguimiento
    if (status === 'en_seguimiento' && Math.random() > 0.5) {
      await client.query(
        `INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, completado)
         VALUES ($1, $2, $3, false)`,
        [leadId, daysAgo(randInt(-7, 3)), `${TAG} llamar de nuevo`]
      );
    }

    // Conversiones para 'convertido'
    if (status === 'convertido') {
      const importe = producto.precio + randInt(-200, 0);
      const metodo = rand(PAYMENT_METHODS);
      const fechaConversion = daysAgo(randInt(0, 90));
      const isPagado = Math.random() < 0.55;
      const isParcial = !isPagado && Math.random() < 0.6;
      const pagado = isPagado ? importe : isParcial ? Math.round(importe * (0.3 + Math.random() * 0.4)) : 0;

      const { rows: cRows } = await client.query(
        `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, metodo_pago, fecha_conversion, fecha_compromiso_pago, notas_pago)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [leadId, project.id, producto.nombre, importe, pagado, metodo, fechaConversion,
         daysAgo(randInt(-30, 30)), `${TAG} conversion test`]
      );
      const conversionId = cRows[0].id;
      createdConversions++;

      // Algunos pagos parciales registrados
      if (pagado > 0) {
        const numPagos = isPagado ? randInt(1, 2) : 1;
        const importePorPago = pagado / numPagos;
        for (let j = 0; j < numPagos; j++) {
          await client.query(
            `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas)
             VALUES ($1, $2, $3, $4)`,
            [conversionId, importePorPago.toFixed(2), daysAgo(randInt(0, 60)),
             `${TAG} REF-${randInt(10000, 99999)} ${metodo}`]
          );
          createdPayments++;
        }
      }
    }
  }

  return { createdLeads, createdConversions, createdPayments };
}

async function seedExpenses(client, project, gestores, count = 12) {
  let created = 0;
  for (let i = 0; i < count; i++) {
    const categoria = rand(EXPENSE_CATEGORIES);
    const concepto = {
      salarios: 'Nómina equipo gestores',
      alquiler: 'Alquiler oficina',
      proveedores: 'Material didáctico',
      software: 'Suscripción CRM/SaaS',
      publicidad: 'Campaña Meta Ads',
      impuestos: 'Pago trimestral IRPF',
      servicios: 'Limpieza y mantenimiento',
    }[categoria] || 'Gasto operativo';
    const importe = categoria === 'salarios' ? randInt(2500, 5000)
      : categoria === 'alquiler' ? randInt(800, 2000)
      : categoria === 'publicidad' ? randInt(500, 3000)
      : randInt(50, 800);
    await client.query(
      `INSERT INTO expenses (project_id, concepto, importe, fecha, categoria, notas, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [project.id, concepto, importe, daysAgo(randInt(0, 180)), categoria,
       `${TAG} gasto operativo`, gestores[0]]
    );
    created++;
  }
  return created;
}

async function seedProject(project) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Si ya hay leads del seed para este proyecto, salir (idempotencia).
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM leads WHERE project_id = $1 AND notas LIKE '${TAG}%'`,
      [project.id]
    );
    if (rows[0].n > 0) {
      console.log(`${TAG} ${project.slug}: ya tiene ${rows[0].n} leads de prueba, saltando`);
      await client.query('ROLLBACK');
      return null;
    }

    const gestores = await ensureTestGestores(client, project);
    const products = await seedProducts(client, project);
    const leadStats = await seedLeads(client, project, gestores, products, 30);
    const expensesCount = await seedExpenses(client, project, gestores, 12);

    await client.query('COMMIT');
    return { project: project.slug, gestores: gestores.length, products: products.length, ...leadStats, expenses: expensesCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  if (RESET) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await resetSeed(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    process.exit(0);
  }

  const projectsQuery = PROJECT_FILTER
    ? `SELECT id, slug FROM projects WHERE slug = $1 AND active = true`
    : `SELECT id, slug FROM projects WHERE active = true AND slug LIKE 'iseie-%' ORDER BY id LIMIT 3`;
  const projectsParams = PROJECT_FILTER ? [PROJECT_FILTER] : [];
  const { rows: projects } = await query(projectsQuery, projectsParams);

  if (projects.length === 0) {
    console.error(`${TAG} no se encontraron proyectos activos${PROJECT_FILTER ? ' con slug=' + PROJECT_FILTER : ''}`);
    process.exit(1);
  }

  console.log(`${TAG} sembrando datos en ${projects.length} proyecto(s)`);
  const results = [];
  for (const p of projects) {
    const r = await seedProject(p);
    if (r) results.push(r);
  }

  console.log('\n=== Resumen ===');
  console.table(results);
  console.log(`\nUsuarios test creados con password: ${PASSWORD}`);
  console.log('Emails: gestor1.<slug>@test-seed.iseie.test, gestor2.<slug>@test-seed.iseie.test');
  console.log(`\nPara revertir: node seeds/003_test_data.js --reset\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} ERROR:`, err);
  process.exit(1);
});
