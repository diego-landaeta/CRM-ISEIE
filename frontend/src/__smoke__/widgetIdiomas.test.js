// @vitest-environment jsdom
// Traída de MultiCRM (12/10). ISEIE no tiene un setup común de pruebas: el entorno va aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { construirSnippet } from '@/modules/widget/lib/snippet';

// El widget de WhatsApp en varios idiomas (Diego, 12/10). Se EJECUTA el código que pega la
// web, en una página de prueba, con el CRM simulado.

const DATOS = {
  enabled: true, project: 'ISEIH', welcome: '¿Hablamos? 👋', template: 'Hola {{project}}, info: {{url}}',
  textos: {
    es: { welcome: '¿Hablamos? 👋', template: 'Hola {{project}}, info: {{url}}' },
    en: { welcome: 'Shall we talk? 👋', template: 'Hi {{project}}, about: {{url}}' },
    fr: { welcome: 'On en parle ? 👋', template: 'Bonjour {{project}}, sur : {{url}}' },
    pt: { welcome: 'Vamos conversar? 👋', template: 'Olá {{project}}, sobre: {{url}}' },
  },
  burbuja: true, retraso: 1000, gestoras: [['Ana', '34600111222']],
};

async function montar({ idioma = '', lang = '', datos = DATOS } = {}) {
  delete window.__c3w;
  document.documentElement.lang = lang;
  const html = construirSnippet({ dataUrl: 'https://crm.test/api/w/data/1.json', idioma });
  const [, cuerpo] = html.split('</style>');
  const [marcado, resto] = cuerpo.split('<script>');
  document.body.innerHTML = marcado;
  const script = resto.split('</script>')[0];
  global.fetch = vi.fn(async () => ({ json: async () => datos }));
  const abrir = vi.spyOn(window, 'open').mockImplementation(() => null);
  // eslint-disable-next-line no-new-func
  new Function(script)();
  await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  return { abrir };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const enlace = (abrir) => { document.getElementById('c3w-btn').click(); return decodeURIComponent(String(abrir.mock.calls.at(-1)?.[0] || '').split('text=')[1] || ''); };

describe('el código de la web elige el idioma', () => {
  it('automático: una página en francés sale en francés', async () => {
    const { abrir } = await montar({ lang: 'fr-FR' });
    expect(document.getElementById('c3w-msg').textContent).toBe('On en parle ? 👋');
    expect(enlace(abrir)).toMatch(/^Bonjour ISEIH, sur : /);
  });
  it('fijado en inglés: en inglés aunque la página sea francesa', async () => {
    const { abrir } = await montar({ idioma: 'en', lang: 'fr' });
    expect(document.getElementById('c3w-msg').textContent).toBe('Shall we talk? 👋');
    expect(enlace(abrir)).toMatch(/^Hi ISEIH, about: /);
  });
  it('un idioma que no tenemos (alemán): sale el español', async () => {
    const { abrir } = await montar({ lang: 'de' });
    expect(document.getElementById('c3w-msg').textContent).toBe('¿Hablamos? 👋');
    expect(enlace(abrir)).toMatch(/^Hola ISEIH, info: /);
  });
  it('los datos de antes (sin «textos») siguen funcionando en español', async () => {
    const { textos, ...viejos } = DATOS;
    const { abrir } = await montar({ lang: 'en', datos: viejos });
    expect(document.getElementById('c3w-msg').textContent).toBe('¿Hablamos? 👋');
    expect(enlace(abrir)).toMatch(/^Hola ISEIH/);
  });
  it('el nombre de la gestora va en la burbuja y el enlace a su número', async () => {
    const { abrir } = await montar({ lang: 'pt' });
    expect(document.getElementById('c3w-name').textContent).toBe('Ana');
    document.getElementById('c3w-btn').click();
    expect(String(abrir.mock.calls.at(-1)[0])).toMatch(/^https:\/\/wa\.me\/34600111222\?text=/);
  });
});

describe('la burbuja hace caso al panel', () => {
  it('sale a los ms configurados', async () => {
    await montar({ lang: 'es' });
    expect(document.getElementById('c3w-tag').className).toBe('');
    vi.advanceTimersByTime(1000);
    expect(document.getElementById('c3w-tag').className).toBe('s');
  });
  it('con «mostrar burbuja» apagado, no sale', async () => {
    await montar({ lang: 'es', datos: { ...DATOS, burbuja: false } });
    vi.advanceTimersByTime(20000);
    expect(document.getElementById('c3w-tag').className).toBe('');
  });
});
