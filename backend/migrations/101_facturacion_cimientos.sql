-- Cimientos de datos del módulo de facturación (spec v1.0, paso 1).
-- 100% aditivo e idempotente: no altera datos existentes ni rompe el flujo actual.
-- Prepara el terreno para: numeración por sociedad, motor fiscal por producto,
-- datos fiscales de cliente (VIES), moneda/tipo de cambio y reserva Verifactu.

-- 1) FACTURAS ---------------------------------------------------------------
-- Reserva Verifactu (se dejan vacíos; se rellenarán cuando se active la Ley Antifraude)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hash_encadenado TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qr TEXT;
-- Moneda + tipo de cambio (REQ-MON-01: ventas LATAM se guardan en EUR con su cambio)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6) NOT NULL DEFAULT 1;
-- Fecha de operación / devengo (REQ-DAT-01), separada de la fecha de emisión
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fecha_operacion DATE;

-- 2) PRODUCTOS --------------------------------------------------------------
-- Régimen fiscal por producto (REQ-FIS-01): base del motor fiscal automático
ALTER TABLE products ADD COLUMN IF NOT EXISTS regimen_fiscal_id INTEGER REFERENCES fiscal_regimenes(id);

-- 3) CLIENTE (datos fiscales sobre el lead) ---------------------------------
-- NIF-IVA intracomunitario (VIES) y tipo de cliente (REQ-DAT-01 / REQ-FIS-02)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS nif_iva_vies VARCHAR(30);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cliente_tipo VARCHAR(20);   -- 'particular' | 'empresa'
ALTER TABLE leads ADD COLUMN IF NOT EXISTS vies_validado BOOLEAN NOT NULL DEFAULT false;

-- 4) NUMERACIÓN POR SOCIEDAD (preparación) ----------------------------------
-- La secuencia podrá contar por emisor (sociedad) en vez de por proyecto.
-- Añadimos issuer_id y lo rellenamos desde la sociedad del proyecto; el cambio
-- de la clave de conteo se hará en el paso de motor de numeración.
ALTER TABLE invoice_sequences ADD COLUMN IF NOT EXISTS issuer_id INTEGER REFERENCES invoice_issuers(id);
UPDATE invoice_sequences s
   SET issuer_id = (SELECT p.sociedad_emisora_id FROM projects p WHERE p.id = s.project_id)
 WHERE s.issuer_id IS NULL;
-- Índice de apoyo para el conteo por sociedad+serie+año
CREATE INDEX IF NOT EXISTS idx_invoice_seq_issuer ON invoice_sequences(issuer_id, ano, serie);

-- 5) SERIES DE PROFORMA (preparación) ---------------------------------------
-- Prefijo de serie de proforma por sociedad (REQ-NUM-05). Vacío = usa 'PRO'.
ALTER TABLE invoice_issuers ADD COLUMN IF NOT EXISTS serie_proforma VARCHAR(20);
