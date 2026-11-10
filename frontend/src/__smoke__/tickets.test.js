// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Los tickets de soporte, contra el servidor (#38).
 *
 * ESTA PRUEBA SE REESCRIBIÓ ENTERA, Y CONVIENE SABER POR QUÉ.
 *
 * Antes comprobaba el `localStorage`: que el id se generara solo, que los
 * timestamps se pusieran en el navegador, que la lista se guardara bajo
 * `crm.support-tickets`. Todo eso era cierto y ya no lo es — los tickets viven
 * en la base desde el #38, y quien los crea es el servidor.
 *
 * Mantener las viejas habría sido fijar un comportamiento que se acaba de
 * retirar. Lo que se conserva es lo que sigue siendo verdad: los tres
 * catálogos, el contrato de las funciones, y el evento `crm:tickets-changed`
 * que el lanzador escucha para recargar.
 *
 * Lo nuevo que se fija:
 *
 *   - que NO se inventen datos en el navegador. El id, la fecha y el estado
 *     los pone el servidor; generarlos aquí daría un ticket que parece
 *     guardado y no lo está.
 *   - que un fallo de red no reviente la pantalla: devuelve vacío o null y el
 *     CRM sigue en pie.
 *   - que los del navegador viejo se puedan seguir leyendo, porque no se
 *     migran y desaparecer sin avisar sería peor.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('@/shared/api/client', () => ({
  default: {
    get: (...a) => get(...a),
    post: (...a) => post(...a),
    patch: (...a) => patch(...a),
    delete: (...a) => del(...a),
  },
}));

const {
  listTickets, getTicket, createTicket, updateTicketStatus, addComment,
  deleteTicket, ticketsViejos,
  TICKET_STATUS, TICKET_SEVERITY, TICKET_KIND,
} = await import('@/modules/soporte/lib/tickets');

/** Un ticket tal como lo devuelve el servidor. */
const DEL_SERVIDOR = {
  id: '7', kind: 'bug', severity: 'high', status: 'open',
  title: 'El chat no carga', description: '', steps: '', expected: '',
  actual: '', whyItMatters: '', url: '/crm/whatsapp/chat',
  projectId: 1, projectName: 'Psiko Aprende',
  createdAt: '2026-09-16T10:00:00Z', updatedAt: '2026-09-16T10:00:00Z',
  comments: [], attachments: [],
};

beforeEach(() => {
  localStorage.clear();
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  get.mockResolvedValue({ success: true, data: [DEL_SERVIDOR] });
  post.mockResolvedValue({ success: true, data: DEL_SERVIDOR });
  patch.mockResolvedValue({ success: true, data: { ...DEL_SERVIDOR, status: 'closed' } });
  del.mockResolvedValue({ success: true });
});

describe('los catálogos, que no han cambiado', () => {
  it('TICKET_STATUS tiene 4 estados con label + tone', () => {
    expect(Object.keys(TICKET_STATUS)).toEqual(['open', 'in_review', 'resolved', 'closed']);
    for (const v of Object.values(TICKET_STATUS)) {
      expect(v.label).toBeTruthy();
      expect(v.tone).toBeTruthy();
    }
  });

  it('TICKET_SEVERITY tiene 4 niveles', () => {
    expect(Object.keys(TICKET_SEVERITY)).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('TICKET_KIND tiene bug/feature/question', () => {
    expect(Object.keys(TICKET_KIND)).toEqual(['bug', 'feature', 'question']);
  });

  it('coinciden con lo que acepta el servidor', () => {
    // Si aquí se añadiera un estado que la migración 172 no tiene en su CHECK,
    // la pantalla lo ofrecería y el servidor lo rechazaría con un 500.
    expect(Object.keys(TICKET_STATUS)).toEqual(['open', 'in_review', 'resolved', 'closed']);
    expect(Object.keys(TICKET_KIND)).toEqual(['bug', 'feature', 'question']);
  });
});

describe('listar', () => {
  it('los pide al servidor', async () => {
    const t = await listTickets();
    expect(get).toHaveBeenCalledWith('/soporte', { params: { limit: 200 } });
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe('El chat no carga');
  });

  it('si el servidor falla devuelve [], no revienta', async () => {
    get.mockRejectedValue(new Error('sin red'));
    expect(await listTickets()).toEqual([]);
  });

  it('una respuesta rara tampoco', async () => {
    get.mockResolvedValue({ success: true, data: null });
    expect(await listTickets()).toEqual([]);
  });
});

describe('crear', () => {
  it('NO inventa id ni fechas: los pone el servidor', async () => {
    // Generarlos aquí daría un ticket que parece guardado y no lo está, que
    // es exactamente lo que pasaba antes con el localStorage.
    const t = await createTicket({ title: 'Algo', kind: 'bug' });
    expect(t.id).toBe('7');
    expect(t.createdAt).toBe('2026-09-16T10:00:00Z');
    const enviado = post.mock.calls[0][1];
    expect(enviado.id).toBeUndefined();
    expect(enviado.createdAt).toBeUndefined();
    expect(enviado.status).toBeUndefined();
  });

  it('aplica los defaults que ya aplicaba: kind=question, severity=low', async () => {
    await createTicket({ title: 'Una duda' });
    expect(post.mock.calls[0][1]).toMatchObject({ kind: 'question', severity: 'low' });
  });

  it('título vacío cae a «(sin titulo)»', async () => {
    await createTicket({ title: '   ' });
    expect(post.mock.calls[0][1].title).toBe('(sin titulo)');
  });

  it('si el servidor dice que no, devuelve null', async () => {
    post.mockResolvedValue({ success: false, data: null });
    expect(await createTicket({ title: 'Algo' })).toBeNull();
  });

  it('avisa a las pantallas abiertas', async () => {
    const oido = vi.fn();
    window.addEventListener('crm:tickets-changed', oido);
    await createTicket({ title: 'Algo' });
    expect(oido).toHaveBeenCalled();
    window.removeEventListener('crm:tickets-changed', oido);
  });
});

describe('cambiar y borrar', () => {
  it('el estado va por PATCH', async () => {
    const t = await updateTicketStatus('7', 'closed');
    expect(patch).toHaveBeenCalledWith('/soporte/7/estado', { status: 'closed' });
    expect(t.status).toBe('closed');
  });

  it('el comentario va por POST y se le hace trim', async () => {
    await addComment('7', '  lo miro yo  ');
    expect(post).toHaveBeenCalledWith('/soporte/7/mensajes', { body: 'lo miro yo' });
  });

  it('borrar va por DELETE y avisa', async () => {
    const oido = vi.fn();
    window.addEventListener('crm:tickets-changed', oido);
    await deleteTicket('7');
    expect(del).toHaveBeenCalledWith('/soporte/7');
    expect(oido).toHaveBeenCalled();
    window.removeEventListener('crm:tickets-changed', oido);
  });

  it('los tres avisan aunque el servidor falle', async () => {
    // Si no avisaran, la pantalla se quedaría enseñando el estado viejo sin
    // que nada indique que la operación no se hizo.
    patch.mockRejectedValue(new Error('x'));
    del.mockRejectedValue(new Error('x'));
    const oido = vi.fn();
    window.addEventListener('crm:tickets-changed', oido);
    await updateTicketStatus('7', 'closed');
    await deleteTicket('7');
    expect(oido).toHaveBeenCalledTimes(2);
    window.removeEventListener('crm:tickets-changed', oido);
  });
});

describe('uno solo', () => {
  it('se pide por su id', async () => {
    get.mockResolvedValue({ success: true, data: DEL_SERVIDOR });
    const t = await getTicket('7');
    expect(get).toHaveBeenCalledWith('/soporte/7');
    expect(t.title).toBe('El chat no carga');
  });

  it('si no existe, null', async () => {
    get.mockRejectedValue(new Error('404'));
    expect(await getTicket('999')).toBeNull();
  });
});

describe('los que quedaron en el navegador', () => {
  it('se pueden leer, para poder decirlo', async () => {
    // No se migran: están en el localStorage de cada máquina y desde el
    // servidor no se alcanzan. Que desaparezcan sin explicación sería peor.
    localStorage.setItem('crm.support-tickets', JSON.stringify([{ id: 'tkt-viejo', title: 'De antes' }]));
    const v = ticketsViejos();
    expect(v).toHaveLength(1);
    expect(v[0].title).toBe('De antes');
  });

  it('sin nada guardado, lista vacía', () => {
    expect(ticketsViejos()).toEqual([]);
  });

  it('un storage corrupto no revienta', () => {
    localStorage.setItem('crm.support-tickets', 'esto no es json');
    expect(ticketsViejos()).toEqual([]);
  });
});
