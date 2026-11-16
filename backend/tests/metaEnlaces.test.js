import { describe, it, expect } from 'vitest';
import { destinoDelCreativo, normalizarEnlace, formacionDelConjunto } from '../src/modules/meta-ads/meta-ads.enlaces.js';

/**
 * La URL de destino de un anuncio de Meta y la formación de un conjunto (#362).
 * Sin base ni red: los creativos, tal como los devuelve la Graph API.
 *
 *   npx vitest run tests/metaEnlaces.test.js
 */

describe('la URL de destino, según el formato del creativo', () => {
  it('enlace: object_story_spec.link_data.link', () => {
    const d = destinoDelCreativo({
      id: '1',
      object_story_spec: { page_id: '9', link_data: { link: 'https://www.iseih.com/master-x/', message: 'Hola' } },
      url_tags: 'utm_source=facebook&utm_medium=paid',
    });
    expect(d).toEqual({
      formato: 'enlace', url: 'https://www.iseih.com/master-x/', urls: ['https://www.iseih.com/master-x/'],
      formulario_id: null, url_tags: 'utm_source=facebook&utm_medium=paid',
    });
  });

  it('enlace: si solo lo trae el botón, vale el del botón', () => {
    const d = destinoDelCreativo({ object_story_spec: { link_data: { call_to_action: { type: 'LEARN_MORE', value: { link: 'https://a.com/x' } } } } });
    expect(d).toMatchObject({ formato: 'enlace', url: 'https://a.com/x' });
  });

  it('carrusel: todas las tarjetas, en orden y sin repetir; la principal es la primera', () => {
    const d = destinoDelCreativo({
      object_story_spec: {
        link_data: {
          link: 'https://a.com/catalogo',
          child_attachments: [
            { link: 'https://a.com/master-1', name: 'Uno' },
            { link: 'https://a.com/master-2', name: 'Dos' },
            { link: 'https://a.com/master-1', name: 'Otra vez uno' },
          ],
        },
      },
    });
    expect(d.formato).toBe('carrusel');
    expect(d.url).toBe('https://a.com/master-1');
    expect(d.urls).toEqual(['https://a.com/master-1', 'https://a.com/master-2', 'https://a.com/catalogo']);
  });

  it('vídeo: el enlace del botón', () => {
    const d = destinoDelCreativo({ object_story_spec: { video_data: { video_id: '5', call_to_action: { type: 'SIGN_UP', value: { link: 'https://a.com/v' } } } } });
    expect(d).toMatchObject({ formato: 'video', url: 'https://a.com/v', urls: ['https://a.com/v'] });
  });

  it('dinámico (Advantage+): asset_feed_spec.link_urls', () => {
    const d = destinoDelCreativo({ asset_feed_spec: { link_urls: [{ website_url: 'https://a.com/d1' }, { website_url: 'https://a.com/d2' }] } });
    expect(d).toMatchObject({ formato: 'dinamico', url: 'https://a.com/d1', urls: ['https://a.com/d1', 'https://a.com/d2'] });
  });

  it('formulario instantáneo: sin URL, aunque Meta rellene un «link»; con el id del formulario', () => {
    const d = destinoDelCreativo({
      object_story_spec: { link_data: { link: 'http://fb.me/', call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: 777 } } } },
    });
    expect(d).toEqual({ formato: 'formulario_instantaneo', url: null, urls: [], formulario_id: '777', url_tags: null });
    const v = destinoDelCreativo({ object_story_spec: { video_data: { call_to_action: { value: { lead_gen_form_id: '8', link: 'https://a.com' } } } } });
    expect(v).toMatchObject({ formato: 'formulario_instantaneo', url: null, formulario_id: '8' });
  });

  it('una publicación ya hecha: el enlace no viene en el creativo', () => {
    expect(destinoDelCreativo({ id: '1', effective_object_story_id: '9_10' })).toMatchObject({ formato: 'publicacion_existente', url: null, urls: [] });
  });

  it('sin creativo o sin nada reconocible: sin_enlace, nunca un error', () => {
    expect(destinoDelCreativo(undefined)).toMatchObject({ formato: 'sin_enlace', url: null, urls: [] });
    expect(destinoDelCreativo({ id: '1' })).toMatchObject({ formato: 'sin_enlace', url: null });
  });

  it('lo que no es una web no cuenta como URL', () => {
    const d = destinoDelCreativo({ object_story_spec: { link_data: { link: 'fb://page/1' } } });
    expect(d).toMatchObject({ formato: 'enlace', url: null, urls: [] });
  });
});

describe('normalizarEnlace', () => {
  it('quita esquema, www, parámetros (UTM incluidos), ancla y barra final', () => {
    expect(normalizarEnlace('https://www.ISEIH.com/Master-X/?utm_source=fb&utm_campaign=1#top')).toBe('iseih.com/master-x');
    expect(normalizarEnlace('http://iseih.com/master-x')).toBe('iseih.com/master-x');
    expect(normalizarEnlace('iseih.com/master-x///')).toBe('iseih.com/master-x');
  });

  it('vacío si no hay enlace', () => {
    expect(normalizarEnlace(null)).toBe('');
    expect(normalizarEnlace('   ')).toBe('');
  });

  it('dos páginas distintas siguen siendo distintas', () => {
    expect(normalizarEnlace('https://a.com/master-x')).not.toBe(normalizarEnlace('https://a.com/master-x-online'));
  });
});

describe('formacionDelConjunto', () => {
  const productos = [
    { id: 1, url_info: 'https://www.a.com/master-x/' },
    { id: 2, url_info: 'https://a.com/curso-y' },
    { id: 3, url_info: 'https://a.com/repetido' },
    { id: 4, url_info: 'https://a.com/repetido/' },
    { id: 5, url_info: null },
  ];

  it('coincide una: esa formación, aunque cambien esquema, www, barra y UTM', () => {
    expect(formacionDelConjunto(['http://a.com/master-x?utm_source=fb', 'https://www.a.com/master-x'], productos))
      .toEqual({ productId: 1, motivo: 'uno' });
  });

  it('las URLs que no son de ninguna formación no cuentan', () => {
    expect(formacionDelConjunto(['https://a.com/', 'https://a.com/curso-y/'], productos)).toEqual({ productId: 2, motivo: 'uno' });
  });

  it('coinciden varias: no se asocia', () => {
    expect(formacionDelConjunto(['https://a.com/master-x', 'https://a.com/curso-y'], productos))
      .toMatchObject({ productId: null, motivo: 'varios', candidatos: [1, 2] });
  });

  it('dos formaciones con el mismo enlace también son varias', () => {
    expect(formacionDelConjunto(['https://a.com/repetido'], productos)).toMatchObject({ productId: null, motivo: 'varios', candidatos: [3, 4] });
  });

  it('ninguna (o sin URLs, como un formulario instantáneo): no se asocia', () => {
    expect(formacionDelConjunto(['https://otra.com/master-x'], productos)).toMatchObject({ productId: null, motivo: 'ninguno' });
    expect(formacionDelConjunto([], productos)).toMatchObject({ productId: null, motivo: 'ninguno' });
  });
});
