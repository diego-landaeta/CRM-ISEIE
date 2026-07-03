-- Migración 102: Sociedades emisoras (agrupación de proyectos) + asignación proyecto→sociedad.
-- Las 3 sociedades se crean como emisoras GLOBALES (project_id NULL) con datos placeholder
-- (se completan luego desde el panel). Los proyectos se asignan por nombre.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sociedad_emisora_id INTEGER REFERENCES invoice_issuers(id);

INSERT INTO invoice_issuers (project_id, razon_social, nif, pais, serie, es_default, activo)
SELECT NULL, 'CEDIA Investigación y Desarrollo SL', 'PENDIENTE-CIF-CEDIA', 'España', 'CEDIA', false, true
WHERE NOT EXISTS (SELECT 1 FROM invoice_issuers WHERE razon_social = 'CEDIA Investigación y Desarrollo SL');

INSERT INTO invoice_issuers (project_id, razon_social, nif, pais, serie, es_default, activo)
SELECT NULL, 'Ictess Ingeniería e Innovación SL', 'PENDIENTE-CIF-ICTESS', 'España', 'ICTESS', false, true
WHERE NOT EXISTS (SELECT 1 FROM invoice_issuers WHERE razon_social = 'Ictess Ingeniería e Innovación SL');

INSERT INTO invoice_issuers (project_id, razon_social, nif, pais, serie, es_default, activo)
SELECT NULL, 'Lateral Thinking Solutions SL', 'PENDIENTE-CIF-LATERAL', 'España', 'LATERAL', false, true
WHERE NOT EXISTS (SELECT 1 FROM invoice_issuers WHERE razon_social = 'Lateral Thinking Solutions SL');

-- Asignación por nombre de proyecto (case-insensitive, tolera acentos aproximando)
UPDATE projects SET sociedad_emisora_id = (SELECT id FROM invoice_issuers WHERE razon_social='Lateral Thinking Solutions SL' LIMIT 1)
 WHERE nombre ILIKE '%academia%';
UPDATE projects SET sociedad_emisora_id = (SELECT id FROM invoice_issuers WHERE razon_social='Ictess Ingeniería e Innovación SL' LIMIT 1)
 WHERE nombre ILIKE '%ictess%' OR nombre ILIKE '%veterinary%';
UPDATE projects SET sociedad_emisora_id = (SELECT id FROM invoice_issuers WHERE razon_social='CEDIA Investigación y Desarrollo SL' LIMIT 1)
 WHERE nombre ILIKE '%fono%' OR nombre ILIKE '%psiko%' OR nombre ILIKE '%iseih%' OR nombre ILIKE '%isaeg%'
    OR nombre ILIKE '%psic_logo ia%' OR nombre ILIKE '%nutricion%' OR nombre ILIKE '%tarot%' OR nombre ILIKE '%sex_logo%';
