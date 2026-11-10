-- CRM-ISEIE 261 = MultiCRM 217 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- #336 · Cursos pendientes para tutoras, por campus (sustituye al Excel).
--
-- Una formación por crear es UN registro dentro de su campus, con su tutora, su
-- fecha comprometida y su estado; las alumnas que esperan cuelgan de él, cada
-- una vinculada a su ficha y a su venta. Tres tablas:
--
--   cursos_pendientes           una fila por formación a crear Y campus
--   cursos_pendientes_alumnas   una por persona en espera (estado individual)
--   cursos_pendientes_historial quién cambió qué y cuándo, con su motivo
--   cursos_pendientes_avisos    qué aviso de fecha se mandó ya, para no repetir
--
-- «Retrasado» NO es un estado: es una marca que sale sola cuando la fecha
-- comprometida ya pasó y el curso no está publicado (se calcula al leer).
--
-- Reglas que la base defiende aunque falle el código:
--   · no se puede estar «en desarrollo», «publicado» ni «cerrado» sin fecha comprometida;
--   · solo UN pendiente abierto por formación y campus: si se vende otra vez, se
--     suma la alumna (índices únicos parciales, por producto y por nombre);
--   · una alumna una sola vez por pendiente.
--
-- Sin riesgo: solo tablas nuevas. Reaplicable. Para deshacerlo:
--   DROP TABLE cursos_pendientes_avisos, cursos_pendientes_historial, cursos_pendientes_alumnas, cursos_pendientes;
BEGIN;

CREATE TABLE IF NOT EXISTS cursos_pendientes (
    id                  SERIAL        PRIMARY KEY,
    project_id          INTEGER       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Si ya hay ficha en el catálogo. Si no, `nombre` y `url_prevista`; se enlaza al publicar.
    product_id          INTEGER       REFERENCES products(id) ON DELETE SET NULL,
    nombre              VARCHAR(255)  NOT NULL,
    url_prevista        TEXT,
    tipo                VARCHAR(12)   NOT NULL DEFAULT 'curso' CHECK (tipo IN ('curso', 'diplomado', 'master')),
    tutor_id            INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    estado              VARCHAR(20)   NOT NULL DEFAULT 'pendiente_asignar'
                          CHECK (estado IN ('pendiente_asignar', 'asignado', 'en_desarrollo', 'publicado', 'cerrado', 'cancelado')),
    fecha_solicitud     DATE          NOT NULL DEFAULT CURRENT_DATE,
    fecha_comprometida  DATE,
    fecha_publicacion   DATE,
    -- Cuántas veces se ha movido la fecha: a la segunda, avisa al admin.
    veces_movida_fecha  SMALLINT      NOT NULL DEFAULT 0,
    -- El avance: foto, vídeo y módulos. Es lo mismo que «Entregado» en Tutores;
    -- al publicar y enlazar la ficha, esa es la fuente (fase 2).
    avance_foto         BOOLEAN       NOT NULL DEFAULT FALSE,
    avance_video        BOOLEAN       NOT NULL DEFAULT FALSE,
    avance_modulos      SMALLINT      NOT NULL DEFAULT 0 CHECK (avance_modulos IN (0, 25, 50, 75, 100)),
    url_publicada       TEXT,
    notas               TEXT,
    created_by          INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT cp_fecha_para_avanzar CHECK (estado NOT IN ('en_desarrollo', 'publicado', 'cerrado') OR fecha_comprometida IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cp_campus_estado ON cursos_pendientes (project_id, estado, fecha_comprometida);
CREATE INDEX IF NOT EXISTS idx_cp_tutor ON cursos_pendientes (tutor_id, estado);

-- Un solo pendiente ABIERTO por formación y campus.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_abierto_producto
    ON cursos_pendientes (project_id, product_id)
    WHERE product_id IS NOT NULL AND estado NOT IN ('cerrado', 'cancelado');
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_abierto_nombre
    ON cursos_pendientes (project_id, lower(nombre))
    WHERE estado NOT IN ('cerrado', 'cancelado');

CREATE TABLE IF NOT EXISTS cursos_pendientes_alumnas (
    id              SERIAL       PRIMARY KEY,
    curso_id        INTEGER      NOT NULL REFERENCES cursos_pendientes(id) ON DELETE CASCADE,
    -- Nombre, correo y teléfono salen de su ficha: no se vuelven a teclear.
    lead_id         INTEGER      NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    -- De la venta salen la fecha de compra y el importe.
    conversion_id   INTEGER      REFERENCES conversions(id) ON DELETE SET NULL,
    estado          VARCHAR(12)  NOT NULL DEFAULT 'en_espera' CHECK (estado IN ('en_espera', 'habilitada', 'cancelada')),
    avisada         BOOLEAN      NOT NULL DEFAULT FALSE,
    avisada_at      TIMESTAMPTZ,
    habilitada_at   TIMESTAMPTZ,
    habilitada_por  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (curso_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_cpa_lead ON cursos_pendientes_alumnas (lead_id);

CREATE TABLE IF NOT EXISTS cursos_pendientes_historial (
    id          SERIAL       PRIMARY KEY,
    curso_id    INTEGER      NOT NULL REFERENCES cursos_pendientes(id) ON DELETE CASCADE,
    user_id     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    accion      VARCHAR(40)  NOT NULL,
    detalle     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    motivo      TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cph_curso ON cursos_pendientes_historial (curso_id, created_at DESC);

-- Un aviso de fecha, una sola vez por curso y día.
CREATE TABLE IF NOT EXISTS cursos_pendientes_avisos (
    curso_id  INTEGER      NOT NULL REFERENCES cursos_pendientes(id) ON DELETE CASCADE,
    tipo      VARCHAR(30)  NOT NULL,
    dia       DATE         NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (curso_id, tipo, dia)
);

-- Permisos para el usuario de la aplicación (la migración la corre postgres).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON cursos_pendientes, cursos_pendientes_alumnas, cursos_pendientes_historial, cursos_pendientes_avisos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE cursos_pendientes_id_seq, cursos_pendientes_alumnas_id_seq, cursos_pendientes_historial_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
