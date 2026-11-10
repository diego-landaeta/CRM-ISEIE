-- 274 · Equipo comercial: qué gestoras tiene a su cargo una administradora (09/11/2026)
--
-- Carlos, 09/11: «Raquel pasa a ser administradora como Daniela: no recibe leads
-- y puede ver los leads y la gestión en el CRM de las diferentes compañeras.
-- Daniela puede ver todas. Raquel podrá ver sus comerciales asignadas (pueden
-- variar)».
--
-- Hasta hoy había dos alcances: todo el campus (admin) o solo lo suyo (gestora).
-- Esta tabla da el tercero: quien tiene filas aquí como `lider_id` ve lo suyo Y
-- lo de sus gestoras (`alcanceComercial` en shared/utils/roles.js). Sin filas,
-- todo sigue como estaba. El recorte por campus/empresa se aplica además.
--
-- Quién lleva a quién lo decide quien tenga el permiso `equipos.gestionar`
-- (de serie, solo super admin): PUT /api/users/:id/equipo-comercial.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS equipo_comercial (
    lider_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gestora_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creado_por  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    creado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lider_id, gestora_id),
    CHECK (lider_id <> gestora_id)
);

-- «¿Quién lleva a esta gestora?»: la ficha de la gestora y los avisos.
CREATE INDEX IF NOT EXISTS idx_equipo_comercial_gestora ON equipo_comercial(gestora_id);

COMMENT ON TABLE equipo_comercial IS
  'Gestoras a cargo de una administradora (274): el líder ve lo suyo y lo de ellas. Sin filas, el alcance de siempre.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON equipo_comercial TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
