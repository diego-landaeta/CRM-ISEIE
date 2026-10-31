-- 247 · La moneda de las facturas de colaboradores (31/10/2026)
--
-- Diego, 31/10, con la factura de Andrea a CEDIA ($356.03): «ella mandó en
-- dólares y aquí sale en euros». El módulo daba por hecho que todo era en euros.
--
-- · colaborador_empresas.moneda: en qué moneda se acuerda con esa empresa (lo
--   acordado, el fijo y la tarifa por hora van en ella).
-- · facturas_colaborador.moneda: la de la factura. Sale de la ficha al preparar
--   el mes y el colaborador la puede cambiar al subirla.
--
-- No se convierte: los totales se suman cada moneda por su lado.
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE colaborador_empresas ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE facturas_colaborador ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'EUR';

DO $$ BEGIN
  ALTER TABLE colaborador_empresas ADD CONSTRAINT colaborador_empresas_moneda_check CHECK (moneda IN ('EUR', 'USD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE facturas_colaborador ADD CONSTRAINT facturas_colaborador_moneda_check CHECK (moneda IN ('EUR', 'USD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN colaborador_empresas.moneda IS
  'En qué moneda se acuerda con esa empresa: EUR o USD (247). Lo acordado, el fijo y la tarifa van en ella.';
COMMENT ON COLUMN facturas_colaborador.moneda IS
  'La moneda de la factura: EUR o USD (247). Sale de la ficha; el colaborador la puede cambiar al subirla.';

COMMIT;
