import { describe, it, expect } from 'vitest';
import {
  PASOS, ESTADOS, numeroDePaso, estaAtascada, fraseAtascada, diasTexto, textoDelEstado, mesTexto,
} from '../modules/apostillas/lib/apostillas';

/*
  Apostilla de La Haya (CRM-ISEIE#786, gemela de CRM#1130): los pasos de la tarea, en orden, y cuándo
  una apostilla está atascada. El texto del aviso es el mismo que el de la
  campana (backend · apostillas.avisos.js · tituloAtascada).
*/

describe('los pasos', () => {
  it('son los de la tarea, en orden, y Cancelada va aparte', () => {
    expect(PASOS.map((p) => p.texto)).toEqual([
      'Pendiente de iniciar', 'Pendiente de documentación', 'En trámite', 'Apostillada', 'Enviada al estudiante', 'Entregada',
    ]);
    expect(ESTADOS.at(-1)?.texto).toBe('Cancelada o reembolsada');
    expect(numeroDePaso('en_tramite')).toBe(3);
    expect(numeroDePaso('cancelada')).toBe(0);
    expect(textoDelEstado('apostillada')).toBe('Apostillada');
  });
});

describe('atascada', () => {
  const base = { cliente: 'Ana Pérez', dias_aviso: 7 };
  it('a los días del aviso o más en el mismo paso', () => {
    expect(estaAtascada({ ...base, estado: 'en_tramite', dias_en_estado: 7 })).toBe(true);
    expect(estaAtascada({ ...base, estado: 'en_tramite', dias_en_estado: 6 })).toBe(false);
  });
  it('Entregada y Cancelada no se atascan nunca', () => {
    expect(estaAtascada({ ...base, estado: 'entregada', dias_en_estado: 90 })).toBe(false);
    expect(estaAtascada({ ...base, estado: 'cancelada', dias_en_estado: 90 })).toBe(false);
  });
  it('la frase es la de la campana', () => {
    expect(fraseAtascada({ cliente: 'Ana Pérez', estado: 'en_tramite', dias_en_estado: 8 }))
      .toBe('La apostilla de Ana Pérez lleva 8 días en «En trámite»');
    expect(fraseAtascada({ cliente: null, estado: 'pendiente_inicio', dias_en_estado: 9 }))
      .toBe('La apostilla sin asociar lleva 9 días en «Pendiente de iniciar»');
  });
  it('los días, en palabras', () => {
    expect(diasTexto(0)).toBe('hoy');
    expect(diasTexto(1)).toBe('1 día');
    expect(diasTexto(12)).toBe('12 días');
  });
  it('el mes de las cifras', () => {
    expect(mesTexto('2026-11')).toMatch(/nov/);
  });
});
