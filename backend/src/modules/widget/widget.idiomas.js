import { z } from 'zod';

/**
 * Los idiomas del widget de WhatsApp (Diego, 12/10: «poder sacar versiones idiomáticas:
 * inglés, francés y así»; eligió inglés, francés y portugués).
 *
 * El español es el idioma BASE: sus textos son `welcome_text` y `message_template` de
 * siempre. Los demás se guardan en `project_widget_config.traducciones` y, si un campus no
 * ha escrito el suyo, sale la traducción por defecto de aquí: una web en inglés nunca
 * enseña la burbuja en español.
 */
export const IDIOMA_BASE = 'es';
export const IDIOMAS = ['es', 'en', 'fr', 'pt'];
export const NOMBRE_IDIOMA = { es: 'Español', en: 'English', fr: 'Français', pt: 'Português' };

/** Los textos por defecto de cada idioma que no es el base. Mismas variables que el español. */
export const POR_DEFECTO = {
  en: { welcome: 'Shall we talk? 👋', template: 'Hi {{project}}, I would like some information about: {{url}}' },
  fr: { welcome: 'On en parle ? 👋', template: 'Bonjour {{project}}, je souhaite des informations sur : {{url}}' },
  pt: { welcome: 'Vamos conversar? 👋', template: 'Olá {{project}}, gostaria de receber informações sobre: {{url}}' },
};

const texto = (max) => z.string().trim().max(max).optional().nullable();
const unIdioma = z.object({ welcome: texto(500), template: texto(1000) }).strict();

/** Lo que se acepta al guardar: solo idiomas conocidos (no el base) y solo esos dos textos. */
export const traduccionesSchema = z.object({
  en: unIdioma.optional(),
  fr: unIdioma.optional(),
  pt: unIdioma.optional(),
}).strict();

/**
 * Deja las traducciones limpias para guardar: sin idiomas vacíos ni textos en blanco (un
 * texto vacío quiere decir «usa el de por defecto»).
 */
export function limpiarTraducciones(t) {
  const out = {};
  for (const [idioma, textos] of Object.entries(t || {})) {
    if (!IDIOMAS.includes(idioma) || idioma === IDIOMA_BASE || !textos) continue;
    const limpio = {};
    if (textos.welcome?.trim()) limpio.welcome = textos.welcome.trim();
    if (textos.template?.trim()) limpio.template = textos.template.trim();
    if (Object.keys(limpio).length) out[idioma] = limpio;
  }
  return out;
}

/**
 * Los textos que ve el visitante en cada idioma: lo escrito por el campus y, si falta, el
 * de por defecto. El español sale de los campos de siempre.
 */
export function textosPorIdioma(config) {
  const guardadas = config?.traducciones || {};
  const out = { [IDIOMA_BASE]: { welcome: config?.welcome_text || '', template: config?.message_template || '' } };
  for (const idioma of IDIOMAS) {
    if (idioma === IDIOMA_BASE) continue;
    out[idioma] = {
      welcome: guardadas[idioma]?.welcome || POR_DEFECTO[idioma].welcome,
      template: guardadas[idioma]?.template || POR_DEFECTO[idioma].template,
    };
  }
  return out;
}

/** El idioma de una petición (`?lang=en`, `pt-BR`…): uno de los conocidos o el base. */
export function idiomaDe(valor) {
  const corto = String(valor || '').trim().slice(0, 2).toLowerCase();
  return IDIOMAS.includes(corto) ? corto : IDIOMA_BASE;
}
