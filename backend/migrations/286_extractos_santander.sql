-- ============================================================
-- 286: extractos del banco Santander (#766, Automatizaciones 3/9)
-- ============================================================
-- El Santander no tiene una API abierta para leer los cobros, así que entran
-- por EXTRACTO: alguien de administración sube el fichero (Norma 43 / AEB43 o
-- el CSV de la banca online) desde el panel y el CRM propone, para cada abono,
-- la venta a la que pertenece por importe y nombre/concepto.
--
--   extractos_banco     un fichero subido: quién, cuándo, de qué cuenta y
--                       cuántos movimientos traía. La huella del fichero
--                       (sha256) no deja subir el mismo dos veces en el campus.
--   movimientos_banco   cada ABONO del extracto (los cargos no se guardan).
--                       `huella` es única: el mismo movimiento que aparece en
--                       dos extractos que se solapan entra una sola vez.
--
-- Estados de un movimiento:
--   enlazado        tiene su cobro en la venta (`conversion_payment_id`)
--   a_revisar       hay candidatos pero no uno claro: lo decide una persona
--   sin_candidato   no se parece a ninguna venta abierta
--   descartado      una persona dijo que no es de ninguna venta
--   enlazando       reservado ahora mismo por quien lo está enlazando
--
-- NADA se enlaza solo si hay más de un candidato: solo cuando hay UNO, y
-- coinciden el importe y el nombre a la vez.
--
-- Todo detrás de SANTANDER_EXTRACTOS_ACTIVO (apagado de serie).
--
-- Mismo número (286) en los dos CRMs. Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS extractos_banco (
  id               SERIAL       PRIMARY KEY,
  project_id       INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  banco            VARCHAR(20)  NOT NULL DEFAULT 'santander',
  formato          VARCHAR(10)  NOT NULL CHECK (formato IN ('n43', 'csv')),
  nombre_fichero   VARCHAR(255),
  huella_fichero   VARCHAR(64)  NOT NULL,
  -- La cuenta, enmascarada (últimos 4 dígitos): basta para reconocerla.
  cuenta           VARCHAR(40),
  fecha_desde      DATE,
  fecha_hasta      DATE,
  movimientos      INTEGER      NOT NULL DEFAULT 0,
  abonos           INTEGER      NOT NULL DEFAULT 0,
  abonos_nuevos    INTEGER      NOT NULL DEFAULT 0,
  enlazados        INTEGER      NOT NULL DEFAULT 0,
  a_revisar        INTEGER      NOT NULL DEFAULT 0,
  subido_por       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_extractos_banco_fichero UNIQUE (project_id, huella_fichero)
);

CREATE TABLE IF NOT EXISTS movimientos_banco (
  id                    SERIAL         PRIMARY KEY,
  extracto_id           INTEGER        NOT NULL REFERENCES extractos_banco(id) ON DELETE CASCADE,
  project_id            INTEGER        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  banco                 VARCHAR(20)    NOT NULL DEFAULT 'santander',
  cuenta                VARCHAR(40),
  huella                VARCHAR(64)    NOT NULL,
  fecha_operacion       DATE           NOT NULL,
  fecha_valor           DATE,
  importe               NUMERIC(12,2)  NOT NULL CHECK (importe > 0),
  moneda                VARCHAR(3)     NOT NULL DEFAULT 'EUR',
  concepto              TEXT,
  referencia            VARCHAR(120),
  estado                VARCHAR(20)    NOT NULL DEFAULT 'sin_candidato'
                        CHECK (estado IN ('enlazado', 'a_revisar', 'sin_candidato', 'descartado', 'enlazando')),
  -- Lo que propuso el CRM: [{conversion_id, lead_id, nombre, producto, pendiente, motivos[], cobro_existente_id}]
  candidatos            JSONB          NOT NULL DEFAULT '[]'::jsonb,
  conversion_id         INTEGER        REFERENCES conversions(id) ON DELETE SET NULL,
  conversion_payment_id INTEGER        REFERENCES conversion_payments(id) ON DELETE SET NULL,
  -- auto (un candidato claro) | auto_dedup (ya estaba apuntado) | manual | manual_dedup
  link_method           VARCHAR(20),
  decidido_por          INTEGER        REFERENCES users(id) ON DELETE SET NULL,
  decidido_at           TIMESTAMPTZ,
  -- Para retomar una reserva que se quedó colgada (el proceso murió).
  reservado_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_movimientos_banco_huella UNIQUE (huella)
);

CREATE INDEX IF NOT EXISTS idx_movimientos_banco_estado ON movimientos_banco (project_id, estado, fecha_operacion DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_banco_cobro ON movimientos_banco (conversion_payment_id) WHERE conversion_payment_id IS NOT NULL;

COMMENT ON TABLE movimientos_banco IS
  'Abonos de los extractos del banco (#766). Se proponen enlazados a su venta; los dudosos los decide una persona.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON extractos_banco, movimientos_banco TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE extractos_banco_id_seq, movimientos_banco_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
