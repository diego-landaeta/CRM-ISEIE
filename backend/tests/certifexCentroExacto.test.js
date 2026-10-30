import { describe, it, expect } from 'vitest';
import { proyectosDeCentro } from '../src/modules/certifex/certifex.programa.js';

// 30/10: el centro ICTESS de Certifex casaba con ICTESS y con ICTESS US; con dos campus
// no era de ninguno y Yosbely (solo ICTESS) no veía diplomas. Si hay uno exacto, gana.
const P = [
  { id: 4, nombre: 'ICTESS', slug: 'ictess' },
  { id: 13, nombre: 'ICTESS US', slug: 'ictess-us' },
  { id: 2, nombre: 'Psiko Aprende', slug: 'psiko-aprende' },
];

describe('el campus de un centro de Certifex', () => {
  it('ICTESS es solo ICTESS, no ICTESS US', () => {
    expect(proyectosDeCentro('ICTESS', P).map((p) => p.id)).toEqual([4]);
  });
  it('sin coincidencia exacta, sigue valiendo el principio (PSIKO → Psiko Aprende)', () => {
    expect(proyectosDeCentro('PSIKO', P).map((p) => p.id)).toEqual([2]);
  });
});
