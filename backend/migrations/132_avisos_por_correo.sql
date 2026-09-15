-- Migracion 132: que cada persona pueda apagar sus avisos por correo
--
-- Es la cuarta subfase de la tarea #28. Los tres avisos nuevos —lead sin tocar a
-- los 30 minutos, resumen del dia y plan de mañana— se mandan a todo el mundo
-- salvo que alguien diga que no.
--
-- Se guarda solo lo APAGADO, no lo encendido. Asi:
--
--   · Un usuario nuevo recibe los avisos desde el primer dia sin que nadie tenga
--     que darle de alta en ninguna tabla.
--   · Un aviso nuevo que se añada mañana llega a todos por defecto, que es lo
--     que se quiere: si hay que apuntar a cada persona en cada aviso, el que se
--     olvide se queda sin el y nadie se entera.
--
-- La tabla es una fila por persona y aviso apagado. Vacia = todos reciben todo.

CREATE TABLE IF NOT EXISTS avisos_apagados (
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Que aviso concreto. Sin CHECK a proposito: los avisos se añaden con el
  -- tiempo y una lista cerrada obligaria a una migracion por cada uno. Los que
  -- hay hoy: 'lead_sin_tocar', 'resumen_del_dia', 'plan_de_manana'.
  aviso      VARCHAR(40) NOT NULL,

  apagado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, aviso)
);

CREATE INDEX IF NOT EXISTS idx_avisos_apagados_usuario
  ON avisos_apagados (user_id);

-- El propietario, sin cablear ningun nombre: se toma el dueño de la base en la
-- que se este ejecutando. En ISEIH es crm_user y en ISEIE crm_iseie_user. Sin
-- esto la tabla se queda de postgres y la aplicacion responde 500 con
-- «permission denied».
DO $$
DECLARE duenyo TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo
    FROM pg_database WHERE datname = current_database();
  EXECUTE format('ALTER TABLE avisos_apagados OWNER TO %I', duenyo);
END $$;

COMMENT ON TABLE avisos_apagados IS
  'Avisos por correo que una persona ha apagado. Vacia = todos reciben todo.';
COMMENT ON COLUMN avisos_apagados.aviso IS
  'lead_sin_tocar, resumen_del_dia, plan_de_manana...';
