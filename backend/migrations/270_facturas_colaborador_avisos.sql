-- 270 · Facturas de colaboradores: avisos a la empresa y confirmación del pago (04/11/2026)
--
-- Diego, 04/11: «que el CRM avise a las personas, llegó X facturas cada vez que
-- la suban … y cada día mande faltan facturas por pagar … y poner en ese correo
-- de factura pagada un botón como: he recibido y confirmo mi pago y que también
-- tenga feedback». Recoge también CRM-ISEIE#348 / CRM#613 (03/11: avisar al
-- correo de facturación de cada empresa al recibir una factura).
--
--   · aviso_empresa_at: cuándo salió (o se dio por hecho) el aviso «Han llegado N
--     facturas» al correo de facturación de la empresa. NULL = aún en la cola: el
--     trabajo programado junta las que llegan seguidas en un solo correo.
--   · pago_confirmado_at / pago_valoracion / pago_comentario / pago_feedback_at:
--     el colaborador confirma desde el correo de «Factura pagada» que recibió el
--     dinero, y si quiere deja su opinión (1 a 5 y un comentario).
--   · facturas_colaborador_resumenes: un resumen «Faltan facturas por pagar» por
--     empresa y día. La clave primaria impide mandar dos el mismo día.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE facturas_colaborador
  ADD COLUMN IF NOT EXISTS aviso_empresa_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pago_confirmado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pago_valoracion    SMALLINT,
  ADD COLUMN IF NOT EXISTS pago_comentario    TEXT,
  ADD COLUMN IF NOT EXISTS pago_feedback_at   TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facturas_colaborador_pago_valoracion_check') THEN
    ALTER TABLE facturas_colaborador
      ADD CONSTRAINT facturas_colaborador_pago_valoracion_check CHECK (pago_valoracion BETWEEN 1 AND 5);
  END IF;
END $$;

-- Las que ya estaban recibidas no se avisan ahora: el primer aviso juntaría
-- todas las de meses atrás en un correo.
UPDATE facturas_colaborador
   SET aviso_empresa_at = subida_at
 WHERE subida_at IS NOT NULL AND aviso_empresa_at IS NULL;

-- La cola del aviso: pocas filas, se mira cada minuto.
CREATE INDEX IF NOT EXISTS idx_fc_aviso_empresa_pendiente
    ON facturas_colaborador(issuer_id)
 WHERE subida_at IS NOT NULL AND aviso_empresa_at IS NULL AND anulada_at IS NULL;

COMMENT ON COLUMN facturas_colaborador.aviso_empresa_at IS
  'Cuando salió el aviso «Han llegado N facturas» al correo de facturación de la empresa (270). NULL = en la cola.';
COMMENT ON COLUMN facturas_colaborador.pago_confirmado_at IS
  'Cuando el colaborador confirmó, desde el correo de «Factura pagada», que recibió el pago (270).';

CREATE TABLE IF NOT EXISTS facturas_colaborador_resumenes (
    issuer_id  INTEGER     NOT NULL REFERENCES invoice_issuers(id) ON DELETE CASCADE,
    dia        DATE        NOT NULL,
    creado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facturas   INTEGER     NOT NULL DEFAULT 0,
    enviado    BOOLEAN     NOT NULL DEFAULT false,
    detalle    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (issuer_id, dia)
);

COMMENT ON TABLE facturas_colaborador_resumenes IS
  'El resumen diario «Faltan facturas por pagar» de cada empresa (270): una fila por empresa y día.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON facturas_colaborador_resumenes TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
