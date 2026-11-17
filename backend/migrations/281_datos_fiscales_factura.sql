-- ============================================================
-- 281: datos fiscales del alumno para la factura automática (#452)
-- ============================================================
-- Automatizaciones 1/9. Al entrar el primer pago de una venta, el CRM manda al
-- alumno un enlace a un formulario público con sus datos fiscales; la factura
-- de ese pago (y la de cada cuota) sale sola con lo que conteste. A los 7 días
-- sin respuesta, con los de la ficha SOLO si están completos y son válidos; si
-- no, el cobro se queda en la cola para que lo revise una persona.
--
--   factura_datos_fiscales      una fila por venta. Guarda los datos con los
--                               que se factura (los del formulario o los de la
--                               ficha el día 7) y el estado de la petición.
--     token_hash                sha256 del enlace. El enlace en claro NO se
--                               guarda: solo viaja en el correo.
--     estado                    pendiente  → enlace mandado, esperando
--                               respondido → datos del formulario
--                               ficha      → día 7, ficha completa y válida
--                               revision   → día 7 sin datos buenos: la cola
--                               anulado    → venta borrada o reenvío
--     intentos                  envíos del formulario con errores. Al llegar
--                               al tope, el enlace deja de admitir más.
--   invoices.datos_fiscales_id  la factura salió SOLA con esta fila. NULL en
--                               todas las de siempre. Es lo que permite ver en
--                               pantalla que una factura no la emitió nadie
--                               (lo que faltaba con la 2026/0102, 14/09).
--
-- Todo detrás de FACTURA_AUTOMATICA_ACTIVA (apagado de serie): sin el
-- interruptor esta tabla se queda vacía y nada cambia.
--
-- Mismo número (281) en los dos CRMs. Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS factura_datos_fiscales (
  id              SERIAL PRIMARY KEY,
  conversion_id   INTEGER NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  -- El cobro que hizo pedir los datos (el primero de la venta).
  payment_id      INTEGER REFERENCES conversion_payments(id) ON DELETE SET NULL,
  token_hash      CHAR(64),
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  caduca_at       TIMESTAMPTZ NOT NULL,
  intentos        INTEGER NOT NULL DEFAULT 0,
  enviado_a       VARCHAR(255),
  enviado_at      TIMESTAMPTZ,
  envio_error     TEXT,
  respondido_at   TIMESTAMPTZ,
  respondido_ip   VARCHAR(64),
  origen_datos    VARCHAR(20),
  -- Los datos con los que se factura.
  cliente_tipo    VARCHAR(20),
  nombre          VARCHAR(200),
  nif             VARCHAR(50),
  direccion       TEXT,
  codigo_postal   VARCHAR(20),
  ciudad          VARCHAR(120),
  pais            VARCHAR(80),
  email           VARCHAR(255),
  motivo_revision TEXT,
  ultimo_error    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT factura_datos_fiscales_estado_ck
    CHECK (estado IN ('pendiente', 'respondido', 'ficha', 'revision', 'anulado')),
  CONSTRAINT factura_datos_fiscales_origen_ck
    CHECK (origen_datos IS NULL OR origen_datos IN ('formulario', 'ficha')),
  CONSTRAINT factura_datos_fiscales_tipo_ck
    CHECK (cliente_tipo IS NULL OR cliente_tipo IN ('particular', 'empresa'))
);

-- Una petición viva por venta: las cuotas reutilizan la misma.
CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_datos_fiscales_venta
  ON factura_datos_fiscales (conversion_id) WHERE estado <> 'anulado';
CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_datos_fiscales_token
  ON factura_datos_fiscales (token_hash) WHERE token_hash IS NOT NULL;
-- El vigilante del día 7 solo mira las pendientes.
CREATE INDEX IF NOT EXISTS idx_factura_datos_fiscales_pendientes
  ON factura_datos_fiscales (caduca_at) WHERE estado = 'pendiente';

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS datos_fiscales_id INTEGER
  REFERENCES factura_datos_fiscales(id) ON DELETE SET NULL;

COMMENT ON TABLE factura_datos_fiscales IS
  'Datos fiscales del alumno para la factura automática (#452): formulario público o ficha a los 7 días.';
COMMENT ON COLUMN invoices.datos_fiscales_id IS
  'La factura salió sola (#452) con estos datos fiscales. NULL = emitida por una persona.';

COMMIT;
