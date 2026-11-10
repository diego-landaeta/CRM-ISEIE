import { describe, it, expect, vi } from 'vitest';

/**
 * CRM#632 / ISEIE#359 · El admin ve las claves, con lo de SUS campus.
 *
 * La auditoría del 03/11 encontró que en Informes el admin pedía
 * `/credentials` (para saber si la clave de Claude está puesta) y le daba 403.
 * Diego: «el admin debe ver todo de todo», cada uno con los datos de sus
 * campus. `credentials.view` pasa a traerlo el admin, y el servidor recorta:
 *
 *   · superadmin y soporte, todo, como antes;
 *   · el admin, las de sus campus y que existen las generales (la de Claude),
 *     sin los últimos caracteres de esas.
 *
 * Es la misma que la del 360, sin la paridad ni el registro, que aquí no hay.
 *
 *   npx vitest run tests/clavesDelAdmin632.test.js
 */

const FILAS = [
  { id: 1, project_id: null, service: 'claude', masked_value: 'sk-a••••AbCd' },
  { id: 2, project_id: 7, service: 'brevo', masked_value: 'xkey••••x7x7' },
  { id: 3, project_id: 9, service: 'brevo', masked_value: 'xkey••••y9y9' },
];

vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../src/modules/credentials/credentials.model.js', () => ({
  list: vi.fn(async () => FILAS),
}));
vi.mock('../src/shared/utils/ambito.js', () => ({
  veTodoElCrm: (u) => ['superadmin', 'soporte'].includes(u?.role),
  campusDeLaPersona: vi.fn(async () => [7]),
}));

const ctrl = await import('../src/modules/credentials/credentials.controller.js');

async function lista(role) {
  let cuerpo = null; let error = null;
  await ctrl.list({ user: { userId: 5, role }, query: {} }, { json: (b) => { cuerpo = b; } }, (e) => { error = e; });
  if (error) throw error;
  return cuerpo.data;
}

describe('la lista de claves', () => {
  it('superadmin y soporte, todas y con su máscara', async () => {
    for (const role of ['superadmin', 'soporte']) {
      const d = await lista(role);
      expect(d.map((c) => c.id)).toEqual([1, 2, 3]);
      expect(d[0].masked_value).toMatch(/AbCd/);
    }
  });

  it('el admin, las de sus campus y las generales, sin campus ajenos', async () => {
    expect((await lista('admin')).map((c) => c.id)).toEqual([1, 2]);
  });

  it('la de Claude le sale (Informes la pregunta), sin sus caracteres', async () => {
    const d = await lista('admin');
    const claude = d.find((c) => c.service === 'claude');
    expect(claude).toBeTruthy();
    expect(claude.masked_value).not.toMatch(/AbCd/);
    expect(d.find((c) => c.id === 2).masked_value).toMatch(/x7x7/);
  });
});

describe('el catálogo (#423)', () => {
  it('ver claves lo trae el admin; guardarlas, no', async () => {
    const { SECCIONES } = await import('../src/modules/permissions/catalogo.js');
    const recurso = SECCIONES.flatMap((s) => s.recursos).find((r) => r.clave === 'credentials');
    const accion = (a) => recurso.acciones.find((x) => x.accion === a);
    expect(accion('view').roles).toContain('admin');
    expect(accion('edit').roles).not.toContain('admin');
  });
});
