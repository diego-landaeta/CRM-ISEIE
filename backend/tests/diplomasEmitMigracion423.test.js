import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { abrir } from './helpers/migracion222Aparte.js';

/**
 * #423, QA de Diego (22/10) · punto 1. `diplomas.emit` (#437/#438) está en
 * producción: hay gestoras que emiten diplomas con ese permiso (Dayana). La 239
 * no lo conocía, lo trataba como una clave «sin efecto» y lo archivaba y
 * borraba. Ahora se queda tal cual: la clave se llama igual en el catálogo.
 *
 * Y como con `diplomas.view`: el «no» que el rol tapaba (a un admin, quitarle
 * emitir no le quitaba nada: entraba por su rol) se archiva, para que el
 * catálogo nuevo no se lo quite ahora.
 */

let m;
let gestora;
let admin;

beforeAll(async () => {
  m = await abrir();
  [gestora] = await m.q(`INSERT INTO users (nombre, email, password_hash, role, usa_whatsapp) VALUES ('Dayana prueba', 'dayana@prueba.test', 'x', 'gestor', true) RETURNING id`);
  [admin] = await m.q(`INSERT INTO users (nombre, email, password_hash, role, usa_whatsapp) VALUES ('Admin prueba', 'admin@prueba.test', 'x', 'admin', true) RETURNING id`);
  await m.q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed)
             VALUES ($1, 'diplomas', 'emit', true), ($1, 'diplomas', 'view', true), ($2, 'diplomas', 'emit', false)`,
  [gestora.id, admin.id]);
  await m.pasar();
  await m.pasar();
}, 60000);

afterAll(async () => { await m?.cerrar(); });

const suyas = (id) => m.q(`SELECT resource || '.' || action AS clave, allowed FROM user_permission_overrides WHERE user_id = $1 ORDER BY 1`, [id]);

describe('la 239 y «Diplomas · Emitir» (#423, punto 1)', () => {
  it('la gestora que emite sigue emitiendo: su excepción se queda', async () => {
    expect(await suyas(gestora.id)).toEqual([
      { clave: 'diplomas.emit', allowed: true },
      { clave: 'diplomas.view', allowed: true },
    ]);
    expect(await m.q('SELECT clave FROM permisos_inertes_archivo WHERE usuario_id = $1', [gestora.id])).toEqual([]);
  });

  it('al admin, el «no» que su rol tapaba se archiva (no le quita emitir)', async () => {
    expect(await suyas(admin.id)).toEqual([]);
    expect(await m.q('SELECT clave, valor FROM permisos_inertes_archivo WHERE usuario_id = $1', [admin.id]))
      .toEqual([{ clave: 'diplomas.emit', valor: false }]);
  });
});
