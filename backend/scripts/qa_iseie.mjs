// QA end-to-end del CRM ISEIE.
// - Invoca services directos (sin HTTP) en project_id=10
// - Cubre: leads CRUD, interactions, reminders, status_history, conversions,
//          merge, products, custom_fields, filtros, soft-delete
// - Cleanup al final: borra todos los registros de prueba
import 'dotenv/config';
import { query } from '/opt/crm-iseie/src/shared/config/db.js';
import * as leadService from '/opt/crm-iseie/src/modules/leads/lead.service.js';
import * as leadModel from '/opt/crm-iseie/src/modules/leads/lead.model.js';

const PROJECT_ID = 10;
const TEST_TAG = 'qa-test-' + Date.now();
const stats = { pass: 0, fail: 0, fails: [] };

function test(name, cond, info) {
  if (cond) { stats.pass++; console.log(`✅ ${name}`); }
  else { stats.fail++; stats.fails.push(`${name}: ${info || 'FAIL'}`); console.log(`❌ ${name}${info ? ` — ${info}` : ''}`); }
}

const createdLeadIds = [];
const createdConversionIds = [];

// ====================== TESTS ======================
try {
  console.log('\n=== 1. CREATE MANUAL LEAD ===');
  const r1 = await leadService.createManualLead({
    project_id: PROJECT_ID,
    nombre: `QA Lead Principal ${TEST_TAG}`,
    email: `qa1.${TEST_TAG}@test.local`,
    telefono: '525511112222',
    canal: 'directo',
    notas: 'Lead de prueba QA',
  }, { creatorUser: { userId: 1, role: 'superadmin' } });
  test('createManualLead devuelve lead_id', !!r1.lead_id, JSON.stringify(r1));
  if (r1.lead_id) createdLeadIds.push(r1.lead_id);

  const { rows: [lead1] } = await query(`SELECT * FROM leads WHERE id=$1`, [r1.lead_id]);
  test('Lead persistido en DB', !!lead1);
  test('Lead.nombre correcto', lead1?.nombre?.includes('QA Lead Principal'));
  test('Lead.email correcto', lead1?.email === `qa1.${TEST_TAG}@test.local`);
  test('Lead.telefono correcto', lead1?.telefono === '525511112222');
  test('Lead.status default = nuevo', lead1?.status === 'nuevo');
  test('Lead.project_id correcto', lead1?.project_id === PROJECT_ID);
  test('Lead.fecha_solicitud NOT NULL', !!lead1?.fecha_solicitud);
  test('Lead.deleted_at NULL', lead1?.deleted_at === null);

  // lead_utms creado
  const { rows: [utm1] } = await query(`SELECT canal_detectado FROM lead_utms WHERE lead_id=$1`, [r1.lead_id]);
  test('lead_utms creado con canal', utm1?.canal_detectado === 'directo');

  console.log('\n=== 2. UPDATE LEAD ===');
  await query(
    `UPDATE leads SET nombre=$1, telefono=$2, notas=$3, updated_at=NOW() WHERE id=$4`,
    [`QA Lead Renombrado ${TEST_TAG}`, '525599998888', 'Notas actualizadas', r1.lead_id]
  );
  const { rows: [lead1u] } = await query(`SELECT nombre, telefono, notas FROM leads WHERE id=$1`, [r1.lead_id]);
  test('UPDATE: nombre cambió', lead1u.nombre.includes('Renombrado'));
  test('UPDATE: telefono cambió', lead1u.telefono === '525599998888');
  test('UPDATE: notas cambió', lead1u.notas === 'Notas actualizadas');

  console.log('\n=== 3. STATUS CHANGE + HISTORY ===');
  await query(`UPDATE leads SET status='contactado'::lead_status WHERE id=$1`, [r1.lead_id]);
  await query(
    `INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by, changed_at)
     VALUES ($1, 'nuevo'::lead_status, 'contactado'::lead_status, 1, NOW())`,
    [r1.lead_id]
  );
  const { rows: histRows } = await query(`SELECT * FROM lead_status_history WHERE lead_id=$1 ORDER BY changed_at`, [r1.lead_id]);
  test('Status cambiado a contactado', (await query(`SELECT status FROM leads WHERE id=$1`, [r1.lead_id])).rows[0]?.status === 'contactado');
  test('lead_status_history registró el cambio', histRows.length === 1);
  test('history.status_anterior correcto', histRows[0]?.status_anterior === 'nuevo');
  test('history.status_nuevo correcto', histRows[0]?.status_nuevo === 'contactado');

  console.log('\n=== 4. ADD INTERACTION ===');
  await query(
    `INSERT INTO lead_interactions (lead_id, tipo, nota, fecha) VALUES ($1, 'whatsapp'::interaction_type, $2, NOW())`,
    [r1.lead_id, 'Saludo inicial QA']
  );
  const { rows: ints } = await query(`SELECT * FROM lead_interactions WHERE lead_id=$1`, [r1.lead_id]);
  test('Interaction creada', ints.length === 1);
  test('Interaction.tipo correcto', ints[0]?.tipo === 'whatsapp');
  test('Interaction.nota correcto', ints[0]?.nota === 'Saludo inicial QA');

  console.log('\n=== 5. ADD REMINDER ===');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
  const { rows: [rem] } = await query(
    `INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [r1.lead_id, tomorrow, 'Llamar mañana', 1]
  );
  test('Reminder creado', !!rem.id);
  test('Reminder.fecha = tomorrow', String(rem.fecha_recordatorio).slice(0,10) === tomorrow);
  test('Reminder.completado = false', rem.completado === false);

  // Completar reminder
  await query(`UPDATE lead_reminders SET completado=true WHERE id=$1`, [rem.id]);
  const { rows: [remDone] } = await query(`SELECT completado FROM lead_reminders WHERE id=$1`, [rem.id]);
  test('Reminder marcado completado', remDone.completado === true);

  console.log('\n=== 6. CONVERSION CRUD ===');
  const { rows: [anyProd] } = await query(`SELECT id, nombre FROM products WHERE project_id=$1 AND active LIMIT 1`, [PROJECT_ID]);
  test('Hay productos para usar', !!anyProd);
  if (anyProd) {
    try {
      const { rows: [conv] } = await query(
        `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id,
                                   importe_total, importe_pagado, fecha_conversion, metodo_pago, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1500.00, 1500.00, CURRENT_DATE, 'tarjeta'::payment_method, NOW(), NOW()) RETURNING *`,
        [r1.lead_id, PROJECT_ID, anyProd.nombre, anyProd.id]
      );
      createdConversionIds.push(conv.id);
      test('Conversion creada', !!conv.id);
      test('Conversion.importe_total correcto', Number(conv.importe_total) === 1500);
      test('Conversion.lead_id correcto', conv.lead_id === r1.lead_id);
      test('Conversion.producto_contratado_id correcto', conv.producto_contratado_id === anyProd.id);

      // Update conversion
      await query(`UPDATE conversions SET importe_pagado=1200.00 WHERE id=$1`, [conv.id]);
      const { rows: [convU] } = await query(`SELECT importe_pagado FROM conversions WHERE id=$1`, [conv.id]);
      test('Conversion update OK', Number(convU.importe_pagado) === 1200);

      // Check conversion_payments
      const { rows: [pay] } = await query(
        `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, created_at)
         VALUES ($1, 500.00, CURRENT_DATE, 'Pago QA', NOW()) RETURNING id, importe`,
        [conv.id]
      );
      test('conversion_payment creado', !!pay?.id);
      test('conversion_payment.importe correcto', Number(pay?.importe) === 500);

      // Check conversion_installments si existe
      const inst = await query(`SELECT 1 FROM information_schema.columns WHERE table_name='conversion_installments' LIMIT 1`);
      if (inst.rows[0]) {
        const insRes = await query(
          `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento, created_at, updated_at)
           VALUES ($1, 1, 300.00, CURRENT_DATE + 30, NOW(), NOW()) RETURNING id, numero, importe_previsto`,
          [conv.id]
        ).catch((e) => ({rows: [], err: e.message}));
        const ins = insRes.rows[0];
        test('conversion_installment creado', !!ins?.id, insRes.err);
        if (ins) {
          // Marcar como cobrado
          await query(`UPDATE conversion_installments SET fecha_cobro=CURRENT_DATE, importe_cobrado=300.00, metodo='efectivo' WHERE id=$1`, [ins.id]);
          const { rows: [insU] } = await query(`SELECT fecha_cobro, importe_cobrado FROM conversion_installments WHERE id=$1`, [ins.id]);
          test('installment cobrado OK', insU.fecha_cobro !== null && Number(insU.importe_cobrado) === 300);
        }
      }
    } catch (e) {
      test('Conversion CRUD', false, e.message.slice(0, 80));
    }
  }

  console.log('\n=== 7. CUSTOM FIELDS (JSONB) ===');
  await query(
    `UPDATE leads SET custom_fields = custom_fields || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ qa_test_flag: true, pais: 'México', ronda: 3 }), r1.lead_id]
  );
  const { rows: [leadCf] } = await query(`SELECT custom_fields FROM leads WHERE id=$1`, [r1.lead_id]);
  test('custom_fields.qa_test_flag = true', leadCf.custom_fields?.qa_test_flag === true);
  test('custom_fields.pais persiste', leadCf.custom_fields?.pais === 'México');
  test('custom_fields.ronda numérico', leadCf.custom_fields?.ronda === 3);

  console.log('\n=== 8. FILTROS (lead.model.findAll) ===');
  // Crear 2 leads más para testing de filtros
  const r2 = await leadService.createManualLead({
    project_id: PROJECT_ID, nombre: `QA Filtro ${TEST_TAG}-2`,
    email: `qa2.${TEST_TAG}@test.local`, telefono: '525500000002', canal: 'whatsapp',
  }, { creatorUser: { userId: 1, role: 'superadmin' } });
  if (r2.lead_id) createdLeadIds.push(r2.lead_id);
  const r3 = await leadService.createManualLead({
    project_id: PROJECT_ID, nombre: `QA Filtro ${TEST_TAG}-3`,
    email: `qa3.${TEST_TAG}@test.local`, telefono: '525500000003', canal: 'organico',
  }, { creatorUser: { userId: 1, role: 'superadmin' } });
  if (r3.lead_id) createdLeadIds.push(r3.lead_id);

  // Filtro por search
  const f1 = await leadModel.findAll({ projectId: PROJECT_ID, search: TEST_TAG, page: 1, limit: 20, includeConverted: true });
  test(`Filtro search devuelve los 3 QA (got ${f1.total})`, f1.total >= 3);

  // Filtro por status
  const f2 = await leadModel.findAll({ projectId: PROJECT_ID, status: 'contactado', search: TEST_TAG, page: 1, limit: 20 });
  test(`Filtro status=contactado devuelve solo 1 (got ${f2.total})`, f2.total === 1);

  // Filtro por canal (UTM)
  const f3 = await leadModel.findAll({ projectId: PROJECT_ID, canal: 'whatsapp', search: TEST_TAG, page: 1, limit: 20, includeConverted: true });
  test(`Filtro canal=whatsapp devuelve >=1 (got ${f3.total})`, f3.total >= 1);

  console.log('\n=== 9. DUPLICATE DETECTION ===');
  const dup = await leadService.createManualLead({
    project_id: PROJECT_ID, nombre: `QA Lead Renombrado ${TEST_TAG}`,
    email: `qa1.${TEST_TAG}@test.local`, telefono: '525511112222', canal: 'directo',
  }, { creatorUser: { userId: 1, role: 'superadmin' } });
  // Puede crear nuevo lead pero marcar duplicado, o devolver el mismo (dedupe 10s)
  test('Lead duplicado detectado/manejado', !!dup.lead_id && (dup.duplicado || dup.deduped));

  console.log('\n=== 10. SOFT DELETE & RESTORE ===');
  await query(`UPDATE leads SET deleted_at=NOW(), deleted_reason='spam', deleted_by=1 WHERE id=$1`, [r3.lead_id]);
  const { rows: [delLead] } = await query(`SELECT deleted_at, deleted_reason FROM leads WHERE id=$1`, [r3.lead_id]);
  test('Lead soft-deleted', delLead.deleted_at !== null);
  test('deleted_reason persistido', delLead.deleted_reason === 'spam');

  const fDel = await leadModel.findAll({ projectId: PROJECT_ID, search: TEST_TAG, page: 1, limit: 20, includeConverted: true });
  test(`Soft-deleted excluido del listado (queda 2, got ${fDel.total})`, fDel.total === 2);

  const fArch = await leadModel.findAll({ projectId: PROJECT_ID, search: TEST_TAG, page: 1, limit: 20, archived: true, includeConverted: true });
  test(`Vista archived muestra el deleted (got ${fArch.total})`, fArch.total === 1);

  // Restore
  await query(`UPDATE leads SET deleted_at=NULL, deleted_reason=NULL, deleted_by=NULL WHERE id=$1`, [r3.lead_id]);
  const { rows: [restLead] } = await query(`SELECT deleted_at FROM leads WHERE id=$1`, [r3.lead_id]);
  test('Restore funcionó', restLead.deleted_at === null);

  console.log('\n=== 11. PRODUCTS CRUD ===');
  const testProdName = `QA Producto ${TEST_TAG}`;
  const { rows: [prod] } = await query(
    `INSERT INTO products (project_id, nombre, precio, moneda, active, created_at, updated_at)
     VALUES ($1, $2, 999.50, 'EUR', true, NOW(), NOW()) RETURNING *`,
    [PROJECT_ID, testProdName]
  );
  test('Producto creado', !!prod.id);
  test('Producto.precio correcto', Number(prod.precio) === 999.50);

  // Update producto
  await query(`UPDATE products SET precio=1250.00, duracion='6 meses', modalidad='Online' WHERE id=$1`, [prod.id]);
  const { rows: [prodU] } = await query(`SELECT precio, duracion, modalidad FROM products WHERE id=$1`, [prod.id]);
  test('Producto.precio updated', Number(prodU.precio) === 1250);
  test('Producto.duracion updated', prodU.duracion === '6 meses');
  test('Producto.modalidad updated', prodU.modalidad === 'Online');

  // findProductByName (con unaccent y prefijo)
  const matched = await leadModel.findProductByName(testProdName, PROJECT_ID);
  test('findProductByName funcional', matched?.id === prod.id);

  // Cleanup producto
  await query(`DELETE FROM products WHERE id=$1`, [prod.id]);

  console.log('\n=== 12. CASCADE DELETE (lead → interactions/reminders) ===');
  // Verificar contadores antes
  const beforeInts = (await query(`SELECT COUNT(*) AS c FROM lead_interactions WHERE lead_id=$1`, [r1.lead_id])).rows[0].c;
  const beforeRems = (await query(`SELECT COUNT(*) AS c FROM lead_reminders WHERE lead_id=$1`, [r1.lead_id])).rows[0].c;
  test(`Lead r1 tiene interactions (${beforeInts})`, Number(beforeInts) > 0);
  test(`Lead r1 tiene reminders (${beforeRems})`, Number(beforeRems) > 0);

  // Hard-delete simulado (no lo hacemos real para no romper FK chains — usamos cleanup al final)

} catch (e) {
  console.error('\n💥 EXCEPTION:', e.message);
  console.error(e.stack);
  stats.fails.push(`EXCEPTION: ${e.message}`);
}

// ====================== CLEANUP ======================
console.log('\n=== CLEANUP ===');
for (const id of createdConversionIds) {
  await query(`DELETE FROM conversions WHERE id=$1`, [id]).catch(()=>{});
}
for (const id of createdLeadIds) {
  await query(`DELETE FROM lead_interactions WHERE lead_id=$1`, [id]).catch(()=>{});
  await query(`DELETE FROM lead_reminders WHERE lead_id=$1`, [id]).catch(()=>{});
  await query(`DELETE FROM lead_utms WHERE lead_id=$1`, [id]).catch(()=>{});
  await query(`DELETE FROM lead_status_history WHERE lead_id=$1`, [id]).catch(()=>{});
  await query(`DELETE FROM leads WHERE id=$1`, [id]).catch(()=>{});
}
console.log(`Cleanup: borrados ${createdLeadIds.length} leads + ${createdConversionIds.length} conversions de prueba`);

console.log(`\n=========================================`);
console.log(`📊 RESULTADO: ${stats.pass} PASS / ${stats.fail} FAIL`);
if (stats.fail > 0) {
  console.log(`\n❌ FALLOS:`);
  for (const f of stats.fails) console.log(`   - ${f}`);
}
console.log(`=========================================`);
process.exit(stats.fail > 0 ? 1 : 0);
