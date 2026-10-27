import { describe, it, expect } from 'vitest';
import {
  entraEnPeriodo, etiquetaDePeriodo, fechaCorta, moverReferencia, rangoDePeriodo, resumenDelPeriodo, textoDelPeriodo, vieneDeAntes,
} from '@/modules/tasks/lib/periodo';

// El periodo del tablero (Diego, 27/10/2026: «vistas por día, semana y mes»).
// Días de la oficina (Madrid); la semana va de lunes a domingo.

const HOY = '2026-10-27'; // martes

describe('rangoDePeriodo', () => {
  it('día, semana (lunes a domingo) y mes', () => {
    expect(rangoDePeriodo('dia', HOY)).toEqual({ desde: HOY, hasta: HOY });
    expect(rangoDePeriodo('semana', HOY)).toEqual({ desde: '2026-10-26', hasta: '2026-11-01' });
    expect(rangoDePeriodo('semana', '2026-11-01')).toEqual({ desde: '2026-10-26', hasta: '2026-11-01' });
    expect(rangoDePeriodo('mes', HOY)).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(rangoDePeriodo('mes', '2028-02-10')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(rangoDePeriodo('todo', HOY)).toBeNull();
  });

  it('anterior y siguiente', () => {
    expect(moverReferencia('dia', HOY, -1)).toBe('2026-10-26');
    expect(moverReferencia('semana', HOY, 1)).toBe('2026-11-03');
    expect(moverReferencia('mes', '2026-12-31', 1)).toBe('2027-01-01');
    expect(moverReferencia('mes', '2026-03-31', -1)).toBe('2026-02-01');
  });
});

describe('etiquetaDePeriodo', () => {
  it('se entiende qué periodo es', () => {
    expect(etiquetaDePeriodo('dia', rangoDePeriodo('dia', HOY), HOY)).toBe('Hoy, martes, 27 oct');
    expect(etiquetaDePeriodo('dia', rangoDePeriodo('dia', '2026-10-26'), HOY)).toBe('Ayer, lunes, 26 oct');
    expect(etiquetaDePeriodo('semana', rangoDePeriodo('semana', HOY), HOY)).toBe('Semana del 26 oct al 1 nov');
    expect(etiquetaDePeriodo('mes', rangoDePeriodo('mes', HOY), HOY)).toBe('Octubre de 2026');
    expect(etiquetaDePeriodo('todo', null, HOY)).toBe('Todas las fechas');
  });
});

describe('entraEnPeriodo: los cuatro casos', () => {
  const semana = rangoDePeriodo('semana', '2026-10-07')!; // 5 al 11 de octubre
  const base = { created_at: '2026-09-01T08:00:00Z', completed_at: null, due_date: null, status: 'hecha' };

  it('se creó dentro', () => {
    expect(entraEnPeriodo({ ...base, created_at: '2026-10-07T08:00:00Z', completed_at: '2026-10-20T08:00:00Z' }, semana)).toBe(true);
  });
  it('se terminó dentro', () => {
    expect(entraEnPeriodo({ ...base, completed_at: '2026-10-09T08:00:00Z' }, semana)).toBe(true);
  });
  it('vence dentro', () => {
    expect(entraEnPeriodo({ ...base, completed_at: '2026-09-02T08:00:00Z', due_date: '2026-10-10T21:59:00Z' }, semana)).toBe(true);
  });
  it('sigue abierta y se creó antes de que acabe', () => {
    expect(entraEnPeriodo({ ...base, status: 'en_curso' }, semana)).toBe(true);
    // Abierta, pero creada después: no.
    expect(entraEnPeriodo({ ...base, status: 'en_curso', created_at: '2026-10-20T08:00:00Z' }, semana)).toBe(false);
  });
  it('hecha antes y sin nada dentro: no', () => {
    expect(entraEnPeriodo({ ...base, completed_at: '2026-09-03T08:00:00Z' }, semana)).toBe(false);
  });
  it('los bordes van en hora de Madrid: domingo 23:30 entra, lunes 00:30 no', () => {
    expect(entraEnPeriodo({ ...base, created_at: '2026-10-11T21:30:00Z', completed_at: '2026-10-11T21:40:00Z' }, semana)).toBe(true);
    expect(entraEnPeriodo({ ...base, created_at: '2026-10-11T22:30:00Z', completed_at: '2026-10-11T22:40:00Z' }, semana)).toBe(false);
  });
  it('sin periodo, todas', () => {
    expect(entraEnPeriodo(base, null)).toBe(true);
  });
});

describe('el texto de debajo de los filtros', () => {
  const semana = rangoDePeriodo('semana', HOY);
  const tareas = [
    { created_at: '2026-10-26T09:00:00Z', completed_at: null, due_date: null, status: 'por_hacer' },
    { created_at: '2026-10-27T09:00:00Z', completed_at: '2026-10-27T15:00:00Z', due_date: null, status: 'hecha' },
    { created_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-28T09:00:00Z', due_date: null, status: 'hecha' },
    { created_at: '2026-10-01T09:00:00Z', completed_at: null, due_date: '2026-10-30T22:59:00Z', status: 'en_curso' },
  ];

  it('cuenta las creadas, las terminadas, las que vencen y las sin cerrar de antes', () => {
    expect(resumenDelPeriodo(tareas, semana)).toEqual({ total: 4, creadas: 2, terminadas: 2, vencen: 1, deAntes: 1 });
    expect(textoDelPeriodo('semana', semana, tareas, HOY))
      .toBe('Semana del 26 oct al 1 nov · 4 tareas: 2 creadas, 2 terminadas, 1 vence, 1 sin cerrar de antes');
  });

  it('con «Todo», cuántas hay y cuántas están terminadas', () => {
    expect(textoDelPeriodo('todo', null, tareas, HOY)).toBe('Todas las fechas · 4 tareas: 2 terminadas');
    expect(textoDelPeriodo('todo', null, [], HOY)).toBe('Todas las fechas · 0 tareas');
  });
});

// Diego, 27/10/2026: «si la tarea no está cerrada en un mes, pasa al siguiente mes».
describe('las tareas sin cerrar pasan al mes siguiente', () => {
  const noviembre = rangoDePeriodo('mes', '2026-11-05');
  const octubre = rangoDePeriodo('mes', '2026-10-05');

  it('abierta de octubre: sale en noviembre y dice de dónde viene', () => {
    const t = { created_at: '2026-10-10T09:00:00Z', completed_at: null, due_date: null, status: 'en_curso' };
    expect(entraEnPeriodo(t, noviembre)).toBe(true);
    expect(vieneDeAntes(t, noviembre)).toBe('octubre');
    expect(vieneDeAntes(t, octubre)).toBeNull();
  });
  it('cerrada en octubre: ya no pasa a noviembre', () => {
    const t = { created_at: '2026-10-10T09:00:00Z', completed_at: '2026-10-20T09:00:00Z', due_date: null, status: 'hecha' };
    expect(entraEnPeriodo(t, noviembre)).toBe(false);
    expect(vieneDeAntes(t, noviembre)).toBeNull();
  });
  it('cerrada en noviembre aunque se creara en octubre: sale en noviembre, sin «viene de»', () => {
    const t = { created_at: '2026-10-10T09:00:00Z', completed_at: '2026-11-03T09:00:00Z', due_date: null, status: 'hecha' };
    expect(entraEnPeriodo(t, noviembre)).toBe(true);
    expect(vieneDeAntes(t, noviembre)).toBeNull();
  });
  it('de otro año, con el año', () => {
    const enero = rangoDePeriodo('mes', '2027-01-10');
    expect(vieneDeAntes({ created_at: '2026-12-15T09:00:00Z', status: 'por_hacer' }, enero)).toBe('diciembre de 2026');
  });
  it('sin periodo, nunca «viene de»', () => {
    expect(vieneDeAntes({ created_at: '2026-01-01T09:00:00Z', status: 'por_hacer' }, null)).toBeNull();
  });
});

describe('fechaCorta', () => {
  it('«27 oct», y con el año si no es este', () => {
    const ahora = new Date('2026-10-27T10:00:00Z');
    expect(fechaCorta('2026-10-27T10:00:00Z', ahora)).toBe('27 oct');
    // A las 23:30 UTC del 27 ya es 28 en Madrid.
    expect(fechaCorta('2026-10-27T23:30:00Z', ahora)).toBe('28 oct');
    expect(fechaCorta('2025-12-03T10:00:00Z', ahora)).toBe('3 dic 2025');
  });
});
