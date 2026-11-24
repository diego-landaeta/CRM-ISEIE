-- ============================================================
-- 337: «Enviar factura automáticamente: Sí / No» y «Enviar a este correo» (#452, gemela de CRM#764)
-- ============================================================
-- Con la facturación automática encendida (24/11), la factura de cada cobro
-- sale sola y se le manda en PDF al alumno. Diego, 24/11: que la gestora pueda
-- decir, en la venta o en el cobro, si la envía el CRM o la envía ella, y a qué
-- correo van el formulario de datos fiscales y el PDF.
--
--   conversions.factura_envio_auto   TRUE de serie: el CRM manda el PDF. FALSE:
--                                    la factura se emite igual, pero el PDF no
--                                    sale; la envía la gestora.
--   conversions.factura_envio_email  el correo que confirmó la gestora. NULL =
--                                    el de la ficha del alumno.
--   conversions.factura_envio_por/at quién y cuándo lo confirmó o lo cambió.
--   payment_links.factura_envio_*    lo mismo, elegido al crear un link sin
--                                    venta: pasa a la venta que nace al pagarlo.
--                                    NULL = no se eligió (Sí, y el correo con
--                                    el que paga).
--   invoices.envio_nota              la coletilla de la factura que salió sola
--                                    sin mandarse («No se envía
--                                    automáticamente: la envía la gestora»).
--
-- Columnas nuevas en tablas que ya existen: los permisos (GRANT) no cambian.
-- Mismo contenido en los dos CRMs (aquí 337; en el 360, 325). Se puede pasar dos veces.

BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS factura_envio_auto  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS factura_envio_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS factura_envio_por   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS factura_envio_at    TIMESTAMPTZ;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS factura_envio_auto  BOOLEAN,
  ADD COLUMN IF NOT EXISTS factura_envio_email VARCHAR(255);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS envio_nota TEXT;

COMMENT ON COLUMN conversions.factura_envio_auto IS
  'Factura automática (#764): TRUE = el CRM manda el PDF al alumno; FALSE = se emite igual y la envía la gestora.';
COMMENT ON COLUMN conversions.factura_envio_email IS
  'Correo confirmado por la gestora para el formulario de datos fiscales y el PDF. NULL = el de la ficha.';
COMMENT ON COLUMN payment_links.factura_envio_auto IS
  'Lo que eligió la gestora al crear el link (#764); pasa a la venta que nace al pagarlo. NULL = no eligió (sí).';
COMMENT ON COLUMN invoices.envio_nota IS
  'Por qué la factura que salió sola no se mandó al alumno (#764), p. ej. «la envía la gestora».';

COMMIT;
