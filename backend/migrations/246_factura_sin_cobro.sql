-- 246 · «Este mes no facturo a esta empresa» (31/10/2026)
--
-- Diego, 31/10: «que los que llegaron dentro de los enlaces pongamos: este mes no
-- cobro en esta empresa». Quien factura a varias empresas (CEDIA, ICTESS, ISEIE)
-- recibe un enlace por empresa; si un mes no trabajó para una, lo dice desde el
-- mismo enlace y no le llega el recordatorio del día 5 ni sale como pendiente.
--
-- No sirve «anular»: una factura anulada se vuelve a crear del día 1 al 4 (la
-- recuperación del mes) y se manda otra vez. Esto es otro estado, «sin factura».
-- Subir la factura después lo deshace solo.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE facturas_colaborador
  ADD COLUMN IF NOT EXISTS sin_factura_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sin_factura_motivo TEXT;

COMMENT ON COLUMN facturas_colaborador.sin_factura_at IS
  'Cuando el colaborador dijo que ese mes no factura a esa empresa (246). NULL = factura como siempre.';

COMMIT;
