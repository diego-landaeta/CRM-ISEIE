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
    expect(ve).toEqual(expect.arrayContaining(['/tareas', '/tareas/historial', '/mi-factura', '/preferencias']));
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

  it('«Por revisar» ya no está, ni con «Devolver tareas»; «Historial de tareas», con su tablero (CRM-ISEIE#419)', () => {
    const ve = loQueVe(['colaborador'], [...COLABORADOR, 'tasks.close']);
    expect(ve).not.toContain('/tareas/revisar');
    expect(ve).toContain('/tareas/historial');
    expect(loQueVe(['colaborador'], ['facturas_colaborador.subir'])).not.toContain('/tareas/historial');
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

describe('«Historial de tareas»: cada uno con tablero lo tiene (Diego, 11/11/2026)', () => {
  // Quien tiene «Mi tablero» tiene también su historial, sin abrir permisos nuevos:
  // los dos piden «Ver su tablero» (tasks.view_own). Gemela de la de MultiCRM.
  const PERFILES = {
    colaborador: [['colaborador'], COLABORADOR],
    'tutor con tablero': [['tutor'], ['tasks.view_own', 'tasks.edit']],
    'gestora + tutor': [['gestor', 'tutor'], ['tasks.view_own', 'tasks.edit']],
    'gestora con «Ver su tablero»': [['gestor'], ['tasks.view_own']],
    'project manager con «Ver su tablero»': [['project_manager'], ['tasks.view_own']],
    admin: [['admin'], ['tasks.view_own', 'tasks.view_all', 'tasks.manage']],
  };
  for (const [nombre, [roles, permisos]] of Object.entries(PERFILES)) {
    it(`${nombre}: «Mi tablero» y «Historial de tareas»`, () => {
      const ve = loQueVe(roles, permisos);
      expect(ve).toContain('/tareas');
      expect(ve).toContain('/tareas/historial');
    });
  }

  it('sin «Ver su tablero», ni el tablero ni el historial', () => {
    for (const roles of [['gestor'], ['tutor']]) {
      const ve = loQueVe(roles, []);
      expect(ve).not.toContain('/tareas');
      expect(ve).not.toContain('/tareas/historial');
    }
  });
});

describe('«Mi tablero» (Diego, 26/10/2026)', () => {
  it('la entrada del menú se llama «Mi tablero»', () => {
    const entrada = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === '/tareas');
    expect(entrada.label).toBe('Mi tablero');
  });

  it('se entra en «Mis tareas», que pide lo suyo (lleva, supervisa o creó); admin y superadmin, «Todo» del mes', async () => {
    const { VISTA_INICIAL, filtroDeVista, OPCIONES_VER, vistaInicialDe } = await import('@/modules/tasks/lib/taskUi');
    expect(VISTA_INICIAL).toBe('mias');
    expect(vistaInicialDe({ role: 'colaborador' })).toEqual({ ver: 'mias', periodo: 'todo' });
    expect(vistaInicialDe({ role: 'gestor', roles_extra: ['tutor'] })).toEqual({ ver: 'mias', periodo: 'todo' });
    expect(vistaInicialDe({ role: 'admin' })).toEqual({ ver: 'todo', periodo: 'mes' });
    expect(vistaInicialDe({ role: 'superadmin', roles_extra: ['colaborador', 'soporte'] })).toEqual({ ver: 'todo', periodo: 'mes' });
    expect(vistaInicialDe(null)).toEqual({ ver: 'mias', periodo: 'todo' });
    expect(filtroDeVista('mias')).toEqual({ ver: 'mias' });
    expect(filtroDeVista('equipo')).toEqual({ ver: 'equipo' });
    expect(filtroDeVista('todo')).toEqual({ ver: 'todo' });
    // Ya no hay «el tablero de una persona»: la persona es un filtro (27/10/2026).
    expect(OPCIONES_VER.map((o) => o.label)).toEqual(['Mis tareas', 'Mi equipo', 'Todo']);
  });
});
