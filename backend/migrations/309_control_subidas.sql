-- ============================================================
-- 309: control de subidas de contenido por curso (gemela de CRM#840; en el 360, la 297)
-- ============================================================
--
-- Cuando una formación de «Cursos pendientes» (#336) está entregada, alguien
-- (la responsable de las subidas) tiene que subir lo que la acompaña. Una fila por curso y punto:
--
--   videos_youtube         los vídeos de los directores, en YouTube
--   modulos_moodle         los módulos, en el Moodle del campus
--   datos_directores_web   los datos de los directores, enviados para la web
--
-- Cada fila guarda si está hecho, quién y cuándo lo marcó, un enlace o una nota
-- y su fecha límite. `created_at` es «desde cuándo falta». «Atrasado» NO se
-- guarda: sale solo cuando la fecha límite ya pasó y el punto no está hecho.
--
-- Los puntos NO van en un CHECK a propósito: la lista vive en el código
-- (cursos-pendientes.subidas.js · PUNTOS) mientras la dirección no diga si son fijos
-- o varían por curso; cambiarla no exige otra migración.
--
-- Los avisos de punto vencido reutilizan `cursos_pendientes_avisos` (217): uno
-- por curso, punto y fecha límite, para no repetirlo.
--
-- Sin riesgo: solo una tabla nueva. Reaplicable. Para deshacerlo:
--   DROP TABLE cursos_pendientes_subidas;

BEGIN;

CREATE TABLE IF NOT EXISTS cursos_pendientes_subidas (
    id            SERIAL       PRIMARY KEY,
    curso_id      INTEGER      NOT NULL REFERENCES cursos_pendientes(id) ON DELETE CASCADE,
    punto         VARCHAR(30)  NOT NULL,
    fecha_limite  DATE         NOT NULL,
    hecho         BOOLEAN      NOT NULL DEFAULT FALSE,
    hecho_por     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    hecho_at      TIMESTAMPTZ,
    enlace        TEXT,
    nota          TEXT,
    created_by    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (curso_id, punto),
    CONSTRAINT cps_hecho_con_fecha CHECK (NOT hecho OR hecho_at IS NOT NULL)
);

-- Lo que se busca a diario: lo que falta, por fecha límite.
CREATE INDEX IF NOT EXISTS idx_cps_pendientes ON cursos_pendientes_subidas (fecha_limite) WHERE NOT hecho;

-- Permisos para el usuario de la aplicación (la migración la corre postgres).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON cursos_pendientes_subidas TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE cursos_pendientes_subidas_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
