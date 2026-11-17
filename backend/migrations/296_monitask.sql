-- ============================================================
-- 296: Monitask en el CRM (#236)
-- ============================================================
-- Qué hace cada colaborador y cotejar las horas de sus facturas (#202) con las
-- que registra Monitask.
--
--   monitask_conexion   UNA fila: la aplicación OAuth de Monitask (client id y
--                       secreto) y los tokens de la cuenta. Todo lo secreto,
--                       cifrado con AES-256-GCM (ENCRYPTION_KEY), como las demás
--                       credenciales. Es de todo el CRM, no de un campus: la
--                       cuenta de Monitask es una por empresa y un CRM.
--   monitask_personas   cada usuario de Monitask y con quién del CRM se empareja
--                       (por correo, o a mano desde la pantalla).
--   monitask_dias       por persona y día (de Madrid): horas trabajadas, horas
--                       activas, % de actividad, y en qué proyectos y tareas.
--                       Sin capturas de pantalla: no se piden ni se guardan.
--   monitask_avisos     la factura de la que ya se avisó en la campana por pasarse
--                       del margen (para no avisar cada noche).
--
-- Se puede pasar dos veces sin romper nada.

BEGIN;

CREATE TABLE IF NOT EXISTS monitask_conexion (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    client_id VARCHAR(200),
    secreto_cifrado TEXT,
    secreto_iv VARCHAR(64),
    secreto_tag VARCHAR(64),
    -- Los cuatro últimos, para enseñar con cuál está puesto sin descifrarlo.
    secreto_cola VARCHAR(8),
    access_cifrado TEXT,
    access_iv VARCHAR(64),
    access_tag VARCHAR(64),
    access_caduca_at TIMESTAMPTZ,
    refresh_cifrado TEXT,
    refresh_iv VARCHAR(64),
    refresh_tag VARCHAR(64),
    conectada_at TIMESTAMPTZ,
    conectada_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- El «Conectar» en curso: de `state` solo la huella (sha256); el verificador
    -- PKCE, cifrado. Valen 10 minutos y una sola vez.
    oauth_state_hash CHAR(64),
    oauth_verifier_cifrado TEXT,
    oauth_verifier_iv VARCHAR(64),
    oauth_verifier_tag VARCHAR(64),
    oauth_caduca_at TIMESTAMPTZ,
    oauth_iniciado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- «Marca en rojo si la diferencia pasa de un margen (por ejemplo, más del 10 %, configurable)».
    margen_pct NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (margen_pct >= 0 AND margen_pct <= 100),
    ultimo_error TEXT,
    ultimo_error_at TIMESTAMPTZ,
    ultima_sync_at TIMESTAMPTZ,
    ultima_sync_resultado JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- El día (de Madrid) de la última vuelta nocturna: una por noche.
    ultima_nocturna DATE,
    -- Desde qué día hay datos traídos sin fallos: los avisos solo miran meses enteros cubiertos.
    cubierto_desde DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS monitask_personas (
    monitask_id BIGINT PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    correo VARCHAR(255),
    colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- correo: lo emparejó el CRM por el correo; manual: una persona;
    -- ninguno: una persona dijo que no es nadie del CRM (y no se vuelve a emparejar solo).
    emparejado VARCHAR(10) CHECK (emparejado IN ('correo', 'manual', 'ninguno')),
    emparejado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    emparejado_at TIMESTAMPTZ,
    -- La última vez que Monitask la devolvió en la lista de usuarios.
    vista_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitask_personas_colaborador ON monitask_personas(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_monitask_personas_user ON monitask_personas(user_id);

CREATE TABLE IF NOT EXISTS monitask_dias (
    monitask_id BIGINT NOT NULL REFERENCES monitask_personas(monitask_id) ON DELETE CASCADE,
    dia DATE NOT NULL,
    segundos INTEGER NOT NULL DEFAULT 0 CHECK (segundos >= 0),
    -- NULL: Monitask no dio actividad ese día (no es lo mismo que 0 %).
    segundos_activos INTEGER CHECK (segundos_activos >= 0),
    actividad_pct NUMERIC(5, 2) CHECK (actividad_pct >= 0 AND actividad_pct <= 100),
    entradas INTEGER NOT NULL DEFAULT 0,
    -- [{ id, nombre, segundos }] y [{ id, nombre, proyecto, segundos }]
    proyectos JSONB NOT NULL DEFAULT '[]'::jsonb,
    tareas JSONB NOT NULL DEFAULT '[]'::jsonb,
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (monitask_id, dia)
);

CREATE INDEX IF NOT EXISTS idx_monitask_dias_dia ON monitask_dias(dia);

CREATE TABLE IF NOT EXISTS monitask_avisos (
    factura_id INTEGER PRIMARY KEY REFERENCES facturas_colaborador(id) ON DELETE CASCADE,
    horas_facturadas NUMERIC(8, 2),
    horas_monitask NUMERIC(8, 2),
    diferencia_pct NUMERIC(8, 2),
    avisado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE monitask_conexion IS
  'Monitask (#236): la aplicación OAuth y los tokens de la cuenta, cifrados. Una sola fila.';
COMMENT ON TABLE monitask_dias IS
  'Monitask (#236): horas, actividad, proyectos y tareas por persona y día. Sin capturas.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON monitask_conexion, monitask_personas, monitask_dias, monitask_avisos TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
