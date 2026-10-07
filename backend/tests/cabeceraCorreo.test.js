import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { dibujar, versionDe } from '../src/modules/feedback/cabecera.js';

/**
 * #213. Carlos, 02/10: en el móvil el logo de la cabecera del correo no se
 * distinguía (el de Psiko quedaba de 25 px de alto). La cabecera pasa a
 * 1120 × 264 (se ve a 560 × 132) con el logo en 760 × 184.
 */
describe('la cabecera del correo', () => {
  it('mide 1120 × 264, opaca, aunque la marca no tenga logo', async () => {
    const png = await dibujar({ theme_color: '#c2587b', color_cabecera: null, logo_url: null });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1120, 264]);
    expect(meta.hasAlpha).toBe(false);
  });

  it('la versión cambia con el logo y con los colores, y es estable si nada cambia', () => {
    const marca = { logo_url: 'https://x/logo.png', color_cabecera: null, theme_color: '#c2587b', proyecto: 'Psiko' };
    expect(versionDe(marca)).toBe(versionDe({ ...marca }));
    expect(versionDe(marca)).not.toBe(versionDe({ ...marca, theme_color: '#000000' }));
    expect(versionDe(marca)).not.toBe(versionDe({ ...marca, logo_url: 'https://x/otro.png' }));
  });
});
