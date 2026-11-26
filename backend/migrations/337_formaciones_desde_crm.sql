-- Formaciones desde el CRM · fase 1 (CRM-ISEIE#767, gemela de la 325 de CRM#1113)
--
-- Diego, 24/11/2026: «todo desde el CRM»: la formación del catálogo, su curso de
-- Moodle con los módulos y su ficha en la web se crean y se editan desde la
-- misma pantalla. Esta es la parte del catálogo.
--
-- Una formación ES un producto: `products` ya tiene el nombre, el precio y la
-- moneda, las horas (texto, «100 horas», lo que imprime el diploma), la
-- modalidad y los textos de la ficha; y `product_modules` (migración 045) los
-- módulos con su orden, título, temario y horas. Las tutoras son las
-- colaboraciones de Tutores (`tutor_collaborations`). Aquí solo se añade lo que
-- no había:
--
--   · el TIPO (curso, diplomado o máster). Hasta hoy se adivinaba por el nombre
--     (`cursos-pendientes.venta.js`); NULL = sin decir, y se sigue adivinando.
--   · las FECHAS de inicio y de fin como fecha. `fecha_inicio_texto` es lo que
--     dice la web («Próxima convocatoria: marzo»), y se queda como está.
--
-- Texto con CHECK y no un ENUM: es una columna nueva, sin nada que ampliar.
-- Todo con IF NOT EXISTS: se puede pasar dos veces.

ALTER TABLE products ADD COLUMN IF NOT EXISTS tipo_formacion VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS fecha_inicio DATE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fecha_fin DATE;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tipo_formacion_check;
ALTER TABLE products ADD CONSTRAINT products_tipo_formacion_check
  CHECK (tipo_formacion IS NULL OR tipo_formacion IN ('curso', 'diplomado', 'master'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_fechas_formacion_check;
ALTER TABLE products ADD CONSTRAINT products_fechas_formacion_check
  CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio);

COMMENT ON COLUMN products.tipo_formacion IS 'curso, diplomado o master (CRM#1113). NULL = sin decir.';
COMMENT ON COLUMN products.fecha_inicio IS 'Inicio de la formación (CRM#1113). El texto de la web sigue en fecha_inicio_texto.';
COMMENT ON COLUMN products.fecha_fin IS 'Fin de la formación (CRM#1113).';
