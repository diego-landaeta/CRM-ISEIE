-- ============================================================
-- 311: matrícula automática en Moodle · fase 1 (gemela de diego-landaeta/CRM#838;
--      en el 360 es la 289, #767, Automatizaciones 4/9)
-- ============================================================
-- Con el primer pago de una venta, el CRM programa la matrícula del alumno en
-- el Moodle de su campus para el día anterior al inicio del curso (o para ese
-- mismo momento si la venta no tiene fecha de inicio o ya ha pasado). Un
-- trabajo programado cada hora la ejecuta, reintenta si algo falla y avisa a
-- administración.
--
--   conversions.fecha_inicio   el día en que empieza el curso para ese alumno,
--                              pactado con la comercial al cerrar la venta.
--                              NULL = sin fecha: se matricula al pagar.
--
--   moodle_cursos_producto     qué curso (o cursos) de Moodle es cada producto.
--                              `project_id` es el campus cuyo Moodle tiene el
--                              curso: el id de un curso solo significa algo
--                              dentro de su Moodle. Sin fila aquí, la matrícula
--                              de ese producto falla con el motivo dicho.
--
--   matriculas_moodle          una matrícula por venta (la vigente; las
--                              canceladas se quedan como historia):
--                                programada  esperando su momento
--                                lista       comprobada y lista para hacerse
--                                            en Moodle (fase 1: la hace
--                                            administración a mano)
--                                hecha       hecha en Moodle (fase 2, plugin)
--                                fallo       agotó los intentos; ver `motivo`
--                                cancelada   se borró la venta o su pago
--                              `conversion_id` y `lead_id` pasan a NULL si se
--                              borra la venta o la ficha: la fila se queda para
--                              saber qué pasó.
--
-- Todo detrás de MATRICULA_MOODLE_ACTIVA (apagado de serie). Apagado, ninguna
-- de estas tablas se lee ni se escribe: un cobro sigue exactamente igual que
-- hoy. Por eso esta migración tiene que estar aplicada ANTES de encenderlo.
--
-- En ISEIE: las tablas no dependen de nada que no exista aquí (conversions,
-- products, projects, leads).
--
-- Reaplicable.

BEGIN;

ALTER TABLE conversions ADD COLUMN IF NOT EXISTS fecha_inicio DATE;
COMMENT ON COLUMN conversions.fecha_inicio IS
  'Inicio del curso pactado con el alumno (#767). La matrícula en Moodle se programa para el día anterior; NULL = al pagar.';

CREATE TABLE IF NOT EXISTS moodle_cursos_producto (
  product_id       INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  project_id       INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  curso_moodle_id  BIGINT      NOT NULL CHECK (curso_moodle_id > 0),
  curso_nombre     TEXT,
  creado_por       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, project_id, curso_moodle_id)
);
CREATE INDEX IF NOT EXISTS idx_moodle_cursos_producto_campus ON moodle_cursos_producto (project_id);

COMMENT ON TABLE moodle_cursos_producto IS
  'Qué curso de Moodle es cada producto (#767). project_id = el campus cuyo Moodle tiene el curso. Un producto puede tener varios.';

CREATE TABLE IF NOT EXISTS matriculas_moodle (
  id                  SERIAL      PRIMARY KEY,
  conversion_id       INTEGER     REFERENCES conversions(id) ON DELETE SET NULL,
  lead_id             INTEGER     REFERENCES leads(id) ON DELETE SET NULL,
  project_id          INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estado              VARCHAR(12) NOT NULL DEFAULT 'programada',
  programada_para     TIMESTAMPTZ NOT NULL,
  intentos            INTEGER     NOT NULL DEFAULT 0,
  proximo_intento_at  TIMESTAMPTZ,
  motivo              TEXT,
  -- Los cursos en los que se matricula, tal como estaban al dejarla lista:
  -- [{ "project_id": 3, "curso_moodle_id": 12, "curso_nombre": "..." }]
  cursos              JSONB,
  -- Fase 2: el usuario de Moodle que se creó o se reutilizó.
  moodle_user_id      BIGINT,
  lista_at            TIMESTAMPTZ,
  hecha_at            TIMESTAMPTZ,
  cancelada_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE matriculas_moodle DROP CONSTRAINT IF EXISTS matriculas_moodle_estado_valido;
ALTER TABLE matriculas_moodle ADD CONSTRAINT matriculas_moodle_estado_valido
  CHECK (estado IN ('programada', 'lista', 'hecha', 'fallo', 'cancelada'));

-- Una sola matrícula vigente por venta: dos procesos que cobran a la vez no la
-- programan dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_matriculas_moodle_vigente
  ON matriculas_moodle (conversion_id)
  WHERE estado <> 'cancelada' AND conversion_id IS NOT NULL;
-- Lo que mira el trabajo de cada hora.
CREATE INDEX IF NOT EXISTS idx_matriculas_moodle_pendientes
  ON matriculas_moodle (programada_para)
  WHERE estado = 'programada';
CREATE INDEX IF NOT EXISTS idx_matriculas_moodle_campus
  ON matriculas_moodle (project_id, estado);

COMMENT ON TABLE matriculas_moodle IS
  'Matrícula automática en Moodle (#767): programada con el primer pago, ejecutada por el trabajo de cada hora.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON moodle_cursos_producto, matriculas_moodle TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE matriculas_moodle_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
