-- Los estados de la comision del tutor: dos mas.
--
-- Diego, 14/09/2026: «ahi que pone pendiente deben aparecer los siguientes
-- estados: Pendiente, Notificada, Falta Factura».
--
-- Que significa cada uno, porque no son tres formas de decir lo mismo:
--
--   pendiente      se le debe y todavia no se le ha dicho nada
--   notificada     se le ha avisado de que facture; esperando su factura
--   falta_factura  ya se le aviso y sigue sin mandarla --por eso no se paga--
--   pagada         liquidada
--   revertida      anulada, con su motivo escrito
--
-- La columna es un varchar con CHECK, NO un enum: se comprueba en el catalogo
-- antes de tocar, que buscar solo el CHECK ya rompio las conversiones una vez.
--
-- Lo de «si este estado se pone en septiembre se mantiene SOLO en ese mes» no
-- necesita nada: cada fila ya lleva su `periodo`, asi que un estado de
-- septiembre no puede alcanzar a agosto.

ALTER TABLE tutor_commissions DROP CONSTRAINT IF EXISTS tutor_commissions_estado_check;

ALTER TABLE tutor_commissions
  ADD CONSTRAINT tutor_commissions_estado_check
  CHECK (estado IN ('pendiente', 'notificada', 'falta_factura', 'pagada', 'revertida'));
