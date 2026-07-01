ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS condicion_pais VARCHAR(20);
COMMENT ON COLUMN invoice_templates.condicion_pais IS 'null/todos=cualquier cliente, espana=clientes ES, extranjero=fuera de ES';
