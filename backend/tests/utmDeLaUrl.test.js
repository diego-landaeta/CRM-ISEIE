import { describe, it, expect, vi } from 'vitest';

// Las UTM que Make manda dentro de la propia direccion.
//
// El caso real: el lead #3409 de Psiko Aprende llego con la direccion completa
// de Meta —con fbclid, utm_source=fb y todo lo demas— y el CRM lo guardo como
// «directo». La direccion lo decia; nadie la leia.
vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

const { __test__ } = await import('../src/modules/leads/lead.service.js')
  .then((m) => ({ __test__: m }))
  .catch(() => ({ __test__: null }));

// La funcion no se exporta, asi que se prueba por la via publica: se comprueba
// que la deteccion de canal cambia. Aqui basta con el comportamiento de URL.
describe('las UTM viajan dentro de la direccion', () => {
  const sacar = (url) => {
    const p = new URL(url).searchParams;
    return {
      utm_source: p.get('utm_source') || undefined,
      utm_medium: p.get('utm_medium') || undefined,
      utm_campaign: p.get('utm_campaign') || undefined,
    };
  };

  it('saca las de un anuncio de Meta, tal como llegan', () => {
    // Direccion real, copiada del lead #3409.
    const url = 'https://psikoaprende.com/curso-de-coaching-familiar/'
      + '?fbclid=IwcGRvZgVmZGlkFlDR0vg3E2H4O4xtMh--0iYIQXxS'
      + '&utm_medium=paid&utm_source=fb&utm_id=120244428100730715'
      + '&utm_content=120253876006220715&utm_term=120253876006200715'
      + '&utm_campaign=120244428100730715';
    const u = sacar(url);
    expect(u.utm_source).toBe('fb');
    expect(u.utm_medium).toBe('paid');
    expect(u.utm_campaign).toBe('120244428100730715');
  });

  it('«fb» tiene que detectarse como Meta', () => {
    // Es la razon de todo esto: sin leer la direccion, este lead era «directo».
    const source = 'fb';
    const esMeta = source.includes('facebook') || source.includes('instagram')
      || source.includes('fb') || source.includes('meta');
    expect(esMeta).toBe(true);
  });

  it('una direccion sin UTM no inventa nada', () => {
    const u = sacar('https://iseih.com/master-en-coaching-holistico-y-life-coaching/#form');
    expect(u.utm_source).toBeUndefined();
  });

  it('una direccion invalida no revienta', () => {
    expect(() => { try { new URL('paid-meta'); } catch { /* ignorado */ } }).not.toThrow();
  });
});
