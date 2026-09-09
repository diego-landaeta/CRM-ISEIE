-- Si se está buscando tutor para una formación, y con qué anuncio.
--
-- Diego: «necesito la columna de META para saber qué tiene publicidad — eso es
-- publicidad para buscar tutores de los que falten».
--
-- POR QUÉ HACE FALTA UNA TABLA Y NO VALE LO QUE YA HAY. El CRM ya sincroniza
-- Meta entero: 32 campañas y 914 conjuntos de anuncios, al día de hoy. Y hay
-- publicidad de tutores de verdad — «Tutores ICTESS» (activa) y «Nuevos Tutores
-- Fono Aprende» (pausada). Pero las tablas que unen un anuncio con un producto
-- —`meta_campaign_products` y `meta_adset_products`— están **vacías: cero
-- filas**. Nadie las ha usado nunca. Así que una columna calculada a partir de
-- ellas saldría en blanco en las catorce formaciones, que es peor que no tener
-- columna: parece que no hay publicidad cuando la hay.
--
-- POR QUÉ NO SE ADIVINA POR EL NOMBRE. Los conjuntos se llaman «Tutores ICTESS
-- - FPA Incendios» o «Tutores ICTESS - Ingeniero eléctrico»: son especialidades,
-- no formaciones del catálogo. Contra «Máster en Nutrición Holística
-- Integrativa» no casa ninguno. Adivinar aquí daría o silencio o falsos
-- positivos, y un falso positivo es peor: se deja de buscar tutor para algo que
-- nadie está anunciando.
--
-- Así que se registra lo que una persona sabe y el CRM no puede deducir. Dos
-- datos distintos, a propósito:
--
--   · `buscando`   — se está buscando tutor. Lo marca quien lleva las
--                    colaboraciones, y vale por sí solo: se busca por WhatsApp
--                    y por conocidos mucho antes de pagar un anuncio.
--   · `adset_id` / `campaign_id` — y además hay un anuncio pagado, este.
--
-- Buscar sin anuncio es lo normal. Anuncio sin buscar no debería pasar, pero si
-- pasa se enseña igual: el dinero está saliendo.

CREATE TABLE IF NOT EXISTS tutor_busquedas (
  id                    SERIAL PRIMARY KEY,
  product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  buscando              BOOLEAN NOT NULL DEFAULT true,
  -- Sin FK a `meta_campaigns` / `meta_adsets` A PROPÓSITO. Esas tablas son un
  -- reflejo de lo que hay en Meta y la sincronización manda: el día que alguien
  -- archive el anuncio allí, una FK con CASCADE se llevaría por delante el
  -- registro de que se está buscando tutor, y con ON DELETE SET NULL se
  -- perdería en silencio cuál era. Guardado suelto, si el anuncio desaparece la
  -- pantalla lo dice —«ese anuncio ya no está en Meta»— en vez de olvidarlo.
  campaign_id           VARCHAR(50),
  adset_id              VARCHAR(50),
  nota                  TEXT,
  marcada_por_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una formación se busca o no se busca: no caben dos respuestas.
  UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS idx_tutor_busquedas_project
  ON tutor_busquedas (project_id) WHERE buscando;

COMMENT ON TABLE tutor_busquedas IS
  'Si se está buscando tutor para una formación y con qué anuncio de Meta. Lo marca una persona: Meta no sabe a qué formación del catálogo apunta cada conjunto de anuncios.';

-- Permisos (#71): las tablas nuevas nacen siendo de `postgres` porque la
-- migración corre como postgres. Se comprueba SIEMPRE con el usuario del CRM.
DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tutor_busquedas TO %I', u);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE tutor_busquedas_id_seq TO %I', u);
    END IF;
  END LOOP;
END $$;
