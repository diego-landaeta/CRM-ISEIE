-- Incidencias. Gemela de diego-landaeta/CRM#612 (el #253 del 360).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- Diego, 06/10: «Necesitamos crear un apartado de incidencias y anotar estas
-- incidencias… estos errores capa 8 que ocasionan. Que sea como la sección de
-- soporte.» Hoy acaban en un WhatsApp o en un comentario de GitHub y se
-- pierden. Se registran para corregir, no para señalar: saber quién necesita
-- formación y en qué, y separar el fallo del CRM del fallo de uso.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL NÚMERO
--
-- La 307: `staging` de ISEIE llega a la 306. En el 360 es la 238. Antes de
-- aplicarla, comprobar que sigue libre. Va numerada aparte en cada CRM.
--
-- Se aplica como `postgres`, con `psql -v ON_ERROR_STOP=1`, y después hay que
-- darle los permisos a `crm_user` y pasarle la propiedad (las tablas nuevas
-- nacen de `postgres`, #71). Es reaplicable (`IF NOT EXISTS`).
--
-- Las incidencias de ejemplo de la issue del 360 NO van aquí ni en el seed de
-- ISEIE: eran de los campus del 360.

BEGIN;

CREATE TABLE IF NOT EXISTS incidencias (
  id              SERIAL PRIMARY KEY,

  -- Cuándo pasó, que no es cuándo se apunta: muchas se registran días después.
  ocurrio_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- En qué CRM. Cada CRM guarda las suyas, pero una incidencia del otro se
  -- puede apuntar aquí (la vio el mismo equipo).
  crm             VARCHAR(16) NOT NULL DEFAULT 'iseie'
                    CHECK (crm IN ('multicrm', 'iseie')),
  -- El campus O la empresa. Las dos pueden ir vacías: una incidencia de un
  -- usuario o del CRM en general no es de ningún campus.
  project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  sociedad_id     INTEGER REFERENCES invoice_issuers(id) ON DELETE SET NULL,

  -- Una LISTA y no un tipo: en la tabla de la issue la mitad son «capa 8 +
  -- fallo del CRM». Con uno solo habría que elegir y la métrica mentiría.
  tipos           TEXT[] NOT NULL
                    CHECK (cardinality(tipos) >= 1
                           AND tipos <@ ARRAY['capa8', 'fallo_crm', 'dato_mal', 'externo']::text[]),

  -- Quién la causó (si fue alguien del CRM) y quién la detectó. Si la persona
  -- se va, la incidencia sigue siendo real.
  causada_por     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detectada_por   INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Sobre qué: el tipo de ficha y su id, para enlazarla. Sin clave foránea a
  -- propósito: apunta a tablas distintas y la ficha puede haberse borrado
  -- justo por la incidencia (Irene, prospecto 4033).
  entidad_tipo    VARCHAR(16)
                    CHECK (entidad_tipo IN ('lead', 'venta', 'factura', 'usuario', 'otro')),
  entidad_id      INTEGER,

  que_paso        TEXT NOT NULL,
  impacto         TEXT,
  como_se_arreglo TEXT,
  arreglada_por   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  arreglada_at    TIMESTAMPTZ,

  -- Gravedad y estado con los MISMOS valores que Soporte (230_soporte.sql):
  -- «que sea como la sección de soporte».
  gravedad        VARCHAR(16) NOT NULL DEFAULT 'medium'
                    CHECK (gravedad IN ('low', 'medium', 'high', 'critical')),
  estado          VARCHAR(16) NOT NULL DEFAULT 'open'
                    CHECK (estado IN ('open', 'in_review', 'resolved', 'closed')),

  creada_por      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La lista se abre por lo más reciente; las métricas agrupan por persona y mes.
CREATE INDEX IF NOT EXISTS idx_incidencias_recientes ON incidencias (ocurrio_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_causada   ON incidencias (causada_por, ocurrio_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_proyecto  ON incidencias (project_id);

-- ── Los adjuntos ────────────────────────────────────────────────────────────
--
-- Como `ticket_adjuntos`: la CLAVE en disco, no el fichero, y la descarga
-- detrás de la sesión y del alcance de quien la pide.
CREATE TABLE IF NOT EXISTS incidencia_adjuntos (
  id             SERIAL PRIMARY KEY,
  incidencia_id  INTEGER NOT NULL REFERENCES incidencias(id) ON DELETE CASCADE,
  nombre         VARCHAR(255) NOT NULL,
  clave          TEXT NOT NULL,
  mime           VARCHAR(120),
  bytes          INTEGER,
  subido_por     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidencia_adjuntos_incidencia
  ON incidencia_adjuntos (incidencia_id);

COMMENT ON TABLE incidencias IS
  'Incidencias (#253), sobre todo las de capa 8. Se registran para corregir, no para señalar.';

-- Como en la 230 y la 232: que el CRM pueda escribir aunque la migración la
-- pase postgres. Sin esto, la API respondería 500 al primer listado.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON incidencias, incidencia_adjuntos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE incidencias_id_seq, incidencia_adjuntos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
