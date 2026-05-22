-- ============================================================
-- Migración 053: simplificar — secciones como TEXT unificado
-- Tira las 4 tablas product_{benefits,objectives,faqs,targets} (creadas en 052)
-- y mueve los datos a columnas TEXT en products + JSONB en wc_credentials.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS product_benefits   CASCADE;
DROP TABLE IF EXISTS product_objectives CASCADE;
DROP TABLE IF EXISTS product_faqs       CASCADE;
DROP TABLE IF EXISTS product_targets    CASCADE;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS presentacion_texto       TEXT,
  ADD COLUMN IF NOT EXISTS objetivos_texto          TEXT,
  ADD COLUMN IF NOT EXISTS beneficios_texto         TEXT,
  ADD COLUMN IF NOT EXISTS dirigido_a_texto         TEXT,
  ADD COLUMN IF NOT EXISTS para_que_te_prepara_texto TEXT,
  ADD COLUMN IF NOT EXISTS por_que_estudiar_texto   TEXT,
  ADD COLUMN IF NOT EXISTS modulos_texto            TEXT,
  ADD COLUMN IF NOT EXISTS metodologia_texto        TEXT,
  ADD COLUMN IF NOT EXISTS faqs_texto               TEXT,
  ADD COLUMN IF NOT EXISTS profesores_texto         TEXT,
  ADD COLUMN IF NOT EXISTS otras_secciones          JSONB DEFAULT '{}'::jsonb;

ALTER TABLE wc_credentials
  ADD COLUMN IF NOT EXISTS section_keywords JSONB DEFAULT
    '{
      "presentacion":         ["presentaci"],
      "objetivos":            ["objetivo"],
      "beneficios":           ["beneficio"],
      "dirigido_a":           ["dirigido", "para quien", "a quien", "destinatario"],
      "para_que_te_prepara":  ["te prepara", "preparacion", "salidas profesionales", "salida laboral"],
      "por_que_estudiar":     ["por que estudiar", "por que elegir", "ventajas"],
      "modulos":              ["contenido del", "temario del", "programa del", "syllabus", "temario", "contenido", "modulos", "modulo", "unidades", "unidad", "bloques"],
      "metodologia":          ["metodologi"],
      "faqs":                 ["pregunta frecuente", "preguntas frecuentes", "faq", "dudas frecuentes"],
      "profesores":           ["profesor", "docente", "instructor", "tutor", "claustro", "profesorado"]
    }'::jsonb,
  ADD COLUMN IF NOT EXISTS scraper_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scrape_strategy VARCHAR(20) NOT NULL DEFAULT 'plain_text'
    CHECK (scrape_strategy IN ('plain_text', 'preserve_html'));

COMMIT;
