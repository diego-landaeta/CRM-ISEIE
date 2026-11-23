-- 319 · Links de pago: un link por cuota del plan de la venta (#680; Diego, 19/11)
--
-- En main y en producción entró como 318_links_pago_por_cuota.sql (v2.8.0, #622),
-- pero en staging la 318 ya era 318_instagram_y_atribucion_meta.sql. Aquí pasa
-- a la 319. Ya aplicada en producción: no hace falta volver a pasarla; si se
-- pasa, no cambia nada.
--
-- «Generar plan de pago»: desde una venta con plan de cuotas, un link de Stripe
-- por cada cuota pendiente, con su importe y su fecha. Cuando el alumno paga el
-- link de una cuota, el cobro entra en la venta y salda ESA cuota (no la primera
-- pendiente por número, que es lo que hace un cobro suelto).
--
-- `installment_id`: la cuota a la que va el link. NULL = un link suelto (un pago
-- único, o «sin venta todavía»). Si la cuota se borra (se rehace el plan), el
-- link se queda sin cuota y su cobro va como un cobro suelto de la venta.
--
-- Se puede pasar dos veces.

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS installment_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_installment_fk') THEN
    ALTER TABLE payment_links
      ADD CONSTRAINT payment_links_installment_fk
      FOREIGN KEY (installment_id) REFERENCES conversion_installments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_links_installment
  ON payment_links (installment_id) WHERE installment_id IS NOT NULL;
