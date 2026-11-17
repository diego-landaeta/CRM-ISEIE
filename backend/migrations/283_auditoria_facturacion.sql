-- ============================================================
-- 283: auditoría de facturación cada 2 horas y pausa de la emisión (#765)
-- ============================================================
-- Manuel, 13/11/2026 (Automatizaciones 2/9): cada 2 horas se revisan los
-- números repetidos por serie, los datos fiscales obligatorios y los cobros con
-- más de X días sin factura. Si algo falla, se pausa la emisión de facturas
-- nuevas, se avisa a los administradores y el aviso se queda en el CRM hasta
-- que alguien lo marca como solucionado y la auditoría sale limpia.
--
-- La auditoría NO corrige nada: solo mira, apunta y pausa.
--
-- Todo va detrás de FACTURACION_AUDITORIA_ACTIVA (apagado de serie). Con el
-- interruptor apagado estas tablas no se leen ni se escriben.
--
-- Gemela de la 283 del CRM 360, con el mismo número. Se puede pasar dos veces.

BEGIN;

-- Cada vuelta de la auditoría, salga limpia o no.
CREATE TABLE IF NOT EXISTS facturacion_auditorias (
  id            BIGSERIAL PRIMARY KEY,
  -- programada: la de cada 2 h · manual: «Auditar ahora» · reanudar: la que
  -- pasa «Marcar como solucionado» antes de reanudar.
  origen        VARCHAR(20) NOT NULL,
  empezo        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  termino       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  limpia        BOOLEAN NOT NULL,
  -- Lo que ha encontrado, tal cual se enseña: [{ tipo, serie, texto, ... }].
  incidencias   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Cuántas de cada tipo y con qué parámetros se pasó (desde, días).
  resumen       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ejecutada_por INTEGER REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE facturacion_auditorias DROP CONSTRAINT IF EXISTS facturacion_auditorias_origen_valido;
ALTER TABLE facturacion_auditorias ADD CONSTRAINT facturacion_auditorias_origen_valido
  CHECK (origen IN ('programada', 'manual', 'reanudar'));

CREATE INDEX IF NOT EXISTS idx_facturacion_auditorias_cuando
  ON facturacion_auditorias (empezo DESC);

-- Cada pausa: cuándo, por qué auditoría, y quién la reanudó y con qué vuelta.
CREATE TABLE IF NOT EXISTS facturacion_pausas (
  id                    BIGSERIAL PRIMARY KEY,
  pausada_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auditoria_id          BIGINT REFERENCES facturacion_auditorias(id) ON DELETE SET NULL,
  motivo                TEXT NOT NULL,
  incidencias           JSONB NOT NULL DEFAULT '[]'::jsonb,
  reanudada_at          TIMESTAMPTZ,
  reanudada_por         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auditoria_reanudo_id  BIGINT REFERENCES facturacion_auditorias(id) ON DELETE SET NULL,
  -- Lo que salió de la cola al reanudar: [{ payment_id, resultado, codigo }].
  emitidas_al_reanudar  JSONB
);

-- Solo puede haber UNA pausa abierta a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturacion_pausa_abierta
  ON facturacion_pausas ((true)) WHERE reanudada_at IS NULL;

-- Los cobros que entraron con la facturación pausada y que, sin la pausa,
-- habrían salido facturados al momento. Al reanudar se emiten en orden de cobro.
CREATE TABLE IF NOT EXISTS facturacion_cola_pausa (
  payment_id     INTEGER PRIMARY KEY REFERENCES conversion_payments(id) ON DELETE CASCADE,
  conversion_id  INTEGER NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  pausa_id       BIGINT REFERENCES facturacion_pausas(id) ON DELETE SET NULL,
  -- Quien registró el cobro: la factura sale a su nombre, como habría salido.
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  encolado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_at   TIMESTAMPTZ,
  -- emitida · a_la_cola (espera a otros cobros anteriores, como siempre) ·
  -- sin_factura (el CRM no emite: anterior al arranque, ya cubierto…) · error
  resultado      VARCHAR(20),
  invoice_id     INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  error          TEXT
);

ALTER TABLE facturacion_cola_pausa DROP CONSTRAINT IF EXISTS facturacion_cola_pausa_resultado_valido;
ALTER TABLE facturacion_cola_pausa ADD CONSTRAINT facturacion_cola_pausa_resultado_valido
  CHECK (resultado IS NULL OR resultado IN ('emitida', 'a_la_cola', 'sin_factura', 'error'));

CREATE INDEX IF NOT EXISTS idx_facturacion_cola_pausa_pendientes
  ON facturacion_cola_pausa (encolado_at) WHERE procesado_at IS NULL;

-- Desde qué día se audita. Si FACTURACION_AUDITORIA_DESDE no lo dice, el día
-- de la primera vuelta: el histórico (renumeraciones, arranque de CEDIA,
-- proformas viejas) no pausa la facturación el primer día.
CREATE TABLE IF NOT EXISTS facturacion_auditoria_estado (
  id             SMALLINT PRIMARY KEY DEFAULT 1,
  auditar_desde  DATE NOT NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT facturacion_auditoria_estado_una_fila CHECK (id = 1)
);

COMMENT ON TABLE facturacion_auditorias IS
  'Cada vuelta de la auditoría de facturación (#765). No corrige nada: solo mira y apunta.';
COMMENT ON TABLE facturacion_pausas IS
  'Pausas de la emisión de facturas por la auditoría (#765). Abierta = reanudada_at NULL.';
COMMENT ON TABLE facturacion_cola_pausa IS
  'Cobros que entraron con la facturación pausada; se emiten en orden de cobro al reanudar (#765).';

COMMIT;
