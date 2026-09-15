-- Un proyecto marcado como DE PRUEBAS, para trastear en producción sin
-- ensuciar las cifras.
--
-- Hace falta un sitio donde probar de verdad —con WhatsApp real, que solo
-- existe en producción— y a la vez que lo que se haga ahí no aparezca en los
-- informes de nadie. Un curso inventado con tres ventas falsas metido en el
-- total de la sociedad es exactamente lo contrario de lo que se ha estado
-- arreglando todo el día.
--
-- LA REGLA, en una frase: **un proyecto de pruebas solo se ve si lo eliges**.
--
--   · Elegido a dedo en el selector  → se ve entero, como cualquier otro.
--   · Su sociedad                    → se ve, porque es SU sociedad.
--   · «Todos los proyectos»          → NO aparece.
--   · La cola del día del equipo     → NO aparece.
--
-- Lo de «todos» es lo único que había que tocar, y solo porque el proyecto de
-- pruebas cuelga de una sociedad propia: las sociedades de verdad ni se
-- enteran de que existe.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.es_prueba IS
  'Proyecto de pruebas: queda fuera de «todos los proyectos» y de las colas del equipo. Solo se ve si se elige a dedo.';

-- Se consulta en cada informe que mira «todos», así que conviene que sea
-- barato. Parcial: los de pruebas son dos o tres, no la tabla entera.
CREATE INDEX IF NOT EXISTS idx_projects_es_prueba
  ON projects (id) WHERE es_prueba;
