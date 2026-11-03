-- CRM-ISEIE 263 = MultiCRM 219 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- #39 · El baremo de la tasa de cierre: qué significa «un 8,2 %».
--
-- Un porcentaje a secas no dice si es bueno. Los tramos (de qué porcentaje en
-- adelante es «flojo», «normal» o «bueno») los tiene que poner quien lleva el
-- negocio, no el código: Diego lo dejó escrito el 22/09 («según los parámetros
-- de sus % significa algo») y que los tramos «los tiene que decir Carlos». Por
-- eso viven en la base y se editan desde la pantalla.
--
-- Un tramo vale desde su `desde_pct` hasta el siguiente. Siempre hay uno que
-- empieza en 0, para que ninguna tasa quede sin etiqueta. Hay un baremo general
-- (`project_id` NULL) y, si un campus quiere el suyo, uno propio que manda sobre
-- el general. Sin ninguna fila, la pantalla no etiqueta y compara a cada gestora
-- con el equipo, que es lo que se recomendó para empezar.
--
-- Sin riesgo: una tabla nueva y vacía. Reaplicable. Para deshacerla:
--   DROP TABLE tasa_cierre_baremo;
BEGIN;

CREATE TABLE IF NOT EXISTS tasa_cierre_baremo (
    id          SERIAL        PRIMARY KEY,
    project_id  INTEGER       REFERENCES projects(id) ON DELETE CASCADE,
    desde_pct   NUMERIC(5,2)  NOT NULL CHECK (desde_pct >= 0 AND desde_pct < 100),
    etiqueta    VARCHAR(30)   NOT NULL,
    tono        VARCHAR(10)   NOT NULL CHECK (tono IN ('flojo', 'normal', 'bueno')),
    updated_by  INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Un solo tramo por punto de partida y ámbito (el general, con project_id NULL, cuenta como un ámbito).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tcb_ambito_desde ON tasa_cierre_baremo (COALESCE(project_id, 0), desde_pct);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tasa_cierre_baremo TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE tasa_cierre_baremo_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
