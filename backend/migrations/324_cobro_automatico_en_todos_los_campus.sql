-- 324 · El cobro automático de cuotas, encendido en todos los campus (CRM#992;
-- Diego, 21/11/2026)
--
-- «Todos deben tenerlo, y el que no, que salga un anuncio: conectar Stripe para
-- cobros automáticos, y al tocarlo que los mande al sitio de edición.»
--
-- La 320 creó la casilla del campus `projects.links_pago_cobro_auto` apagada de
-- serie. Desde hoy:
--   · los campus nuevos la traen ENCENDIDA (DEFAULT true);
--   · los que ya existen, también. Se puede seguir apagando a mano en
--     Integraciones › Links de pago.
--
-- Encendida no basta para cobrar: además hacen falta la clave de links de Stripe
-- del campus con permiso de suscripciones y, en producción,
-- COBRO_AUTOMATICO_EN_PRODUCCION=1. Si falta la clave o su permiso, la pantalla
-- avisa con «Conectar Stripe para cobros automáticos».
--
-- Gemela de CRM 312 (CRM#992; aquí CRM-ISEIE#667). Va después de la 322 (seguimiento de los
-- links) y no depende de ella. Se puede pasar dos veces.

BEGIN;

ALTER TABLE projects ALTER COLUMN links_pago_cobro_auto SET DEFAULT true;

UPDATE projects SET links_pago_cobro_auto = true WHERE links_pago_cobro_auto IS DISTINCT FROM true;

COMMENT ON COLUMN projects.links_pago_cobro_auto IS
  'Si en este campus Stripe puede cobrar solas las cuotas con la tarjeta guardada (#680, 309). Encendido de serie y en todos los campus desde la 312 (CRM#992).';

COMMIT;
