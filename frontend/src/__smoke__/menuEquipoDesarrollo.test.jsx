// El menú del equipo de desarrollo (Diego, 26/10/2026): «que solo puedan ver eso» —Tareas y
// su factura de colaborador— y Meta Ads a quien se le da (en ISEIE: Jonathan, Gustavo, Ruth,
// Julián y Jesús). Con el menú de verdad (NAV_SECTIONS), gemela de la de MultiCRM.
import { describe, it, expect } from 'vitest';

const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');

const can = (lista) => (k) => lista.includes(k);
function loQueVe(roles, permisos) {
  const c = can(permisos);
  const pasa = (item) => canSeeItem(item, roles, false, {}, c);
  return NAV_SECTIONS.flatMap((s) => s.items).filter(pasa).flatMap((it) => (it.children ? it.children.filter(pasa) : [it]))
    .map((it) => it.to).filter(Boolean);
}
const COLABORADOR = ['tasks.view_own', 'tasks.create', 'tasks.edit', 'facturas_colaborador.subir'];

describe('menú · equipo de desarrollo', () => {
  it('un colaborador ve Tareas, «Mi factura» y sus preferencias; nada de prospectos, ventas ni finanzas', () => {
    const ve = loQueVe(['colaborador'], COLABORADOR);
    expect(ve).toEqual(expect.arrayContaining(['/tareas', '/mi-factura', '/preferencias']));
    for (const no of ['/leads', '/ventas', '/accounting/facturas', '/meta-ads', '/tareas/revisar', '/tareas/configurar']) {
      expect(ve, no).not.toContain(no);
    }
  });

  it('con «Meta Ads (ver)» le sale Meta Ads, y nada más de Publicidad', () => {
    const ve = loQueVe(['colaborador'], [...COLABORADOR, 'meta_ads.view']);
    expect(ve).toContain('/meta-ads');
    expect(ve).not.toContain('/google-ads');
    expect(ve).not.toContain('/leads');
  });

  it('«Por revisar», solo con «Aprobar y cerrar»', () => {
    expect(loQueVe(['colaborador'], [...COLABORADOR, 'tasks.close'])).toContain('/tareas/revisar');
  });

  it('un colaborador con «Diplomas · Ver» sigue sin Diplomas (no es para él)', () => {
    const ve = loQueVe(['colaborador'], [...COLABORADOR, 'diplomas.view']);
    expect(ve.some((r) => r.includes('diplomas'))).toBe(false);
  });

  it('una gestora con «Meta Ads (ver)» también la ve; sin él, no', () => {
    expect(loQueVe(['gestor'], ['meta_ads.view'])).toContain('/meta-ads');
    expect(loQueVe(['gestor'], [])).not.toContain('/meta-ads');
  });
});

describe('«Mi tablero» (Diego, 26/10/2026)', () => {
  it('la entrada del menú se llama «Mi tablero»', () => {
    const entrada = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === '/tareas');
    expect(entrada.label).toBe('Mi tablero');
  });

  it('se entra siempre en «Mi tablero», que pide lo suyo (lleva, supervisa o creó), sea quien sea', async () => {
    const { VISTA_INICIAL, filtroDeVista } = await import('@/modules/tasks/lib/taskUi');
    expect(VISTA_INICIAL).toBe('mio');
    expect(filtroDeVista('mio')).toEqual({ mias: true });
    expect(filtroDeVista('equipo')).toEqual({});
    expect(filtroDeVista(7)).toEqual({ assigned_to: 7 });
  });
});
