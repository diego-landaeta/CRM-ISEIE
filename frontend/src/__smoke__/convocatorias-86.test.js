import { describe, it, expect } from 'vitest';
import {
  estadoDeSolicitud, TEXTO_RESULTADO, tonoDelResultado, textoDeLaVentana,
  pasaDelTope, tramosDelEmbudo, hayEmbudo,
} from '@/modules/convocatorias/lib/ofrecimiento';

/*
  Convocatorias (#86).

  Lo que se prueba es lo que decide la pantalla. «Si compró», «si debe
  respuesta» y el texto del aviso del tope llegan calculados del servidor y no
  se rehacen aquí: rehacerlos sería firmar que algún día la ficha y el embudo
  digan cosas distintas de la misma persona.
*/

describe('si llenó la solicitud', () => {
  it('sin preguntar NO es que no la llenara', () => {
    expect(estadoDeSolicitud({ solicitud_llenada: null })).toBe('sin_saber');
    expect(estadoDeSolicitud({ solicitud_llenada: undefined })).toBe('sin_saber');
    expect(estadoDeSolicitud({ solicitud_llenada: false })).toBe('no_llenada');
    expect(estadoDeSolicitud({ solicitud_llenada: true })).toBe('llenada');
  });
});

describe('en qué quedó', () => {
  it('cada resultado tiene su color y ninguno se queda sin texto', () => {
    expect(tonoDelResultado('concedida')).toBe('success');
    expect(tonoDelResultado('denegada')).toBe('destructive');
    expect(tonoDelResultado('caducada')).toBe('muted');
    expect(tonoDelResultado('pendiente')).toBe('info');
    for (const r of ['pendiente', 'concedida', 'denegada', 'caducada']) {
      expect(TEXTO_RESULTADO[r]).toBeTruthy();
    }
  });
});

describe('lo que se le prometió', () => {
  const f = (iso) => iso;

  it('dice las dos fechas: hasta cuándo puede pedirla y cuándo se le contesta', () => {
    expect(textoDeLaVentana({ fecha_limite: '2026-09-20', fecha_resultado: '2026-09-24' }, f))
      .toBe('pedirla hasta el 2026-09-20 · respuesta el 2026-09-24');
  });

  it('con una sola, dice la que hay', () => {
    expect(textoDeLaVentana({ fecha_limite: '2026-09-20', fecha_resultado: null }, f))
      .toBe('pedirla hasta el 2026-09-20');
    expect(textoDeLaVentana({ fecha_limite: null, fecha_resultado: '2026-09-24' }, f))
      .toBe('respuesta el 2026-09-24');
  });

  it('sin fechas no inventa una línea vacía', () => {
    expect(textoDeLaVentana({ fecha_limite: null, fecha_resultado: null }, f)).toBeNull();
  });
});

describe('el aviso mientras se escribe el descuento', () => {
  const cetlat = { tope_nueva: 40, tope_habilitada: 70 };

  it('se mide contra el tope BAJO, porque el CRM no sabe si la formación está habilitada', () => {
    expect(pasaDelTope(30, cetlat)).toBe(false);
    expect(pasaDelTope(40, cetlat)).toBe(false);
    expect(pasaDelTope(55, cetlat)).toBe(true);
    expect(pasaDelTope(85, cetlat)).toBe(true);
  });

  it('sin número escrito no avisa de nada', () => {
    expect(pasaDelTope(null, cetlat)).toBe(false);
    expect(pasaDelTope(undefined, cetlat)).toBe(false);
    expect(pasaDelTope(NaN, cetlat)).toBe(false);
  });

  it('sin topes conocidos se calla en vez de suponerlos', () => {
    expect(pasaDelTope(90, null)).toBe(false);
    expect(pasaDelTope(90, {})).toBe(false);
  });
});

describe('el embudo', () => {
  const lleno = {
    ofrecidas: 20, llenaron: 12, no_llenaron: 5, sin_saber: 3,
    con_descuento: 10, descuento_medio: 35.5, descuento_maximo: 60,
    compraron: 6, deben_respuesta: 2,
    pct_llenaron: 60, pct_compraron: 30, pct_compraron_de_los_que_llenaron: 50,
  };

  it('va en el orden en que pasan las cosas', () => {
    expect(tramosDelEmbudo(lleno).map((t) => t.clave))
      .toEqual(['ofrecidas', 'llenaron', 'con_descuento', 'compraron']);
    expect(tramosDelEmbudo(lleno)[1].valor).toBe(12);
    expect(tramosDelEmbudo(lleno)[1].pct).toBe(60);
  });

  it('nadie ofrecido no es lo mismo que la beca no funciona', () => {
    const vacio = { ...lleno, ofrecidas: 0, llenaron: 0, compraron: 0, pct_llenaron: 0, pct_compraron: 0 };
    expect(hayEmbudo(vacio)).toBe(false);
    expect(hayEmbudo(lleno)).toBe(true);
    expect(hayEmbudo(null)).toBe(false);
  });

  it('sin datos no devuelve tramos que pintar', () => {
    expect(tramosDelEmbudo(null)).toEqual([]);
  });
});
