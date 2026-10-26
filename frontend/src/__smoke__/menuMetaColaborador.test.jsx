// Meta Ads en el menú del equipo de desarrollo (Diego, 26/10/2026): solo a quien se le da
// «Meta Ads (ver)», también si es solo colaborador; con el menú de verdad. Gemela de MultiCRM.
import { describe, it, expect } from 'vitest';

const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');
const can = (lista) => (k) => lista.includes(k);
function loQueVe(roles, permisos) {
  const c = can(permisos);
  const pasa = (item) => canSeeItem(item, roles, false, {}, c);
  return NAV_SECTIONS.flatMap((s) => s.items).filter(pasa)
    .flatMap((it) => (it.children ? it.children.filter(pasa) : [it])).map((it) => it.to).filter(Boolean);
}
const COLABORADOR = ['tasks.view_own', 'tasks.create', 'tasks.edit', 'facturas_colaborador.subir'];

describe('menú · Meta Ads para el colaborador', () => {
  it('sin el permiso: Tareas, Mi factura y preferencias, y nada de Meta', () => {
    const ve = loQueVe(['colaborador'], COLABORADOR);
    expect(ve).toEqual(expect.arrayContaining(['/tareas', '/mi-factura', '/preferencias']));
    expect(ve).not.toContain('/meta-ads');
  });

  it('con «Meta Ads (ver)»: Meta Ads, y nada más de Publicidad ni del resto del CRM', () => {
    const ve = loQueVe(['colaborador'], [...COLABORADOR, 'meta_ads.view']);
    expect(ve).toContain('/meta-ads');
    for (const no of ['/google-ads', '/leads', '/ventas']) expect(ve, no).not.toContain(no);
  });

  it('un colaborador con «Diplomas · Ver» sigue sin Diplomas', () => {
    expect(loQueVe(['colaborador'], [...COLABORADOR, 'diplomas.view']).some((r) => r.includes('diplomas'))).toBe(false);
  });

  it('una gestora con «Meta Ads (ver)» también la ve; sin él, no', () => {
    expect(loQueVe(['gestor'], ['meta_ads.view'])).toContain('/meta-ads');
    expect(loQueVe(['gestor'], [])).not.toContain('/meta-ads');
  });
});
