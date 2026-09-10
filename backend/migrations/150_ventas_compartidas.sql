-- Una venta, dos gestoras: repartir el mérito sin descuadrar los totales.
--
-- Diego: «hay casos que dos gestoras atienden a una persona y vende, y hay que
-- compartirlo, mitad y mitad — únicamente el admin y superadmin pueden hacerlo:
-- que una gestora registre la venta y ellas la dividan».
--
-- POR QUÉ UNA TABLA Y NO UNA COLUMNA `vendedora_2_id`. Con una columna caben
-- dos personas y siempre al 50%. Con tabla caben tres el día que hagan falta,
-- se guarda el porcentaje de cada una, y queda registrado quién hizo el reparto
-- —que siendo una función reservada a admin y superadmin, tiene que poder
-- auditarse: mueve el mérito de una persona a otra.
--
-- SE GUARDA EL PORCENTAJE, NO EL IMPORTE. Si mañana se corrige el importe de la
-- venta o se le añade una cuota, el reparto se recalcula solo. Guardando euros
-- habría que acordarse de ajustarlo a mano, y no se haría.
--
-- LA VENTA NO SE TOCA. `conversions.vendedora_id` sigue siendo quien la
-- registró. Esto es una capa encima: una venta sin filas aquí se comporta
-- exactamente como hoy. Por eso se pueden ir migrando las 39 consultas que
-- preguntan «¿de quién es esta venta?» de una en una, sin romper nada.

CREATE TABLE IF NOT EXISTS conversion_vendedoras (
  id                    SERIAL PRIMARY KEY,
  conversion_id         INTEGER NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  -- RESTRICT y no CASCADE: si se borrara la persona, su mitad desapareceria y
  -- la venta pasaria a contar 0,5 para siempre --dinero que se esfuma de los
  -- totales sin que nadie se entere. Hoy no se borra a nadie (solo se
  -- desactiva), asi que esto no bloquea nada; el dia que se intente, avisa.
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  porcentaje            NUMERIC(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  repartida_por_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nota                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una persona aparece una sola vez en el reparto de una venta.
  UNIQUE (conversion_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversion_vendedoras_user
  ON conversion_vendedoras (user_id);

COMMENT ON TABLE conversion_vendedoras IS
  'Reparto de una venta entre varias gestoras. Sin filas = la venta es entera de conversions.vendedora_id, como siempre.';

-- La regla de «de quien es esta venta», escrita UNA VEZ.
--
-- Hasta ahora vivia repetida en 39 sitios como COALESCE(vendedora_id,
-- responsable_id), y de ahi venia que tres pantallas dieran tres numeros
-- distintos para la misma pregunta. Aqui cada venta sale convertida en una fila
-- por gestora con su peso, y contar pasa de COUNT(*) a SUM(peso).
--
-- EL PESO SE NORMALIZA sobre la suma de los porcentajes de esa venta, no se
-- divide entre 100 a secas. Asi SUM(peso) de una venta da EXACTAMENTE 1 aunque
-- los porcentajes guardados sumaran 99 o 101: los totales cuadran por
-- construccion y no porque los datos esten limpios. Un descuadre de un centimo
-- en esta pantalla es justo lo que llevamos semanas persiguiendo.
CREATE OR REPLACE VIEW conversion_reparto AS
  SELECT v.id                AS conversion_id,
         v.project_id,
         v.lead_id,
         v.fecha_conversion,
         v.importe_total,
         v.importe_pagado,
         cv.user_id          AS vendedora_id,
         (cv.porcentaje / SUM(cv.porcentaje) OVER (PARTITION BY cv.conversion_id))::numeric AS peso,
         (COUNT(*) OVER (PARTITION BY cv.conversion_id) > 1) AS compartida
    FROM conversions v
    JOIN conversion_vendedoras cv ON cv.conversion_id = v.id
  UNION ALL
  -- Venta sin repartir: una sola fila, peso 1. Identico a como funciona hoy.
  SELECT v.id,
         v.project_id,
         v.lead_id,
         v.fecha_conversion,
         v.importe_total,
         v.importe_pagado,
         COALESCE(v.vendedora_id, l.responsable_id),
         1::numeric,
         FALSE
    FROM conversions v
    LEFT JOIN leads l ON l.id = v.lead_id
   WHERE NOT EXISTS (SELECT 1 FROM conversion_vendedoras cv WHERE cv.conversion_id = v.id);

COMMENT ON VIEW conversion_reparto IS
  'Una fila por venta y gestora, con su peso (SUM(peso)=1 por venta). Sustituye al COALESCE(vendedora_id, responsable_id) repartido por el codigo.';

-- Permisos (#71): las tablas nuevas nacen siendo de `postgres` porque la
-- migración corre como postgres. Se comprueba SIEMPRE con el usuario del CRM.
DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON conversion_vendedoras TO %I', u);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE conversion_vendedoras_id_seq TO %I', u);
      EXECUTE format('GRANT SELECT ON conversion_reparto TO %I', u);
    END IF;
  END LOOP;
END $$;
