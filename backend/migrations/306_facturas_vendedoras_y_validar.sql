-- 306 · Facturas del mes: las vendedoras, y «validar» antes de pagar (CRM-ISEIE#422, gemela de CRM#710, 18/11/2026)
--
-- Diego, 09/11 y 18/11: las vendedoras (gestoras y comerciales) suben su
-- factura del mes como los colaboradores (#202), con el mismo enlace, los
-- mismos avisos a la empresa, «Por pagar», el resumen diario y la confirmación
-- del pago (#613). Entra quien esté en la lista, nunca un rol entero: la lista
-- son las fichas de `colaboradores` con `tipo = 'vendedora'`.
--
--   · colaboradores.tipo: 'colaborador' (lo de siempre) o 'vendedora'. Las
--     listas y los totales se filtran por él («Vendedoras / Colaboradores»).
--   · Una sola ficha de vendedora por usuario del CRM: a qué empresas factura
--     va en `colaborador_empresas`, una fila por empresa (la facturación va por
--     empresa, no por campus).
--   · validada_at / validada_por: «la gestora pone su monto y luego la empresa
--     valida y hace el pago». Solo se paga una factura validada; vale para
--     todas, vendedoras y colaboradores (es el mismo módulo).
--
-- Las que ya estaban recibidas se dan por validadas al crear la columna: el
-- paso nuevo vale para las que lleguen desde hoy, y «Por pagar» no se vacía de
-- golpe. Solo esa vez: si la migración se pasa otra vez, no valida nada.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE colaboradores
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(12) NOT NULL DEFAULT 'colaborador';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_colaboradores_tipo') THEN
    ALTER TABLE colaboradores
      ADD CONSTRAINT chk_colaboradores_tipo CHECK (tipo IN ('colaborador', 'vendedora'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_colaboradores_tipo ON colaboradores(tipo);

CREATE UNIQUE INDEX IF NOT EXISTS uq_colaboradores_vendedora_usuario
    ON colaboradores(user_id)
 WHERE tipo = 'vendedora' AND user_id IS NOT NULL;

COMMENT ON COLUMN colaboradores.tipo IS
  'colaborador (externos, #202) o vendedora (gestoras y comerciales de la lista, CRM-ISEIE#422).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'facturas_colaborador' AND column_name = 'validada_at') THEN
    ALTER TABLE facturas_colaborador
      ADD COLUMN validada_at TIMESTAMPTZ,
      ADD COLUMN validada_por INTEGER REFERENCES users(id) ON DELETE SET NULL;
    -- Las recibidas hasta hoy, por validadas: solo al crear la columna.
    UPDATE facturas_colaborador
       SET validada_at = subida_at
     WHERE subida_at IS NOT NULL AND validada_at IS NULL;
  END IF;
END $$;

-- Solo se valida una recibida, y solo se paga una validada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fc_validada_recibida') THEN
    ALTER TABLE facturas_colaborador
      ADD CONSTRAINT chk_fc_validada_recibida CHECK (validada_at IS NULL OR subida_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fc_pagada_validada') THEN
    ALTER TABLE facturas_colaborador
      ADD CONSTRAINT chk_fc_pagada_validada CHECK (pagada_at IS NULL OR validada_at IS NOT NULL);
  END IF;
END $$;

-- «Por validar»: recibidas, vivas y sin validar.
CREATE INDEX IF NOT EXISTS idx_facturas_colaborador_por_validar
    ON facturas_colaborador(issuer_id, periodo)
 WHERE subida_at IS NOT NULL AND anulada_at IS NULL AND validada_at IS NULL;

COMMENT ON COLUMN facturas_colaborador.validada_at IS
  'Cuando la empresa revisó la factura y la dio por buena (306). Sin esto no se paga.';

-- Las tablas ya tenían sus permisos (220); se repiten por si la base se montó sin ellos.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON colaboradores, facturas_colaborador TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
