-- 327 · Links de pago: la moneda de cada campus y los códigos promocionales (CRM-ISEIE#661, gemela de CRM#986)
--
-- Diego, 21/11/2026 (cómo escalar los links de pago):
--   · «El link sale en la moneda del campus (MXN, COP, CLP…), con el precio del
--     curso en esa moneda cuando lo haya.»
--   · «Códigos promocionales de Stripe en el link, con fecha límite, para
--     campañas. El descuento aplicado se guarda en la venta.»
--
-- 1) LA MONEDA DEL CAMPUS. Hasta hoy todos los campus salían en EUR por defecto
--    (la 303 añadió las monedas en que ya cobraban, pero dejó EUR por defecto).
--    Un campus cuyo catálogo entero (cursos activos con precio) está en UNA
--    moneda que no es el euro pasa a tener esa moneda por defecto. Solo si su
--    moneda por defecto sigue siendo EUR (nadie la ha cambiado) y solo si todo
--    su catálogo con precio está en esa moneda: un catálogo mezclado no se toca.
--    EUR sigue entre las admitidas: las cuotas van en euros (ver el PR).
--
-- 2) LOS CÓDIGOS PROMOCIONALES.
--    · `projects.links_pago_codigos_promo`: si los links del campus admiten
--      códigos promocionales de Stripe (`allow_promotion_codes`). Apagado de
--      serie: lo enciende el admin en Integraciones › Links de pago.
--    · `payment_links.codigos_promo`: si ESE link los admite (solo pago único).
--      `promo_codigo` y `promo_descuento` (en la moneda del link): el código que
--      usó el alumno al pagar y lo que le descontó.
--    · `links_pago_codigos`: los códigos de campaña que crea el admin desde el
--      CRM (cupón + código de Stripe), con su FECHA LÍMITE obligatoria y, si se
--      quiere, un máximo de usos.
--
-- La venta no necesita columnas nuevas: el descuento va a `subtotal_bruto`,
-- `descuento_tipo`, `descuento_valor` y `descuento_importe` (095) y el código, a
-- sus notas.
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS links_pago_codigos_promo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN projects.links_pago_codigos_promo IS
  'Si los links de pago del campus admiten códigos promocionales de Stripe (allow_promotion_codes). CRM-ISEIE#661, 327.';

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS codigos_promo   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS promo_codigo    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS promo_descuento NUMERIC(12,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_promo_descuento_positivo') THEN
    ALTER TABLE payment_links ADD CONSTRAINT payment_links_promo_descuento_positivo
      CHECK (promo_descuento IS NULL OR promo_descuento >= 0);
  END IF;
END $$;

COMMENT ON COLUMN payment_links.codigos_promo IS 'El link admite códigos promocionales de Stripe (solo pago único). CRM#986.';
COMMENT ON COLUMN payment_links.promo_codigo IS 'El código promocional que usó el alumno al pagar (o el id de Stripe si no se sabe el texto).';
COMMENT ON COLUMN payment_links.promo_descuento IS 'Lo que descontó el código promocional, en la moneda del link.';

CREATE TABLE IF NOT EXISTS links_pago_codigos (
  id                       SERIAL PRIMARY KEY,
  project_id               INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  codigo                   VARCHAR(40) NOT NULL,
  campana                  VARCHAR(120),
  tipo                     VARCHAR(10) NOT NULL,
  valor                    NUMERIC(10,2) NOT NULL,
  moneda                   VARCHAR(3),
  caduca_el                DATE NOT NULL,
  max_usos                 INTEGER,
  stripe_coupon_id         VARCHAR(255),
  stripe_promotion_code_id VARCHAR(255),
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  desactivado_por          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  desactivado_el           TIMESTAMPTZ,
  CONSTRAINT links_pago_codigos_tipo CHECK (tipo IN ('pct', 'monto')),
  CONSTRAINT links_pago_codigos_valor CHECK (valor > 0 AND (tipo <> 'pct' OR valor <= 100)),
  -- En € (o la moneda que sea) lleva su moneda; en %, ninguna.
  CONSTRAINT links_pago_codigos_moneda CHECK ((tipo = 'monto') = (moneda IS NOT NULL)),
  CONSTRAINT links_pago_codigos_formato CHECK (codigo ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  CONSTRAINT links_pago_codigos_usos CHECK (max_usos IS NULL OR max_usos > 0)
);

-- Un código vivo no se repite en el campus (Stripe tampoco lo deja en la cuenta).
CREATE UNIQUE INDEX IF NOT EXISTS links_pago_codigos_vivo_unico
  ON links_pago_codigos (project_id, codigo) WHERE activo;
CREATE INDEX IF NOT EXISTS links_pago_codigos_proyecto
  ON links_pago_codigos (project_id, created_at DESC);

COMMENT ON TABLE links_pago_codigos IS
  'Códigos promocionales de campaña de los links de pago (CRM#986): un cupón y un código de Stripe, con fecha límite.';

-- La moneda por defecto: la del catálogo entero, si es una sola y no es el euro.
WITH catalogo AS (
  SELECT project_id, upper(btrim(moneda)) AS moneda
    FROM products
   WHERE precio > 0 AND COALESCE(active, TRUE)
   GROUP BY 1, 2
),
una_sola AS (
  SELECT project_id, min(moneda) AS moneda
    FROM catalogo
   GROUP BY project_id
  HAVING count(*) = 1
)
UPDATE projects p
   SET links_pago_monedas = CASE WHEN u.moneda = ANY (p.links_pago_monedas) THEN p.links_pago_monedas
                                 ELSE p.links_pago_monedas || ARRAY[u.moneda]::VARCHAR(3)[] END,
       links_pago_moneda_defecto = u.moneda
  FROM una_sola u
 WHERE u.project_id = p.id
   AND u.moneda ~ '^[A-Z]{3}$'
   AND u.moneda <> 'EUR'
   AND p.links_pago_moneda_defecto = 'EUR';

COMMIT;
