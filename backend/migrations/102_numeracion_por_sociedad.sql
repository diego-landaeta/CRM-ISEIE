-- Numeración por sociedad (spec REQ-NUM-01/02): el contador de facturas es por
-- (sociedad emisora, serie, año), no por proyecto. La columna issuer_id ya existe
-- (migración 103). Aquí añadimos el índice único de apoyo y deduplicamos por si
-- hubiera contadores por-proyecto solapados de una misma sociedad.

-- Dedupe: deja una sola fila por (issuer_id, ano, serie), la de mayor ultimo_numero.
DELETE FROM invoice_sequences a
 USING invoice_sequences b
 WHERE a.issuer_id IS NOT NULL
   AND a.issuer_id = b.issuer_id AND a.ano = b.ano AND a.serie = b.serie
   AND ( a.ultimo_numero < b.ultimo_numero
      OR (a.ultimo_numero = b.ultimo_numero AND a.ctid > b.ctid) );

-- Índice único: garantiza un único contador por sociedad+serie+año.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_seq_issuer
  ON invoice_sequences (issuer_id, ano, serie)
  WHERE issuer_id IS NOT NULL;
