\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- Esta corrección está deliberadamente limitada a:
--   1) Stripe #2903: cuota reciente de Ana Gabriela Picado.
--   2) Stripe #2908: mensualidad 1 reciente de Gabriela Ymaya.
--   3) Factura duplicada #625 de Mónica Andrea Cardona.
-- No se modifican los demás pagos ni facturas históricas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = 5 AND nombre = 'Raquel ISEIE Comercial' AND active = true
  ) THEN
    RAISE EXCEPTION 'Raquel (user 5) no coincide con el registro esperado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM stripe_payments
    WHERE id = 2903
      AND stripe_id = 'ch_3TxFpzGP3zN1neHA0ok4ghQu'
      AND status = 'succeeded'
      AND amount = 125.00
      AND conversion_id IS NULL
  ) THEN
    RAISE EXCEPTION 'El pago reciente de Ana no está en el estado esperado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM stripe_payments
    WHERE id = 2908
      AND stripe_id = 'ch_3TxAy6GP3zN1neHA0mPH5QOg'
      AND status = 'succeeded'
      AND amount = 227.74
      AND conversion_id IS NULL
      AND metadata @> '{"original_amount":258.84,"original_currency":"USD"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'El pago reciente de Gabriela no está en el estado esperado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM invoices
    WHERE id = 1101 AND numero = 625 AND payment_id = 851
      AND conversion_id = 198 AND total = 343.90
  ) OR NOT EXISTS (
    SELECT 1 FROM invoices
    WHERE id = 951 AND numero = 601 AND payment_id = 443
      AND conversion_id = 198 AND total = 343.90
  ) THEN
    RAISE EXCEPTION 'Las facturas de Mónica no coinciden con el duplicado esperado';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Ana Gabriela Picado / Comercial Farmacéutica Leisa
-- Se reutiliza el cliente histórico canónico de Raquel (lead 15974 / venta 491)
-- y solo se agrega el cobro reciente del 26/07.
-- ---------------------------------------------------------------------------
UPDATE leads
SET nombre = 'Ana Gabriela Picado Cartin',
    email = 'gabrielapicado3@gmail.com',
    telefono = '50683301782',
    producto_interes_id = 1156,
    status = 'convertido',
    responsable_id = 5,
    identificacion_fiscal = '3-101-2900676',
    direccion_fiscal = 'De lostanques del AyA 300mtrsOeste San José, Guadalupe, Goicochea.',
    ciudad_fiscal = 'San José, Guadalupe, Goicochea',
    pais_fiscal = 'Costa Rica',
    cliente_tipo = 'empresa',
    custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object(
      'razon_social', 'Comercial Farmacéutica Leisa.',
      'telefono_facturacion', '+50622853131'
    ),
    updated_at = NOW()
WHERE id = 15974;

WITH new_payment AS (
  INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo)
  VALUES (
    491, 125.00, DATE '2026-07-26',
    'Cuota 5 · Stripe ch_3TxFpzGP3zN1neHA0ok4ghQu',
    'tarjeta_stripe'
  )
  RETURNING id
)
UPDATE stripe_payments sp
SET lead_id = 15974,
    conversion_id = 491,
    conversion_payment_id = new_payment.id,
    linked_by = NULL,
    link_method = 'manual_verified',
    linked_at = NOW(),
    updated_at = NOW()
FROM new_payment
WHERE sp.id = 2903;

INSERT INTO conversion_installments (
  conversion_id, numero, importe_previsto, fecha_vencimiento,
  fecha_cobro, importe_cobrado, metodo, payment_id, concepto, notas
)
SELECT
  491, 5, 125.00, DATE '2026-07-26',
  DATE '2026-07-26', 125.00, 'tarjeta_stripe',
  sp.conversion_payment_id,
  'Mensualidad 5 · Diplomado en Farmacia Oncológica',
  'Pago reciente verificado en Stripe'
FROM stripe_payments sp
WHERE sp.id = 2903;

UPDATE conversions c
SET importe_total = 375.00,
    importe_pagado = (
      SELECT COALESCE(SUM(cp.importe), 0)
      FROM conversion_payments cp
      WHERE cp.conversion_id = c.id
    ),
    producto_contratado = 'Diplomado en Farmacia Oncológica',
    metodo_pago = 'fraccionado',
    updated_at = NOW()
WHERE c.id = 491;

-- ---------------------------------------------------------------------------
-- Gabriela Ymaya: se elimina únicamente el pago técnico de backfill que hacía
-- aparecer la venta como saldada. Se conserva la factura/pago inicial real.
-- ---------------------------------------------------------------------------
DELETE FROM conversion_payments
WHERE id = 143
  AND conversion_id = 199
  AND importe = 4095.00
  AND notas LIKE 'Backfill 2026-06-16:%'
  AND NOT EXISTS (SELECT 1 FROM invoices WHERE payment_id = 143);

WITH new_payment AS (
  INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo)
  VALUES (
    199, 227.74, DATE '2026-07-25',
    'Cuota 1 · 258,84 USD · neto Stripe 227,74 EUR · ch_3TxAy6GP3zN1neHA0mPH5QOg',
    'tarjeta_stripe'
  )
  RETURNING id
)
UPDATE stripe_payments sp
SET lead_id = 370,
    conversion_id = 199,
    conversion_payment_id = new_payment.id,
    linked_by = NULL,
    link_method = 'manual_verified',
    linked_at = NOW(),
    updated_at = NOW()
FROM new_payment
WHERE sp.id = 2908;

DELETE FROM conversion_installments WHERE conversion_id = 199;

INSERT INTO conversion_installments (
  conversion_id, numero, importe_previsto, fecha_vencimiento,
  fecha_cobro, importe_cobrado, metodo, payment_id, concepto, notas
)
SELECT
  199,
  n,
  258.84,
  (DATE '2026-07-25' + make_interval(months => n - 1))::date,
  CASE WHEN n = 1 THEN DATE '2026-07-25' END,
  CASE WHEN n = 1 THEN 227.74 END,
  CASE WHEN n = 1 THEN 'tarjeta_stripe' END,
  CASE WHEN n = 1 THEN (SELECT conversion_payment_id FROM stripe_payments WHERE id = 2908) END,
  'Mensualidad ' || n || ' · 258,84 USD',
  CASE WHEN n = 1
    THEN 'Cobrado por Stripe: 258,84 USD; neto liquidado 227,74 EUR'
    ELSE 'Pendiente · cobro previsto cada día 25'
  END
FROM generate_series(1, 12) AS n;

UPDATE leads
SET responsable_id = 5,
    pais_fiscal = 'República Dominicana',
    updated_at = NOW()
WHERE id = 370;

UPDATE conversions c
SET importe_total = 4006.00,
    importe_pagado = (
      SELECT COALESCE(SUM(cp.importe), 0)
      FROM conversion_payments cp
      WHERE cp.conversion_id = c.id
    ),
    metodo_pago = 'fraccionado',
    fecha_compromiso_pago = DATE '2026-08-25',
    notas_pago = 'Total acordado: 4.006 USD. Inicial: 728,52 EUR. Mensualidad 1: 258,84 USD (227,74 EUR netos Stripe). Restan 11 mensualidades de 258,84 USD, vencimiento los días 25.',
    updated_at = NOW()
WHERE c.id = 199;

-- ---------------------------------------------------------------------------
-- Mónica: factura 625 y payment 851 son el duplicado automático del mismo cobro
-- ya documentado en factura 601 / payment 443. Se conserva el histórico correcto.
-- ---------------------------------------------------------------------------
DELETE FROM invoices WHERE id = 1101;

UPDATE stripe_payments
SET conversion_payment_id = 443,
    link_method = 'manual_reconciled',
    linked_at = NOW(),
    updated_at = NOW()
WHERE id = 2924
  AND conversion_id = 198
  AND conversion_payment_id = 851;

DELETE FROM conversion_payments
WHERE id = 851
  AND conversion_id = 198
  AND importe = 343.90;

UPDATE conversions c
SET importe_pagado = (
      SELECT COALESCE(SUM(cp.importe), 0)
      FROM conversion_payments cp
      WHERE cp.conversion_id = c.id
    ),
    updated_at = NOW()
WHERE c.id = 198;

-- Evidencia antes de confirmar o revertir.
\echo === PAGOS_RECIENTES_RESULTADO ===
SELECT sp.id AS stripe_db_id, sp.stripe_id, sp.amount, sp.currency,
       sp.lead_id, l.nombre AS cliente, u.nombre AS responsable,
       sp.conversion_id, sp.conversion_payment_id, sp.link_method,
       cp.fecha, cp.importe, cp.notas
FROM stripe_payments sp
LEFT JOIN leads l ON l.id = sp.lead_id
LEFT JOIN users u ON u.id = l.responsable_id
LEFT JOIN conversion_payments cp ON cp.id = sp.conversion_payment_id
WHERE sp.id IN (2903, 2908)
ORDER BY sp.id;

\echo === SALDO_GABRIELA_YMAYA ===
SELECT c.id, l.nombre, u.nombre AS responsable, c.importe_total,
       c.importe_pagado, c.importe_total - c.importe_pagado AS pendiente,
       c.fecha_compromiso_pago,
       COUNT(ci.id) AS cuotas,
       COUNT(ci.id) FILTER (WHERE ci.fecha_cobro IS NOT NULL) AS cuotas_pagadas,
       COUNT(ci.id) FILTER (WHERE ci.fecha_cobro IS NULL) AS cuotas_pendientes
FROM conversions c
JOIN leads l ON l.id = c.lead_id
LEFT JOIN users u ON u.id = l.responsable_id
LEFT JOIN conversion_installments ci ON ci.conversion_id = c.id
WHERE c.id = 199
GROUP BY c.id, l.nombre, u.nombre;

\echo === FACTURAS_MONICA_CONSERVADAS ===
SELECT i.id, i.numero, i.codigo, i.total, i.estado, i.payment_id,
       i.cliente_nombre
FROM invoices i
WHERE i.conversion_id = 198
ORDER BY i.numero;

\if :commit
  COMMIT;
  \echo === COMMIT_APLICADO ===
\else
  ROLLBACK;
  \echo === DRY_RUN_REVERTIDO ===
\endif
