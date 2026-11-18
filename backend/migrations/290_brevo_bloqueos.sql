-- ============================================================
-- 290: correos del equipo bloqueados en Brevo
-- ============================================================
-- Caso real (ISEIE, 17/11/2026): una gestora pasó tres semanas sin recibir
-- NINGÚN aviso del CRM porque Brevo bloqueó su dirección el 26/10 tras un
-- rebote duro (su buzón aún no existía). El CRM seguía «enviando» y nadie se
-- enteró.
--
-- La tarea `brevoBloqueadosScheduler` (cada 6 h, BREVO_BLOQUEADOS_ACTIVO) cruza
-- la lista de bloqueados de Brevo con los usuarios activos y apunta aquí cada
-- bloqueo. Sirve para tres cosas:
--
--   avisado_at   avisar UNA vez por persona y bloqueo (campana + correo a
--                superadmins y admins de sus campus)
--   resuelto_at  la marca de Usuarios y de la ficha: abierta = sin fecha
--   huella       qué es «el mismo bloqueo»: dirección + fecha de Brevo. Si se
--                desbloquea y Brevo la vuelve a bloquear, es otra huella y
--                otro aviso.
--
-- Mismo número (290) en los dos CRMs. Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS brevo_bloqueos (
  id               SERIAL       PRIMARY KEY,
  user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            VARCHAR(255) NOT NULL,
  huella           TEXT         NOT NULL,
  codigo           VARCHAR(60),
  motivo           TEXT,
  bloqueado_desde  TIMESTAMPTZ,
  cuentas          TEXT[]       NOT NULL DEFAULT '{}',
  detectado_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  visto_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  avisado_at       TIMESTAMPTZ,
  resuelto_at      TIMESTAMPTZ,
  desbloqueado_por INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_brevo_bloqueos_usuario_huella UNIQUE (user_id, huella)
);

CREATE INDEX IF NOT EXISTS idx_brevo_bloqueos_abiertos
  ON brevo_bloqueos (user_id) WHERE resuelto_at IS NULL;

COMMENT ON TABLE brevo_bloqueos IS
  'Correos del equipo bloqueados en Brevo (rebote duro, baja, spam…). Abierto = resuelto_at NULL.';
COMMENT ON COLUMN brevo_bloqueos.cuentas IS
  'Cuentas de Brevo donde está bloqueado: ''crm'' o ''p:<project_id>'' (cuenta propia de la marca).';

COMMIT;
