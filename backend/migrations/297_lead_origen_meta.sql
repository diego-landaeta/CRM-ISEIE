-- ============================================================
-- 297: el conjunto y el anuncio de Meta de cada prospecto (puerta 8, #487)
-- Gemela de CRM#806 (MultiCRM, migración 288, PR #849).
-- ============================================================
-- Manuel, 16/11/2026 (tarea n.º 363 del tablero): que Claude conteste «qué
-- creativos cambiamos» leyendo solo el CRM. Para eso cada prospecto de Meta
-- tiene que decir de qué campaña, conjunto y anuncio vino. Hoy, según por dónde
-- entre, se guarda solo la campaña (en `utm_campaign`, a veces como id y a veces
-- como nombre) o nada.
--
-- Se guardan los ids de Meta, los mismos que `meta_campaigns`, `meta_adsets` y
-- `meta_ads` (migraciones 071, 072 y 279). Sin clave foránea a propósito: el
-- prospecto puede entrar antes de que la sincronización traiga el anuncio, y un
-- anuncio borrado en Meta no debe borrar de dónde vino nadie.
--
--   meta_origen_por  'envio' → lo mandó Make o el formulario (ad_id, adset_id…)
--                    'url'   → salió de las UTM (utm_content = anuncio,
--                              utm_term = conjunto, utm_campaign = campaña) y se
--                              confirmó contra las tablas de Meta
--
-- Lo que ya hay se rellena desde la aplicación (después de cada sincronización
-- de Meta, `rellenarOrigenMeta`), no aquí: así lo de antes y lo de después usan
-- la misma regla.
--
-- Solo añade columnas e índices. Se puede pasar dos veces. Para deshacerlo:
--   ALTER TABLE lead_utms DROP COLUMN meta_campaign_id, DROP COLUMN meta_adset_id,
--     DROP COLUMN meta_ad_id, DROP COLUMN meta_origen_por;

BEGIN;

ALTER TABLE lead_utms
  ADD COLUMN IF NOT EXISTS meta_campaign_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS meta_adset_id    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS meta_ad_id       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS meta_origen_por  VARCHAR(10);

ALTER TABLE lead_utms DROP CONSTRAINT IF EXISTS lead_utms_meta_origen_por_check;
ALTER TABLE lead_utms ADD CONSTRAINT lead_utms_meta_origen_por_check
  CHECK (meta_origen_por IS NULL OR meta_origen_por IN ('envio', 'url'));

-- El filtro por conjunto de «buscar_prospectos» y los cruces por anuncio.
CREATE INDEX IF NOT EXISTS idx_lead_utms_meta_adset    ON lead_utms (meta_adset_id)    WHERE meta_adset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_utms_meta_ad       ON lead_utms (meta_ad_id)       WHERE meta_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_utms_meta_campaign ON lead_utms (meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;

COMMENT ON COLUMN lead_utms.meta_adset_id IS
  'Conjunto de anuncios de Meta del que vino el prospecto (id de meta_adsets). Puerta 8, #487 (gemela de CRM#806).';
COMMENT ON COLUMN lead_utms.meta_ad_id IS
  'Anuncio de Meta del que vino el prospecto (id de meta_ads). Puerta 8, #487 (gemela de CRM#806).';

COMMIT;
