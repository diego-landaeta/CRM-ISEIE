// CRM-ISEIE#422 (gemela de CRM#710) · «Mi factura» de las vendedoras. Sale a quien tiene ficha en Facturas de
// colaboradores (la lista explícita: `factura_propia` de /auth/me) y el permiso
// «Subir su factura», dado a ella con su ficha. No a todo un rol: una gestora sin
// ficha no la ve, ni un super admin que no factura. Y la vendedora
// no pierde lo que ve como gestora. Con el menú de verdad (NAV_SECTIONS).
import { describe, it, expect } from 'vitest';

const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');

const can = (lista) => (k) => lista === '*' || lista.includes(k);
function loQueVe(roles, user, permisos) {
  const c = can(permisos);
  const pasa = (item) => canSeeItem(item, roles, false, user, c);
  return NAV_SECTIONS.flatMap((s) => s.items).filter(pasa).flatMap((it) => (it.children ? it.children.filter(pasa) : [it]))
    .map((it) => it.to).filter(Boolean);
}
const GESTORA = ['leads.view', 'proceso.view', 'ventas.view', 'whatsapp.usar'];

describe('menú · «Mi factura» de la vendedora (CRM-ISEIE#422)', () => {
  it('la gestora con ficha la ve, y sigue viendo lo suyo de gestora', () => {
    const ve = loQueVe(['gestor'], { role: 'gestor', factura_propia: true }, [...GESTORA, 'facturas_colaborador.subir']);
    expect(ve).toContain('/mi-factura');
    expect(ve).toEqual(expect.arrayContaining(['/leads']));
  });

  it('la admin comercial con ficha (admin y gestora a la vez) también', () => {
    const ve = loQueVe(['admin', 'gestor', 'tutor'], { role: 'admin', roles_extra: ['gestor', 'tutor'], factura_propia: true },
      [...GESTORA, 'facturas_colaborador.subir']);
    expect(ve).toContain('/mi-factura');
  });

  it('una gestora sin ficha no la ve, aunque alguien le haya dado el permiso', () => {
    expect(loQueVe(['gestor'], { role: 'gestor', factura_propia: false }, GESTORA)).not.toContain('/mi-factura');
    expect(loQueVe(['gestor'], { role: 'gestor', factura_propia: false }, [...GESTORA, 'facturas_colaborador.subir'])).not.toContain('/mi-factura');
  });

  it('con ficha pero sin el permiso (se lo quitaron a propósito), tampoco', () => {
    expect(loQueVe(['gestor'], { role: 'gestor', factura_propia: true }, GESTORA)).not.toContain('/mi-factura');
  });

  it('un super admin sin ficha no la ve, aunque lo pueda todo', () => {
    expect(loQueVe(['superadmin'], { role: 'superadmin', factura_propia: false }, '*')).not.toContain('/mi-factura');
  });

  it('el colaborador y el tutor redactor la siguen viendo como siempre', () => {
    expect(loQueVe(['colaborador'], { role: 'colaborador' }, ['tasks.view_own', 'facturas_colaborador.subir'])).toContain('/mi-factura');
    expect(loQueVe(['tutor_redactor'], { role: 'tutor_redactor' }, ['tasks.view_own', 'facturas_colaborador.subir'])).toContain('/mi-factura');
    // Diego: super admin y además colaborador.
    expect(loQueVe(['superadmin', 'colaborador'], { role: 'superadmin', roles_extra: ['colaborador'] }, '*')).toContain('/mi-factura');
  });
});
