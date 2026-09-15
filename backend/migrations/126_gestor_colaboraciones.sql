-- Permiso gestor_colaboraciones: quien da de alta tutores y les asigna cursos,
-- sin ser administrador.
--
-- El codigo del modulo de tutores YA comprobaba esta casilla desde el primer
-- dia (tutor.controller.js), pero la columna no existia en ninguna migracion:
-- la comprobacion daba siempre falso y el permiso no se le podia dar a nadie.
-- Esto lo hace real.
--
-- Se hace con una casilla y no con un rol nuevo a proposito. Es el mismo patron
-- que factura_manager, que en este repositorio funciona; el sistema de roles
-- personalizados esta a medias —checkPermission no se usa en ninguna ruta— y
-- meter ahi un tercer sistema seria repetir el error.
--
-- Lo que NO da esta casilla: liquidar comisiones. Eso mueve dinero y se queda
-- en manos de un administrador. Organizar no es pagar.
ALTER TABLE users ADD COLUMN IF NOT EXISTS gestor_colaboraciones BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.gestor_colaboraciones IS
  'Puede dar de alta tutores y asignarles cursos y porcentajes. NO puede liquidar comisiones.';

-- La propiedad, al dueño de la base: si la migracion se aplica como postgres,
-- la aplicacion se queda sin poder escribir en lo suyo. Ya paso con tutores.
DO $$
DECLARE duenyo TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo FROM pg_database WHERE datname = current_database();
  EXECUTE format('ALTER TABLE users OWNER TO %I', duenyo);
END $$;
