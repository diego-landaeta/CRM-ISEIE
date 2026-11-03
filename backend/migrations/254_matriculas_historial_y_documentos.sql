-- CRM-ISEIE 254 = MultiCRM 212 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- Matrículas (#199): el historial de cada matrícula y los dos documentos que faltaban.
--
--   · DNI por detrás y foto: Diego los pide en la lista y en la ficha («DNI por
--     las dos caras, foto, título, firma») y en el contrato de la #198
--     (`dni_dorso`, `foto`). Hasta ahora solo había sitio para el DNI de
--     delante, el título y la firma.
--   · El historial: la ficha enseña «Recibida por el formulario el 01/10 a las
--     09:12», «Datos validados por Mireia el 01/10 a las 11:40»… La tabla solo
--     guardaba el ÚLTIMO cambio (validated_by, validated_at); aquí queda cada uno.
--     Como el registro de las facturas de colaboradores: no se borra ni se edita.
--
-- 212: la 207 la tomó la firma del alumno de Certifex (#349) y la 208–211 son
-- de las consultas de alumnos (#187–#190). Se puede pasar dos veces.

BEGIN;

ALTER TABLE matriculas
  ADD COLUMN IF NOT EXISTS dni_dorso_url TEXT,
  ADD COLUMN IF NOT EXISTS dni_dorso_key TEXT,
  ADD COLUMN IF NOT EXISTS foto_url TEXT,
  ADD COLUMN IF NOT EXISTS foto_key TEXT;

CREATE TABLE IF NOT EXISTS matriculas_eventos (
  id SERIAL PRIMARY KEY,
  matricula_id INTEGER NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
  -- 'recibida' (llega por el formulario), 'creada' (a mano), 'estado' (cambia
  -- de estado) o 'documento' (se sube o se reemplaza uno).
  evento VARCHAR(20) NOT NULL CHECK (evento IN ('recibida', 'creada', 'estado', 'documento')),
  estado VARCHAR(20),          -- el estado nuevo, en 'estado'
  motivo TEXT,                 -- el motivo, al rechazar
  documento VARCHAR(20),       -- cuál, en 'documento': dni, dni_dorso, foto, titulo o firma
  reemplazo BOOLEAN NOT NULL DEFAULT false,  -- si ya había uno
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matriculas_eventos_matricula ON matriculas_eventos (matricula_id, creado_at);

-- Las matrículas que ya existen empiezan su historial con lo que se sabe: su
-- llegada y su último cambio de estado (quién y cuándo). Solo las que aún no
-- tienen historial, para poder pasarla dos veces.
INSERT INTO matriculas_eventos (matricula_id, evento, estado, motivo, user_id, creado_at)
SELECT m.id, x.evento, x.estado, x.motivo, x.user_id, x.cuando
  FROM matriculas m
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN m.source IN ('webhook', 'form') THEN 'recibida' ELSE 'creada' END, NULL::varchar, NULL::text, NULL::int,
     COALESCE(m.webhook_received_at, m.created_at)),
    ('estado', m.estado, m.motivo_rechazo, m.validated_by, m.validated_at)
  ) AS x(evento, estado, motivo, user_id, cuando)
 WHERE NOT EXISTS (SELECT 1 FROM matriculas_eventos e WHERE e.matricula_id = m.id)
   AND (x.evento <> 'estado' OR m.validated_at IS NOT NULL);

-- Sin esto la API da «permission denied» (como certifex_consultas el 30/09).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- Solo leer y añadir: el historial no se edita ni se borra (al borrar la
      -- matrícula, sus líneas se van en cascada, sin necesitar este permiso).
      EXECUTE format('GRANT SELECT, INSERT ON matriculas_eventos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE matriculas_eventos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
