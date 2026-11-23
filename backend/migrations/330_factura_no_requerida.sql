-- Réplica de la migración 162 del CRM 360 (diego-landaeta/CRM).
--
-- En ISEIE la columna se lee (Ventas, Ventas sin factura) pero nunca tuvo
-- migración: en una base nueva (la del CI) «Ventas sin factura» daba 500
-- («no existe la columna c.factura_no_requerida»). Lo destapó la prueba de
-- #708. IF NOT EXISTS: donde ya existe (producción) no se toca nada.
--
BEGIN;

-- Se deja NULABLE y sin valor por defecto a propósito: el código ya la lee con
-- `COALESCE(..., false)` y `IS NOT TRUE`, así que una fila sin marcar significa
-- «sí requiere factura», que es lo correcto. Poner un DEFAULT ahora haría que
-- las filas nuevas difieran de las viejas sin motivo.
ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS factura_no_requerida BOOLEAN;

COMMENT ON COLUMN conversions.factura_no_requerida IS
  'TRUE = esta venta no necesita factura. Se usó para dar por cerrados los pendientes de facturar antiguos. NULL o FALSE = sí la necesita. Se marca a mano: ninguna pantalla la escribe.';

-- Se filtra por ella al listar lo que falta por facturar, y son pocas las
-- marcadas: un índice parcial es el que sirve y no ocupa nada.
CREATE INDEX IF NOT EXISTS idx_conversions_sin_factura_requerida
  ON conversions (project_id)
  WHERE factura_no_requerida IS TRUE;

COMMIT;
