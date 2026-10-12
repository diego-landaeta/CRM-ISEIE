import { describe, it, expect, vi } from 'vitest';

// El widget de WhatsApp en varios idiomas (Diego, 12/10: inglés, francés y portugués).

const config = {
  project_nombre: 'ISEIH', enabled: true, welcome_text: '¿Hablamos? 👋', message_template: 'Hola {{project}}: {{url}}',
  excluded_user_ids: [], show_bubble: false, bubble_delay_ms: 5000,
  traducciones: { en: { welcome: 'Hello from ISEIH 👋' } },
};
vi.mock('../src/modules/widget/widget.model.js', () => ({
  getConfig: vi.fn(async () => config),
  listActiveWidgetUsers: vi.fn(async () => [{ display_name: 'Ana', whatsapp_phone: '34600111222' }]),
  upsertConfig: vi.fn(async (pid, f) => ({ ...config, ...f })),
  listCandidateUsers: vi.fn(async () => []),
}));

const I = await import('../src/modules/widget/widget.idiomas.js');
const ctrl = await import('../src/modules/widget/widget.controller.js');
const service = await import('../src/modules/widget/widget.service.js');
const model = await import('../src/modules/widget/widget.model.js');

const respuesta = () => {
  const r = { cabeceras: {}, cuerpo: null, codigo: 200 };
  r.setHeader = (k, v) => { r.cabeceras[k] = v; };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  r.type = () => r; r.send = (b) => { r.cuerpo = b; return r; };
  return r;
};

describe('los textos de cada idioma', () => {
  it('lo escrito por el campus manda; lo que falta, el de por defecto', () => {
    const t = I.textosPorIdioma(config);
    expect(t.es).toEqual({ welcome: '¿Hablamos? 👋', template: 'Hola {{project}}: {{url}}' });
    expect(t.en.welcome).toBe('Hello from ISEIH 👋');
    expect(t.en.template).toBe(I.POR_DEFECTO.en.template);
    expect(t.fr).toEqual(I.POR_DEFECTO.fr);
    expect(t.pt).toEqual(I.POR_DEFECTO.pt);
  });
  it('el idioma de una petición: «pt-BR» es portugués; uno que no tenemos, español', () => {
    expect(I.idiomaDe('pt-BR')).toBe('pt');
    expect(I.idiomaDe('EN')).toBe('en');
    expect(I.idiomaDe('de')).toBe('es');
    expect(I.idiomaDe(undefined)).toBe('es');
  });
  it('al guardar: fuera los idiomas vacíos y los textos en blanco', () => {
    expect(I.limpiarTraducciones({ en: { welcome: '  Hi  ', template: '' }, fr: { welcome: '', template: '   ' } })).toEqual({ en: { welcome: 'Hi' } });
  });
  it('no se aceptan idiomas desconocidos ni otros campos', () => {
    expect(I.traduccionesSchema.safeParse({ de: { welcome: 'Hallo' } }).success).toBe(false);
    expect(I.traduccionesSchema.safeParse({ en: { welcome: 'Hi', otro: 'x' } }).success).toBe(false);
    expect(I.traduccionesSchema.safeParse({ en: { welcome: 'x'.repeat(501) } }).success).toBe(false);
    expect(I.traduccionesSchema.safeParse({ fr: { welcome: 'Salut', template: 'Bonjour {{url}}' } }).success).toBe(true);
  });
});

describe('lo que recibe la web', () => {
  it('los textos de cada idioma, y la burbuja como dice el panel', async () => {
    const res = respuesta();
    await ctrl.widgetData({ params: { projectIdJson: '1.json' } }, res);
    expect(res.cuerpo.welcome).toBe('¿Hablamos? 👋'); // los códigos de antes siguen leyendo esto
    expect(res.cuerpo.textos.en.welcome).toBe('Hello from ISEIH 👋');
    expect(res.cuerpo.textos.fr.welcome).toBe(I.POR_DEFECTO.fr.welcome);
    expect(res.cuerpo.burbuja).toBe(false);
    expect(res.cuerpo.retraso).toBe(5000);
    expect(res.cuerpo.gestoras).toEqual([['Ana', '34600111222']]);
  });
  it('el script antiguo, con ?lang=fr, lleva los textos en francés', async () => {
    const js = await service.generateWidgetScript(1, 'fr');
    expect(js).toContain(I.POR_DEFECTO.fr.welcome.replace(/'/g, "\'"));
    expect(js).not.toContain('¿Hablamos?');
  });
});

describe('guardar desde el panel', () => {
  it('limpia las traducciones antes de guardarlas', async () => {
    const res = respuesta(); const next = vi.fn();
    await ctrl.updateConfig({ body: { projectId: 1, traducciones: { en: { welcome: ' Hi ', template: '' } } } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(model.upsertConfig).toHaveBeenLastCalledWith(1, expect.objectContaining({ traducciones: { en: { welcome: 'Hi' } } }));
  });
  it('un idioma que no existe: 400', async () => {
    const res = respuesta(); const next = vi.fn();
    await ctrl.updateConfig({ body: { projectId: 1, traducciones: { de: { welcome: 'Hallo' } } } }, res, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
  it('sin «traducciones» en la petición, no se tocan', async () => {
    const res = respuesta(); const next = vi.fn();
    await ctrl.updateConfig({ body: { projectId: 1, welcome_text: 'Hola' } }, res, next);
    expect(model.upsertConfig).toHaveBeenLastCalledWith(1, expect.objectContaining({ traducciones: undefined }));
  });
});
