-- Meta Ads en el conector MCP (#362): lo que hace falta para contestar «qué
-- formaciones cambiamos esta semana, cuáles se quedan y qué creativos
-- cambiamos» leyendo solo el CRM.
--
-- Solo añade columnas: no cambia ni borra nada de lo que ya hay. Se puede
-- lanzar dos veces.

-- 1) Fechas. Los anuncios ya traían su fecha de creación; los conjuntos, no.
ALTER TABLE meta_adsets ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ;

-- 2) El gasto de TODA la vida del conjunto y del anuncio, tal como lo da Meta
--    (insights con date_preset=maximum). `total_spend` NO es eso: es la suma de
--    los días sincronizados (90 días antes de conectar la cuenta en adelante), y
--    lo sigue usando la pantalla. NULL = todavía no se ha pedido a Meta.
ALTER TABLE meta_adsets ADD COLUMN IF NOT EXISTS lifetime_spend       NUMERIC(14,2);
ALTER TABLE meta_adsets ADD COLUMN IF NOT EXISTS lifetime_impressions BIGINT;
ALTER TABLE meta_adsets ADD COLUMN IF NOT EXISTS lifetime_clicks      BIGINT;
ALTER TABLE meta_adsets ADD COLUMN IF NOT EXISTS lifetime_synced_at   TIMESTAMPTZ;

ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS lifetime_spend       NUMERIC(14,2);
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS lifetime_impressions BIGINT;
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS lifetime_clicks      BIGINT;
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS lifetime_synced_at   TIMESTAMPTZ;

-- 3) La URL de destino de cada anuncio, sacada del creativo al sincronizar.
--    `url_destino` es la principal (en un carrusel, la de la primera tarjeta) y
--    `urls_destino`, todas, sin repetir. Un formulario instantáneo no tiene URL:
--    lleva el id del formulario.
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS url_destino      TEXT;
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS urls_destino     TEXT[];
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS formato_creativo VARCHAR(30);
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS lead_form_id     VARCHAR(50);
ALTER TABLE meta_ads ADD COLUMN IF NOT EXISTS url_tags         TEXT;

-- 4) Asociación conjunto ↔ formación: quién la hizo. Las que ya hay son de una
--    persona ('manual'); las que pone la sincronización por la URL, 'auto'.
ALTER TABLE meta_adset_products ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_adset_products_origen_check') THEN
    ALTER TABLE meta_adset_products
      ADD CONSTRAINT meta_adset_products_origen_check CHECK (origen IN ('manual', 'auto'));
  END IF;
END$$;

-- Cuando una persona guarda las formaciones de un conjunto (aunque sea dejarlo
-- sin ninguna), la sincronización ya no lo toca nunca más.
ALTER TABLE meta_adsets ADD COLUMN IF NOT EXISTS productos_manual_at TIMESTAMPTZ;
