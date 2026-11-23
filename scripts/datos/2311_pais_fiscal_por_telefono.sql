-- Corrección de datos (23/11/2026): prospectos con pais_fiscal = 'España' por el
-- valor por defecto de la 090, pero con teléfono de otro país y sin ninguna
-- prueba de vivir en España (DNI/NIE/NIF español o código postal español).
-- Pasan al país del prefijo. Copia en respaldo_pais_2311_leads_b. Reaplicable.
BEGIN;
CREATE TEMP TABLE cand_l AS
WITH b AS (
  SELECT id, regexp_replace(coalesce(telefono,''),'[^0-9]','','g') AS d, telefono, identificacion_fiscal, codigo_postal_fiscal
    FROM leads
   WHERE pais_fiscal = 'España'
     AND btrim(coalesce(telefono,'')) ~ '^(\+|00)'
     AND regexp_replace(coalesce(telefono,''),'[^0-9]','','g') !~ '^(00)?34'
     -- Prueba de que vive en España: DNI/NIE/NIF español o código postal español. Esos no se tocan.
     AND coalesce(upper(regexp_replace(identificacion_fiscal,'[^A-Za-z0-9]','','g')),'') !~ '^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$'
     AND coalesce(btrim(codigo_postal_fiscal),'') !~ '^(0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}$'
), c AS (
  SELECT b.*, regexp_replace(d, '^00', '') AS n FROM b
)
SELECT id, CASE
  WHEN n ~ '^1(809|829|849)' THEN 'República Dominicana'
  WHEN n ~ '^1(787|939)' THEN 'Puerto Rico'
  WHEN n ~ '^593' THEN 'Ecuador'   WHEN n ~ '^595' THEN 'Paraguay'  WHEN n ~ '^598' THEN 'Uruguay'
  WHEN n ~ '^591' THEN 'Bolivia'   WHEN n ~ '^506' THEN 'Costa Rica' WHEN n ~ '^507' THEN 'Panamá'
  WHEN n ~ '^502' THEN 'Guatemala' WHEN n ~ '^503' THEN 'El Salvador' WHEN n ~ '^504' THEN 'Honduras'
  WHEN n ~ '^505' THEN 'Nicaragua' WHEN n ~ '^351' THEN 'Portugal'
  WHEN n ~ '^52' THEN 'México'     WHEN n ~ '^54' THEN 'Argentina'  WHEN n ~ '^56' THEN 'Chile'
  WHEN n ~ '^57' THEN 'Colombia'   WHEN n ~ '^58' THEN 'Venezuela'  WHEN n ~ '^51' THEN 'Perú'
  WHEN n ~ '^53' THEN 'Cuba'       WHEN n ~ '^55' THEN 'Brasil'     WHEN n ~ '^39' THEN 'Italia'
  WHEN n ~ '^44' THEN 'Reino Unido' WHEN n ~ '^33' THEN 'Francia'   WHEN n ~ '^49' THEN 'Alemania'
  WHEN n ~ '^1' THEN 'Estados Unidos / Canadá'
  END AS nuevo
FROM c;
DELETE FROM cand_l WHERE nuevo IS NULL;
CREATE TABLE IF NOT EXISTS respaldo_pais_2311_leads_b (id INTEGER, pais_fiscal VARCHAR(80), copiado TIMESTAMPTZ DEFAULT now());
INSERT INTO respaldo_pais_2311_leads_b (id, pais_fiscal) SELECT l.id, l.pais_fiscal FROM leads l JOIN cand_l c ON c.id = l.id;
UPDATE leads l SET pais_fiscal = c.nuevo FROM cand_l c WHERE c.id = l.id AND l.pais_fiscal = 'España';
SELECT nuevo, count(*) FROM cand_l GROUP BY 1 ORDER BY 2 DESC;
COMMIT;
