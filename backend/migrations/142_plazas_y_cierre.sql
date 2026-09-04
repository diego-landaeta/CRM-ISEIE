-- #86 · Plazas y cierre de convocatoria en el catalogo.
--
-- El proceso comercial pide el numero de plazas libres en cuatro de sus cinco
-- pasos, y con una regla que no admite interpretacion:
--
--     «El nº de plazas disponibles va en todas las plantillas y se comprueba
--      antes de cada envio: nunca se arrastra el dato del mensaje anterior.»
--
-- Para que eso se pueda cumplir el dato tiene que vivir en el CRM y salir solo.
--
-- Se guardan los DOS EXTREMOS, nunca el resultado:
--
--     plazas_totales             cuantas caben en la convocatoria
--     plazas_ocupadas_previas    las que ya estaban dadas antes de que el CRM
--                                llevara la cuenta (matriculas viejas, traspasos)
--
-- Las ocupadas se cuentan de las ventas y las libres se restan. Ninguna de las
-- dos se teclea, y por eso no hay columna para ellas: un contador que se lleva
-- a mano miente al tercer dia, y aqui mentiria dentro de un mensaje que ya ha
-- salido al cliente.
--
-- `fecha_cierre_convocatoria` es DATE y no texto a proposito. Ya existe
-- `fecha_inicio_texto`, que llego de WordPress como «marzo 2026»: con eso no se
-- pueden contar los dias que pide la plantilla del dia 3 —«estamos a [X] dias
-- del cierre»— ni avisar de que se acaba.
--
-- Las tres columnas son opcionales: no toda formacion tiene convocatoria con
-- plazas, y las que no la tengan se quedan como estan.

ALTER TABLE products ADD COLUMN IF NOT EXISTS plazas_totales INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS plazas_ocupadas_previas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fecha_cierre_convocatoria DATE;

COMMENT ON COLUMN products.plazas_totales IS
  'Plazas de la convocatoria. NULL = esta formacion no lleva cuenta de plazas.';
COMMENT ON COLUMN products.plazas_ocupadas_previas IS
  'Matriculas anteriores al CRM. Se SUMA a las ventas contadas; no se teclea el total.';
COMMENT ON COLUMN products.fecha_cierre_convocatoria IS
  'Cierre real, en fecha. Distinto de fecha_inicio_texto, que es texto libre de WordPress.';

-- `ADD CONSTRAINT` no admite IF NOT EXISTS, asi que se comprueba antes: la
-- migracion tiene que poder correrse dos veces sin romperse.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_plazas_totales_no_negativas') THEN
    ALTER TABLE products ADD CONSTRAINT products_plazas_totales_no_negativas
      CHECK (plazas_totales IS NULL OR plazas_totales >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_plazas_previas_no_negativas') THEN
    ALTER TABLE products ADD CONSTRAINT products_plazas_previas_no_negativas
      CHECK (plazas_ocupadas_previas >= 0);
  END IF;
END $$;

-- Las ocupadas se cuentan por esta columna, asi que conviene que este indexada.
CREATE INDEX IF NOT EXISTS idx_conversions_producto_contratado
  ON conversions (producto_contratado_id) WHERE producto_contratado_id IS NOT NULL;
