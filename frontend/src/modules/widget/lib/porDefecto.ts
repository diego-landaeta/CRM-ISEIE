/**
 * Los textos por defecto del widget en cada idioma que no es el español. Los mismos que
 * `backend/src/modules/widget/widget.idiomas.js` (POR_DEFECTO): el panel los enseña como
 * ejemplo y la web los usa si el campus no escribe los suyos.
 */
export const POR_DEFECTO_WIDGET = {
  en: { welcome: 'Shall we talk? 👋', template: 'Hi {{project}}, I would like some information about: {{url}}' },
  fr: { welcome: 'On en parle ? 👋', template: 'Bonjour {{project}}, je souhaite des informations sur : {{url}}' },
  pt: { welcome: 'Vamos conversar? 👋', template: 'Olá {{project}}, gostaria de receber informações sobre: {{url}}' },
} as const;
