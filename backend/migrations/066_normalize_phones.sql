-- Normaliza todos los teléfonos al formato E.164 con +.
-- Mismos pasos que normalizePhone.js:
--   1. Si arranca con 00 → reemplaza por +
--   2. Si arranca con dígito sin + → agrega +
--   3. Quita ceros iniciales después del +
--   4. Solo si tiene 7+ dígitos
--
-- IGNORA: los que ya empiezan con + (ya están bien)
-- IGNORA: los que tienen menos de 7 dígitos (los dejamos como están)

-- Step 1: Quitar separadores antes de procesar (espacios, guiones, paréntesis, puntos, .0 decimal)
UPDATE leads SET telefono = regexp_replace(telefono, '\.0$', '')
WHERE telefono LIKE '%.0';

UPDATE leads SET telefono = regexp_replace(telefono, '[\s\-().·]', '', 'g')
WHERE telefono ~ '[\s\-().·]';

-- Step 2: 00... → +...
UPDATE leads
SET telefono = '+' || substring(telefono from 3)
WHERE telefono LIKE '00%'
  AND length(regexp_replace(substring(telefono from 3), '[^0-9]', '', 'g')) >= 7;

-- Step 3: dígito sin + → +dígito (longitud >= 7)
UPDATE leads
SET telefono = '+' || telefono
WHERE telefono ~ '^[1-9][0-9]{6,}$'
  AND telefono NOT LIKE '+%';

-- Step 4: limpiar leads con telefono inválido (menos de 7 dígitos o solo basura)
UPDATE leads
SET telefono = NULL
WHERE telefono IS NOT NULL
  AND length(regexp_replace(telefono, '[^0-9]', '', 'g')) < 7;

-- Reporte
SELECT
  COUNT(*) FILTER (WHERE telefono LIKE '+%') AS con_mas,
  COUNT(*) FILTER (WHERE telefono ~ '^[0-9]') AS sin_mas,
  COUNT(*) FILTER (WHERE telefono IS NULL) AS sin_telefono,
  COUNT(*) AS total
FROM leads;
