-- Soporte: estado «En seguimiento» (follow_up) en los tickets (Diego, 24/11/2026).
-- «En revisión» (in_review) pasa a llamarse «En proceso» en pantalla; la clave no cambia.
-- Idempotente.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_estado_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_estado_check
  CHECK (estado IN ('open', 'in_review', 'follow_up', 'resolved', 'closed'));
