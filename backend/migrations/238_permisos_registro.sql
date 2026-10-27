-- Registro de cambios de permisos (#423, fase 3)
--
-- Diego, 21/10: «queda registrado cada cambio de permisos (quién cambió qué,
-- a quién y cuándo)». Hasta hoy, dar o quitar una excepción, cambiar lo que
-- trae un rol o el rol de una persona no dejaba rastro: se pisaba la fila y
-- punto.
--
-- `permisos_registro` es de SOLO AÑADIR, como `facturas_colaborador_registro`
-- (198): la aplicación puede leer e insertar, nunca cambiar ni borrar. Se
-- escribe en la misma transacción que el cambio: si el cambio no se guarda,
-- tampoco el apunte, y al revés.
--
-- `permisos_inertes_archivo` guarda lo que la migración 239 quita de los roles
-- a medida y de las excepciones porque hoy no surte efecto (claves que ninguna
-- ruta miraba). Se archiva en vez de borrarse: si Diego decide activarlo, está
-- aquí.
--
-- En MultiCRM es la 221. Aquí la 238: la 234 ya la usa una rama del equipo y se dejan
-- libres la 235 a la 237 para lo que venga de Tareas.
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS permisos_registro (
    id BIGSERIAL PRIMARY KEY,
    cuando TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Quién lo cambió. NULL = la propia migración o el sistema.
    quien_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- A qué se le cambia: a una persona, a un rol fijo o a un rol a medida.
    destino_tipo VARCHAR(20) NOT NULL CHECK (destino_tipo IN ('usuario', 'rol', 'rol_medida')),
    usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rol VARCHAR(30),
    custom_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL,
    -- `clave` es la del catálogo («facturas.emitir») o, para lo que no es una
    -- clave, qué se cambió («rol», «roles_extra», «rol_a_medida»).
    clave VARCHAR(100) NOT NULL,
    antes TEXT,
    despues TEXT,
    -- Desde dónde: 'pantalla_roles', 'ficha_usuario', 'usuarios', 'panel_mcp',
    -- 'migracion_239'…
    origen VARCHAR(40) NOT NULL,
    motivo TEXT
);

CREATE INDEX IF NOT EXISTS idx_permisos_registro_usuario ON permisos_registro (usuario_id, cuando DESC);
CREATE INDEX IF NOT EXISTS idx_permisos_registro_clave ON permisos_registro (clave, cuando DESC);
CREATE INDEX IF NOT EXISTS idx_permisos_registro_rol ON permisos_registro (rol, cuando DESC);

-- Quién y cuándo, también en la excepción misma.
ALTER TABLE user_permission_overrides ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE user_permission_overrides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS permisos_inertes_archivo (
    id SERIAL PRIMARY KEY,
    archivado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 'excepcion' (user_permission_overrides) o 'rol_medida' (custom_roles.permissions)
    de_donde VARCHAR(20) NOT NULL,
    usuario_id INTEGER,
    custom_role_id INTEGER,
    clave VARCHAR(100) NOT NULL,
    valor BOOLEAN NOT NULL,
    UNIQUE (de_donde, usuario_id, custom_role_id, clave)
);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT ON permisos_registro TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE permisos_registro_id_seq TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT ON permisos_inertes_archivo TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE permisos_inertes_archivo_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
