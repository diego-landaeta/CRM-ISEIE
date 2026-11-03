-- CRM-ISEIE 269 = la parte de esquema de la 153 de MultiCRM (paridad 2.6.0, 03/11/2026).
--
-- `whatsapp.model.js` (listTemplates) lee `pide_adjunto` y `pista` de las
-- plantillas de WhatsApp desde que ISEIE se puso al nivel de MultiCRM, pero
-- ninguna migración de ISEIE creaba esas columnas. En una base nueva (la de la
-- CI) el listado de plantillas daba 500 «column t.pide_adjunto does not exist».
--
-- Solo las columnas: los textos de cada plantilla (los UPDATE por etiqueta de la
-- 153) se quedan en MultiCRM. Reaplicable: no hace nada donde ya estén.

ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS pide_adjunto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS pista TEXT;

COMMENT ON COLUMN whatsapp_templates.pide_adjunto IS
  'Al elegirla, el chat abre el selector de archivos: esta plantilla va con una imagen detras.';
COMMENT ON COLUMN whatsapp_templates.pista IS
  'Aviso para la gestora, NO se envia. Es la letra pequena del documento comercial.';

DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO %I', u);
    END IF;
  END LOOP;
END $$;
