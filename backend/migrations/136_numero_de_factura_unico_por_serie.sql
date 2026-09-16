-- El numero de factura, unico por SERIE y AÑO. No por proyecto.
--
-- EL FALLO
--   La restriccion era `UNIQUE (project_id, ano, serie, numero)`, asi que el
--   mismo numero podia salir una vez por proyecto. CEDIA factura desde cuatro
--   (ISEIH, Psiko Aprende, Fono Aprende e ISAEG) y cada uno llevaba su cuenta:
--   23 numeros salieron por duplicado y los cinco primeros hasta tres veces.
--
--   Dos facturas distintas con el mismo «2026/0005»: una de ISEIH por 140 € y
--   otra de Fono Aprende por 765 €. Y no era solo cosmetico — el codigo dejaba
--   de identificar el documento. Buscando por codigo para anular una factura,
--   la orden alcanzaba DOS de clientes distintos.
--
-- QUE SE HIZO ANTES
--   Se renumeraron las 25 repetidas (01/09/2026), dejando intacta la mas
--   antigua de cada numero y repartiendo los nuevos por orden de emision. La
--   serie CEDIA quedo del 1 al 86 sin huecos. Sin eso, esto no se puede crear.
--
-- POR QUE CUBRE TAMBIEN LAS ANULADAS
--   Una anulada conserva su numero y nadie puede reutilizarlo: la serie tiene
--   que seguir siendo correlativa aunque haya bajas.
--
-- POR QUE INDICE Y NO RESTRICCION
--   Un borrador aun no tiene numero, y una restriccion UNIQUE no admite el
--   `WHERE numero IS NOT NULL` que los deja fuera.
--
-- LO QUE ESTO NO ARREGLA
--   El codigo sigue siendo `año/numero` sin la serie, asi que CEDIA e ICTESS
--   pueden tener los dos un «2026/0005». Son documentos legitimos de sociedades
--   distintas —el PDF dice cual— pero en una lista se confunden. Eso es un
--   cambio de formato del codigo y se decide aparte.
BEGIN;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS uq_invoice_year_serie_numero;
DROP INDEX IF EXISTS uq_invoice_year_serie_numero;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_ano_serie_numero
  ON invoices (ano, serie, numero) WHERE numero IS NOT NULL;

COMMENT ON INDEX uq_invoice_ano_serie_numero IS
  'La serie manda: un numero por serie y año, mire desde el proyecto que mire.';

COMMIT;
