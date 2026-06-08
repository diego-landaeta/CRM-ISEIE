-- RFC sin proyecto = "General" (cambios cross-proyecto o de plataforma).
-- Permite NULL en project_id + ajusta el UNIQUE para incluir esa posibilidad.
ALTER TABLE change_requests ALTER COLUMN project_id DROP NOT NULL;

-- El UNIQUE (project_id, codigo_rfc) ya existe — PostgreSQL trata NULL como
-- distinct en UNIQUE así que ya permite múltiples 'RFC-G-001' con project_id
-- IS NULL implícitamente. Lo dejamos como está.
