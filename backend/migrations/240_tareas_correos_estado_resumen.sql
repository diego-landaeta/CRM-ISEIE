-- 240 · Correos del tablero: cambio de estado y resumen del día (Diego, 26/10/2026)
--
-- «Cada vez que te llegue una tarea te manda un correo, y uno para cuando cambian
-- el status, y todos los días de lunes a viernes mande su resumen de lo que hizo
-- y lo que falta.»
--
--   · task_status_notices: el cambio de estado que espera para salir por correo.
--     Una fila por tarea: si en un par de minutos se mueve varias veces, la fila
--     se actualiza (se queda el estado de ANTES de la ráfaga y el último) y sale
--     un solo correo. Vive en la base y no en memoria para que un reinicio en
--     medio no se lo coma.
--   · task_daily_summaries: el resumen de la tarde ya enviado, por persona y día.
--     Es la barrera contra repetirlo si el servidor se reinicia a las 18:10.
--
-- Se puede pasar dos veces.

BEGIN;

CREATE TABLE IF NOT EXISTS task_status_notices (
    task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    from_status VARCHAR(50) NOT NULL,
    to_status VARCHAR(50) NOT NULL,
    changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- 'devuelta', 'aprobada' o NULL (un movimiento en el tablero).
    accion VARCHAR(20),
    comment TEXT,
    -- A quién ya le llegó un correo propio por el último cambio («Tarea devuelta»,
    -- «Para revisar»…): a ese no se le manda también el de cambio de estado.
    ya_con_correo INTEGER[] NOT NULL DEFAULT '{}',
    cambios INTEGER NOT NULL DEFAULT 1,
    first_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_status_notices_last ON task_status_notices(last_at);

CREATE TABLE IF NOT EXISTS task_daily_summaries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dia DATE NOT NULL,
    -- 'enviado', 'simulado' (TAREAS_CORREOS_ACTIVOS apagado) o 'bloqueado' (freno de pruebas).
    estado VARCHAR(12) NOT NULL DEFAULT 'enviado',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, dia)
);

-- Si la migración la pasa postgres, el usuario de la aplicación tiene que poder usarlas.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON task_status_notices, task_daily_summaries TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
