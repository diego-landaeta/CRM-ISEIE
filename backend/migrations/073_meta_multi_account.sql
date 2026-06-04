-- Multi-cuenta: un proyecto puede tener N cuentas publicitarias Meta.
-- Antes: meta_ad_accounts.project_id era UNIQUE (1:1 estricto). Ahora permitimos
-- varias filas por project_id, sigue siendo UNIQUE el par (project_id, ad_account_id)
-- para evitar duplicar la misma cuenta dentro del mismo proyecto.

ALTER TABLE meta_ad_accounts DROP CONSTRAINT IF EXISTS meta_ad_accounts_project_id_key;

-- Evitar que el mismo ad_account se conecte dos veces al mismo proyecto.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_ad_accounts_project_ad_unique'
  ) THEN
    ALTER TABLE meta_ad_accounts ADD CONSTRAINT meta_ad_accounts_project_ad_unique UNIQUE (project_id, ad_account_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_project ON meta_ad_accounts(project_id);
