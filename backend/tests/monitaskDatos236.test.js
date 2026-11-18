import { describe, it, expect } from 'vitest';
import {
  diaEn, inicioDelDia, repartirPorDias, resumirPorDia, normalizarEntrada, normalizarActividad,
  normalizarUsuario, lista, tramos, cotejar, aMs,
} from '../src/modules/monitask/monitask.datos.js';
import { urlDeAutorizacion, baseDeLaApi, API_POR_DEFECTO, URL_AUTORIZAR } from '../src/modules/monitask/monitask.client.js';
import { redirectUri, urlDeVuelta } from '../src/modules/monitask/monitask.service.js';

/**
 * #236 · Monitask: lo que se hace con sus datos, sin red ni base.
 *
 *   npx vitest run tests/monitaskDatos236.test.js
 */

describe('#236 · días de Madrid', () => {
  it('el día de un instante es el de Madrid, no el de UTC', () => {
    expect(diaEn(Date.parse('2026-10-06T22:30:00Z'))).toBe('2026-10-07');   // 00:30 en Madrid (CEST)
    expect(diaEn(Date.parse('2026-12-31T23:30:00Z'))).toBe('2027-01-01');   // 00:30 en Madrid (CET)
  });

  it('la medianoche de Madrid, también los días de cambio de hora', () => {
    expect(new Date(inicioDelDia('2026-10-06')).toISOString()).toBe('2026-10-05T22:00:00.000Z');
    expect(new Date(inicioDelDia('2026-12-01')).toISOString()).toBe('2026-11-30T23:00:00.000Z');
    // 25/10/2026: se atrasa la hora. El día empieza aún en verano.
    expect(new Date(inicioDelDia('2026-10-25')).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(new Date(inicioDelDia('2026-10-26')).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('una entrada que cruza la medianoche se reparte entre los dos días', () => {
    const t = repartirPorDias(Date.parse('2026-10-06T21:00:00Z'), Date.parse('2026-10-06T23:00:00Z'));
    expect(t).toEqual([{ dia: '2026-10-06', ms: 3600000 }, { dia: '2026-10-07', ms: 3600000 }]);
  });

  it('los tramos de la API no pasan de n días', () => {
    expect(tramos('2026-10-01', '2026-10-15', 7)).toEqual([
      ['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14'], ['2026-10-15', '2026-10-15'],
    ]);
  });

  it('una fecha sin zona se toma como UTC', () => {
    expect(aMs('2026-10-05T08:00:00')).toBe(Date.parse('2026-10-05T08:00:00Z'));
    expect(aMs('2026-10-05T10:00:00+02:00')).toBe(Date.parse('2026-10-05T08:00:00Z'));
  });
});

describe('#236 · leer lo que devuelve Monitask (sin esquema publicado)', () => {
  it('la lista viene suelta o envuelta', () => {
    expect(lista([1, 2])).toEqual([1, 2]);
    expect(lista({ data: [1] })).toEqual([1]);
    expect(lista({ items: [3] })).toEqual([3]);
    expect(lista(null)).toEqual([]);
  });

  it('el correo de una persona sale de email o de userName, en minúsculas', () => {
    expect(normalizarUsuario({ id: 5, firstName: 'Ana', lastName: 'Ruiz', userName: 'Ana.Ruiz@Ejemplo.com' }))
      .toEqual({ id: 5, nombre: 'Ana Ruiz', correo: 'ana.ruiz@ejemplo.com' });
    expect(normalizarUsuario({ id: 6, userName: 'beto' })).toEqual({ id: 6, nombre: 'beto', correo: null });
    expect(normalizarUsuario({ firstName: 'Sin id' })).toBeNull();
  });

  it('una entrada con inicio y fin, o con inicio y duración', () => {
    expect(normalizarEntrada({ startedAt: '2026-10-05T08:00:00Z', endedAt: '2026-10-05T09:00:00Z', projectId: 11, noteId: 21 }))
      .toMatchObject({ inicio: Date.parse('2026-10-05T08:00:00Z'), fin: Date.parse('2026-10-05T09:00:00Z'), proyectoId: 11, tareaId: 21 });
    expect(normalizarEntrada({ start: '2026-10-05T08:00:00Z', duration: 1800, project: { id: 3, name: 'Web' } }))
      .toMatchObject({ fin: Date.parse('2026-10-05T08:30:00Z'), proyectoId: 3, proyectoNombre: 'Web' });
    expect(normalizarEntrada({ startedAt: 'x' })).toBeNull();
  });

  it('la actividad en % o en fracción', () => {
    expect(normalizarActividad({ start: '2026-10-05T08:00:00Z', activityLevel: 55 }))
      .toEqual({ inicio: Date.parse('2026-10-05T08:00:00Z'), fin: Date.parse('2026-10-05T08:10:00Z'), nivel: 55 });
    const r = resumirPorDia({
      entradas: [normalizarEntrada({ startedAt: '2026-10-05T08:00:00Z', endedAt: '2026-10-05T10:00:00Z' })],
      actividad: [normalizarActividad({ start: '2026-10-05T08:00:00Z', end: '2026-10-05T10:00:00Z', activity: 0.25 })],
      desde: '2026-10-05', hasta: '2026-10-05',
    });
    expect(r['2026-10-05'].actividadPct).toBe(25);
  });
});

describe('#236 · el resumen por día', () => {
  const ent = (a, b, extra = {}) => normalizarEntrada({ startedAt: a, endedAt: b, ...extra });
  const act = (a, b, nivel) => normalizarActividad({ start: a, end: b, activityLevel: nivel });

  it('horas sin contar dos veces lo que se pisa, actividad media ponderada, proyectos y tareas', () => {
    const r = resumirPorDia({
      entradas: [
        ent('2026-10-05T08:00:00Z', '2026-10-05T12:00:00Z', { projectId: 11, noteId: 21, noteText: 'Maquetar' }),
        ent('2026-10-05T11:00:00Z', '2026-10-05T13:00:00Z', { projectId: 12 }),
      ],
      actividad: [act('2026-10-05T08:00:00Z', '2026-10-05T10:00:00Z', 50), act('2026-10-05T10:00:00Z', '2026-10-05T13:00:00Z', 100)],
      desde: '2026-10-01', hasta: '2026-10-31', proyectos: new Map([[11, 'CRM'], [12, 'Web']]),
    });
    const d = r['2026-10-05'];
    expect(d.segundos).toBe(5 * 3600);
    expect(d.actividadPct).toBe(80);
    expect(d.segundosActivos).toBe(4 * 3600);
    expect(d.proyectos).toEqual([{ id: 11, nombre: 'CRM', segundos: 4 * 3600 }, { id: 12, nombre: 'Web', segundos: 3600 }]);
    expect(d.tareas[0]).toMatchObject({ id: 21, nombre: 'Maquetar', proyecto: 'CRM', segundos: 4 * 3600 });
  });

  it('lo que cae fuera del rango pedido no se guarda; sin actividad, null (no 0 %)', () => {
    const r = resumirPorDia({
      entradas: [ent('2026-10-06T21:00:00Z', '2026-10-06T23:00:00Z')],
      actividad: [], desde: '2026-10-06', hasta: '2026-10-06',
    });
    expect(Object.keys(r)).toEqual(['2026-10-06']);
    expect(r['2026-10-06']).toMatchObject({ segundos: 3600, actividadPct: null, segundosActivos: null });
  });
});

describe('#236 · el cotejo', () => {
  it('diferencia en horas y en % sobre Monitask, y el margen en los dos sentidos', () => {
    expect(cotejar({ horasFacturadas: 8, horasMonitask: 7, margenPct: 10 }))
      .toEqual({ sinCotejo: false, diferenciaHoras: 1, diferenciaPct: 14.29, fuera: true });
    expect(cotejar({ horasFacturadas: 8, horasMonitask: 7, margenPct: 20 }).fuera).toBe(false);
    expect(cotejar({ horasFacturadas: 6, horasMonitask: 8, margenPct: 10 })).toMatchObject({ diferenciaHoras: -2, diferenciaPct: -25, fuera: true });
  });

  it('sin horas en la factura (fijo) no hay cotejo; con horas y Monitask a cero, fuera', () => {
    expect(cotejar({ horasFacturadas: null, horasMonitask: 7 })).toMatchObject({ sinCotejo: true, fuera: false });
    expect(cotejar({ horasFacturadas: 5, horasMonitask: 0 })).toMatchObject({ diferenciaPct: null, fuera: true });
  });
});

describe('#236 · direcciones del OAuth', () => {
  it('la redirect URI sale de CRM_BASE_URL con su ruta, o de MONITASK_REDIRECT_URI', () => {
    expect(redirectUri({ CRM_BASE_URL: 'https://360crm.tech/crm' })).toBe('https://360crm.tech/crm/api/monitask/oauth/callback');
    expect(redirectUri({ CRM_BASE_URL: 'https://360crm.tech/testeo/' })).toBe('https://360crm.tech/testeo/api/monitask/oauth/callback');
    expect(redirectUri({ CRM_BASE_URL: 'https://crm.iseie.com' })).toBe('https://crm.iseie.com/api/monitask/oauth/callback');
    expect(redirectUri({ CRM_BASE_URL: 'https://x', MONITASK_REDIRECT_URI: 'https://y/cb' })).toBe('https://y/cb');
    expect(redirectUri({})).toBeNull();
    expect(urlDeVuelta('error', 'caducado', { CRM_BASE_URL: 'https://crm.iseie.com' }))
      .toBe('https://crm.iseie.com/accounting/integrations?monitask=error&motivo=caducado');
  });

  it('la autorización pide code con PKCE S256 y solo ExternalApi + offline_access', () => {
    const u = new URL(urlDeAutorizacion({ clientId: 'cid', redirectUri: 'https://r/cb', state: 'st', codeChallenge: 'ch', env: {} }));
    expect(`${u.origin}${u.pathname}`).toBe(URL_AUTORIZAR);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code', client_id: 'cid', redirect_uri: 'https://r/cb', scope: 'ExternalApi offline_access',
      state: 'st', code_challenge: 'ch', code_challenge_method: 'S256',
    });
  });

  it('la API solo puede apuntar a monitask.com', () => {
    expect(baseDeLaApi({})).toBe(API_POR_DEFECTO);
    expect(baseDeLaApi({ MONITASK_API_URL: 'https://api.monitask.com/' })).toBe('https://api.monitask.com');
    expect(baseDeLaApi({ MONITASK_API_URL: 'https://malo.example.com' })).toBe(API_POR_DEFECTO);
    expect(baseDeLaApi({ MONITASK_API_URL: 'http://external.monitask.com' })).toBe(API_POR_DEFECTO);
  });
});
