-- 118 · El enum payment_method se habia quedado corto
--
-- conversions.metodo_pago es un ENUM de PostgreSQL con solo cuatro valores:
--   transferencia, tarjeta, efectivo, fraccionado
--
-- pero el desplegable de la ficha y la validacion de Zod llevaban tiempo
-- ofreciendo ocho. Cualquiera que eligiera "Tarjeta (Stripe)", "Bizum" u "Otro"
-- al convertir un lead recibia un 500:
--
--   invalid input value for enum payment_method: "otro"
--
-- Y al anadir PayPal el 30/07/2026 el agujero se hizo mas visible, porque es lo
-- que empezaron a elegir. Se anaden los cuatro que faltaban para que la base
-- diga lo mismo que la interfaz.
--
-- ALTER TYPE ... ADD VALUE no puede ir dentro de una transaccion en versiones
-- antiguas, asi que estas cuatro lineas van sueltas, sin BEGIN/COMMIT.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'tarjeta_stripe';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'paypal';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'bizum';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'otro';
