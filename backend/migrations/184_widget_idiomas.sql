-- 184 · Widget de WhatsApp en varios idiomas (Diego, 12/10: «el widget, poder sacar versiones
-- idiomáticas: inglés, francés y así»).
--
-- `welcome_text` y `message_template` siguen siendo el ESPAÑOL (el idioma base). Las otras
-- versiones van en `traducciones`, por idioma: {"en": {"welcome": "...", "template": "..."},
-- "fr": {...}, "pt": {...}}. Lo que falte sale con la traducción por defecto del CRM
-- (widget.idiomas.js), así que una web en inglés nunca enseña la burbuja en español.
--
-- Reaplicable: ADD COLUMN IF NOT EXISTS y un UPDATE que solo toca el texto por defecto mal
-- escrito («¡Hablamos?», con la apertura de exclamación), nunca uno escrito a mano.

ALTER TABLE project_widget_config
  ADD COLUMN IF NOT EXISTS traducciones JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN project_widget_config.traducciones IS
  'Textos del widget por idioma (en, fr, pt): {"en":{"welcome":"…","template":"…"}}. El español va en welcome_text y message_template.';

UPDATE project_widget_config SET welcome_text = '¿Hablamos? 👋'
 WHERE welcome_text = '¡Hablamos? 👋';
