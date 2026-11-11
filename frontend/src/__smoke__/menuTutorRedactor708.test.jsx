// CRM-ISEIE#420 (gemela de CRM#708) · El menú del «Tutor redactor»: solo lo suyo. Su
// tablero y su factura del mes, como un colaborador, y Consultas y Mis cursos, como un
// tutor. Nada de prospectos, ventas ni finanzas. Con el menú de verdad (NAV_SECTIONS).
import { describe, it, expect } from 'vitest';
import { soloEsTutorRedactor, ROLES_DE_TUTOR } from '@/shared/lib/roles';

const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');

const can = (lista) => (k) => lista.includes(k);
function loQueVe(roles, permisos) {
  const c = can(permisos);
  const pasa = (item) => canSeeItem(item, roles, false, {}, c);
  return NAV_SECTIONS.flatMap((s) => s.items).filter(pasa).flatMap((it) => (it.children ? it.children.filter(pasa) : [it]))
    .map((it) => it.to).filter(Boolean);
}
// Lo que trae de serie (catalogo.js del servidor).
const REDACTOR = ['tasks.view_own', 'tasks.create', 'tasks.edit', 'facturas_colaborador.subir', 'tutores.mis_cursos', 'consultas.atender'];

describe('menú · tutor redactor (CRM-ISEIE#420)', () => {
  it('ve su tablero, «Mi factura», Consultas, Mis cursos y sus preferencias', () => {
    const ve = loQueVe(['tutor_redactor'], REDACTOR);
    expect(ve).toEqual(expect.arrayContaining(['/tareas', '/tareas/historial', '/mi-factura', '/consultas', '/mis-cursos', '/preferencias']));
  });

  it('nada de prospectos, ventas, finanzas ni administración de tutores', () => {
    const ve = loQueVe(['tutor_redactor'], REDACTOR);
    for (const no of ['/dashboard', '/leads', '/ventas', '/accounting', '/accounting/facturas', '/accounting/facturas-colaboradores',
      '/tutores', '/tutores/comisiones', '/products/pending', '/tareas/configurar', '/meta-ads', '/whatsapp/chat']) {
      expect(ve, no).not.toContain(no);
    }
  });

  it('aunque se le dé un permiso de otra pantalla, el menú no le abre nada más', () => {
    const ve = loQueVe(['tutor_redactor'], [...REDACTOR, 'leads.view', 'diplomas.view', 'meta_ads.view']);
    expect(ve).not.toContain('/leads');
    expect(ve.some((r) => r.includes('diplomas') || r.includes('meta-ads'))).toBe(false);
  });

  it('cuenta como tutor para Consultas y Mis cursos, y el recorte es solo para quien es SOLO redactor', () => {
    expect(ROLES_DE_TUTOR).toEqual(['tutor', 'tutor_redactor']);
    expect(soloEsTutorRedactor({ role: 'tutor_redactor' })).toBe(true);
    expect(soloEsTutorRedactor({ role: 'gestor', roles_extra: ['tutor_redactor'] })).toBe(false);
  });
});
