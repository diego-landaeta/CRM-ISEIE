-- Vendedora POR VENTA. El responsable del lead (leads.responsable_id) es quien
-- atiende al cliente, pero una misma persona puede tener ventas cerradas por
-- distintas asesoras a lo largo del tiempo. Los informes de ventas deben
-- atribuirse a quien vendió, no a quien lleva el lead hoy.
-- Si vendedora_id es NULL se cae al responsable del lead (COALESCE en reportes).
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS vendedora_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversions_vendedora ON conversions(vendedora_id);
