-- Reembolsos: de que pago son, y que pasa con la comision del tutor.
--
-- Hasta ahora una devolucion sabia de que VENTA era, pero no de que COBRO. Con
-- una venta pagada en tres plazos no habia forma de saber cual se devolvio, y
-- por tanto tampoco que comision habia que deshacer. El tutor cobraba igual.
--
-- Tampoco se sabia si la devolucion venia de Stripe o la habia metido alguien a
-- mano, asi que un mismo reembolso podia registrarse dos veces: una por el
-- webhook y otra por la persona que lo vio en el panel de Stripe.

ALTER TABLE conversion_refunds
  ADD COLUMN IF NOT EXISTS payment_id INTEGER REFERENCES conversion_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_refund_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS origen VARCHAR(16) NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_refund_origen') THEN
    ALTER TABLE conversion_refunds
      ADD CONSTRAINT chk_refund_origen CHECK (origen IN ('manual', 'stripe'));
  END IF;
END $$;

COMMENT ON COLUMN conversion_refunds.payment_id IS
  'De que cobro concreto es esta devolucion. Sin esto no se sabe que comision revertir.';
COMMENT ON COLUMN conversion_refunds.stripe_refund_id IS
  'El re_... de Stripe. Es lo que impide registrar dos veces el mismo reembolso.';
COMMENT ON COLUMN conversion_refunds.origen IS
  'manual = lo metio una persona · stripe = llego por el webhook.';

-- La pieza que evita duplicar: el mismo reembolso de Stripe solo puede entrar
-- una vez, venga por el webhook o por una resincronizacion. Es indice UNICO
-- parcial porque las devoluciones manuales no tienen ese identificador y no
-- deben estorbarse entre ellas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_stripe
  ON conversion_refunds (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refund_payment
  ON conversion_refunds (payment_id);

-- Que una comision revertida sepa POR QUE lo fue, y de que devolucion viene.
ALTER TABLE tutor_commissions
  ADD COLUMN IF NOT EXISTS refund_id INTEGER REFERENCES conversion_refunds(id) ON DELETE SET NULL;

COMMENT ON COLUMN tutor_commissions.refund_id IS
  'Si se revirtio por una devolucion, cual. Vacio si se revirtio a mano.';

-- La propiedad, al dueño de la base. Si estas lineas se aplican como postgres
-- —que es lo que pasa cuando la migracion se lanza desde la consola del
-- servidor— los objetos quedan a su nombre y la aplicacion no puede escribir en
-- lo suyo. Ya paso con las tablas de tutores.
DO $$
DECLARE duenyo TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo FROM pg_database WHERE datname = current_database();
  EXECUTE format('ALTER TABLE conversion_refunds OWNER TO %I', duenyo);
  EXECUTE format('ALTER TABLE tutor_commissions OWNER TO %I', duenyo);
END $$;
