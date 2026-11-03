import { describe, it, expect } from 'vitest';
import { deducirCanal, tienePistaDeOrigen, hostDe, planearRecalculo, CANAL_DE_LAS_OTRAS_IA } from '../src/modules/leads/canal.js';

/**
 * La regla de origen → canal (#48), en un solo sitio.
 *
 * Es una función pura: aquí se fija cada fila de la tabla de la issue y los
 * casos que la hacen difícil (ChatGPT sin referrer, con utm_source, con las dos
 * cosas; los subdominios; la propia web como referrer).
 */

const LANDING = 'https://ejemplo.org/curso-de-coaching/';

describe('ChatGPT, mirando las DOS pistas (tiene truco)', () => {
  it('con referrer y sin utm', () => {
    expect(deducirCanal({ referrer: 'https://chatgpt.com/', landing_url: LANDING })).toBe('chatgpt_ia');
    expect(deducirCanal({ referrer: 'https://chat.openai.com/c/abc', landing_url: LANDING })).toBe('chatgpt_ia');
    expect(deducirCanal({ referrer: 'https://www.openai.com/', landing_url: LANDING })).toBe('chatgpt_ia');
  });

  it('con utm_source=chatgpt.com y SIN referrer (llega así muchas veces)', () => {
    expect(deducirCanal({ utm_source: 'chatgpt.com', landing_url: `${LANDING}?utm_source=chatgpt.com` })).toBe('chatgpt_ia');
    expect(deducirCanal({ utm_source: 'chatgpt' })).toBe('chatgpt_ia');
    expect(deducirCanal({ utm_source: 'openai' })).toBe('chatgpt_ia');
  });

  it('con las dos cosas', () => {
    expect(deducirCanal({ utm_source: 'chatgpt.com', referrer: 'https://chatgpt.com/' })).toBe('chatgpt_ia');
  });

  it('un dominio que solo CONTIENE «openai.com» no es de OpenAI', () => {
    expect(deducirCanal({ referrer: 'https://notopenai.com/' })).toBe('referido');
    expect(deducirCanal({ referrer: 'https://openai.com.estafa.example/' })).toBe('referido');
  });
});

describe('las otras IA van a una sola constante, hasta que se decida su nombre', () => {
  it('perplexity, gemini, copilot y claude', () => {
    for (const referrer of ['https://www.perplexity.ai/search', 'https://gemini.google.com/app', 'https://copilot.microsoft.com/', 'https://claude.ai/chat']) {
      expect(deducirCanal({ referrer })).toBe(CANAL_DE_LAS_OTRAS_IA);
    }
    expect(deducirCanal({ utm_source: 'perplexity.ai' })).toBe(CANAL_DE_LAS_OTRAS_IA);
  });

  it('gemini.google.com NO es el buscador de Google', () => {
    expect(deducirCanal({ referrer: 'https://gemini.google.com/' })).not.toBe('organico');
  });
});

describe('los clics de pago', () => {
  it('gclid → google_ads, fbclid → meta_ads, ttclid → tiktok_ads', () => {
    expect(deducirCanal({ landing_url: `${LANDING}?gclid=EAIa` })).toBe('google_ads');
    expect(deducirCanal({ landing_url: `${LANDING}?fbclid=IwAR0` })).toBe('meta_ads');
    expect(deducirCanal({ landing_url: `${LANDING}?ttclid=E.C.P` })).toBe('tiktok_ads');
  });

  it('pesan más que un referrer de buscador', () => {
    expect(deducirCanal({ referrer: 'https://www.google.com/', landing_url: `${LANDING}?gclid=EAIa` })).toBe('google_ads');
  });
});

describe('utm_source', () => {
  it.each(['fb', 'ig', 'facebook', 'Instagram', 'meta', 'facebook_ads', 'fb-ads', 'ig_story'])('%s → meta_ads', (utm_source) => {
    expect(deducirCanal({ utm_source })).toBe('meta_ads');
  });

  it('«big» o «digital» no son Instagram', () => {
    expect(deducirCanal({ utm_source: 'big-newsletter' })).toBe('referido');
    expect(deducirCanal({ utm_source: 'digital' })).toBe('referido');
  });

  it('google de pago → google_ads; google sin pago → organico', () => {
    for (const utm_medium of ['cpc', 'ppc', 'paid']) expect(deducirCanal({ utm_source: 'google', utm_medium })).toBe('google_ads');
    expect(deducirCanal({ utm_source: 'google' })).toBe('organico');
    expect(deducirCanal({ utm_source: 'bing', utm_medium: 'organic' })).toBe('organico');
  });

  it('tiktok y whatsapp', () => {
    expect(deducirCanal({ utm_source: 'tiktok', utm_medium: 'paid' })).toBe('tiktok_ads');
    expect(deducirCanal({ utm_source: 'whatsapp' })).toBe('whatsapp');
  });

  it('una fuente desconocida (un boletín, una alianza) es referido, no directo', () => {
    expect(deducirCanal({ utm_source: 'boletin-octubre', utm_medium: 'email' })).toBe('referido');
  });
});

describe('utm_medium', () => {
  it('referral → referido y organic → organico', () => {
    expect(deducirCanal({ utm_medium: 'referral' })).toBe('referido');
    expect(deducirCanal({ utm_medium: 'organic' })).toBe('organico');
  });
});

describe('el referrer', () => {
  it('un buscador sin clic de pago → organico', () => {
    for (const referrer of ['https://www.google.com/', 'https://www.google.es/search?q=x', 'https://www.bing.com/', 'https://duckduckgo.com/', 'https://es.search.yahoo.com/']) {
      expect(deducirCanal({ referrer, landing_url: LANDING })).toBe('organico');
    }
  });

  it('cualquier otra web → referido', () => {
    expect(deducirCanal({ referrer: 'https://blog-de-un-amigo.example/post', landing_url: LANDING })).toBe('referido');
    expect(deducirCanal({ referrer: 'https://l.facebook.com/l.php?u=x', landing_url: LANDING })).toBe('referido');
  });

  it('la propia web como referrer es navegación interna: no cuenta', () => {
    expect(deducirCanal({ referrer: 'https://ejemplo.org/otra-pagina/', landing_url: LANDING })).toBe('directo');
    expect(deducirCanal({ referrer: 'https://www.ejemplo.org/', landing_url: LANDING })).toBe('directo');
  });

  it('un referrer que no es una dirección no inventa nada', () => {
    expect(deducirCanal({ referrer: 'no es una web', landing_url: LANDING })).toBe('directo');
    expect(deducirCanal({ referrer: '   ' })).toBe('directo');
  });
});

describe('sin pistas', () => {
  it('directo', () => {
    expect(deducirCanal({})).toBe('directo');
    expect(deducirCanal()).toBe('directo');
    expect(deducirCanal({ landing_url: LANDING })).toBe('directo');
  });

  it('las UTM mandan sobre el referrer cuando dicen más (utm_source=fb desde un referrer de Instagram)', () => {
    expect(deducirCanal({ utm_source: 'fb', referrer: 'https://l.instagram.com/' })).toBe('meta_ads');
  });
});

describe('«sin origen» no es lo mismo que «directo»', () => {
  it('hay pista si hay cualquier campo con texto', () => {
    expect(tienePistaDeOrigen({ landing_url: LANDING })).toBe(true);
    expect(tienePistaDeOrigen({ referrer: 'https://chatgpt.com/' })).toBe(true);
    expect(tienePistaDeOrigen({ utm_campaign: '123' })).toBe(true);
  });

  it('y no la hay con todo vacío, en blanco o ausente', () => {
    expect(tienePistaDeOrigen({})).toBe(false);
    expect(tienePistaDeOrigen()).toBe(false);
    expect(tienePistaDeOrigen({ utm_source: '', utm_medium: '  ', landing_url: null })).toBe(false);
  });
});

describe('hostDe', () => {
  it('quita www. y acepta una dirección o un dominio suelto', () => {
    expect(hostDe('https://www.Ejemplo.org/a?b=1')).toBe('ejemplo.org');
    expect(hostDe('chatgpt.com')).toBe('chatgpt.com');
    expect(hostDe('')).toBeNull();
    expect(hostDe(null)).toBeNull();
    expect(hostDe(42)).toBeNull();
  });
});

describe('aplicar la regla hacia atrás (planearRecalculo)', () => {
  const fila = (extra) => ({
    lead_id: 1, canal_detectado: 'directo', utm_source: null, utm_medium: null, utm_campaign: null,
    utm_content: null, utm_term: null, referrer: null, landing_url: null, ...extra,
  });

  it('un lead de Meta que entró como «directo» con las UTM dentro de la dirección', () => {
    const url = 'https://psikoaprende.com/curso/?fbclid=Iw&utm_medium=paid&utm_source=fb&utm_campaign=120244428100730715';
    const { cambios } = planearRecalculo([fila({ landing_url: url })]);
    expect(cambios).toEqual([{
      lead_id: 1, canal_antes: 'directo', canal_nuevo: 'meta_ads',
      utms_nuevas: { utm_source: 'fb', utm_medium: 'paid', utm_campaign: '120244428100730715' },
    }]);
  });

  it('un canal puesto a mano o por Make NO se toca, aunque la regla dijera otra cosa', () => {
    const r = planearRecalculo([fila({ canal_detectado: 'whatsapp', landing_url: 'https://x.example/?utm_source=chatgpt.com' })]);
    expect(r.cambios).toEqual([]);
    expect(r.respetadas).toBe(1);
  });

  it('sin canal y con referrer de ChatGPT guardado → chatgpt_ia', () => {
    const { cambios } = planearRecalculo([fila({ canal_detectado: null, referrer: 'https://chatgpt.com/' })]);
    expect(cambios[0]).toMatchObject({ canal_antes: null, canal_nuevo: 'chatgpt_ia', utms_nuevas: {} });
  });

  it('no pisa una UTM que ya estaba escrita', () => {
    const { cambios } = planearRecalculo([fila({ utm_source: 'google', landing_url: 'https://x.example/?utm_source=fb&utm_campaign=7' })]);
    expect(cambios[0].utms_nuevas).toEqual({ utm_campaign: '7' });
  });

  it('sin ninguna pista no inventa nada', () => {
    const r = planearRecalculo([fila({}), fila({ lead_id: 2, canal_detectado: null })]);
    expect(r).toEqual({ cambios: [], sinPista: 2, respetadas: 0 });
  });

  it('un «directo» que sigue siendo directo, sin UTM que rellenar, no es un cambio', () => {
    expect(planearRecalculo([fila({ landing_url: 'https://x.example/curso/' })]).cambios).toEqual([]);
  });
});
