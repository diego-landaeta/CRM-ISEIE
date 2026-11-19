-- 319 · Cambiar la fecha de una factura emitida, con registro (19/11/2026)
--
-- Diego, 19/11: «habilita la edición para que puedan editar las fechas». La
-- #793 cerró las emitidas a todo cambio; se abren SOLO las fechas, con el
-- permiso «Cambiar fechas» (facturas.editar_fechas), y la de emisión solo
-- dentro de su sitio en la serie: entre la del número anterior y la del
-- siguiente. Cada cambio queda aquí: quién, cuándo, y la fecha de antes y la
-- de después. Se ve en la ficha de la factura.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS invoice_cambios_fecha (
  id                    BIGSERIAL PRIMARY KEY,
  invoice_id            INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  fecha_emision_antes   DATE,
  fecha_emision_despues DATE,
  fecha_pago_antes      DATE,
  fecha_pago_despues    DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_cambios_fecha_invoice ON invoice_cambios_fecha (invoice_id, created_at DESC);

COMMENT ON TABLE invoice_cambios_fecha IS
  'Cada cambio de fecha de una factura (319): quién, cuándo, y la fecha de antes y la de después.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_cambios_fecha TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE invoice_cambios_fecha_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
