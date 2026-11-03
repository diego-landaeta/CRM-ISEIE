-- CRM-ISEIE 267 = MultiCRM 230 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- Soporte de verdad. El #38.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- La pantalla de soporte existe desde hace tiempo —836 líneas entre formulario,
-- listado y lanzador— y no tiene NADA detrás. Los tickets se guardan en el
-- `localStorage` del navegador de quien los abre:
--
--     // frontend/src/modules/soporte/lib/tickets.ts:1
--     // Storage local de tickets de soporte. Cuando exista /api/tickets, este
--     // modulo se reemplaza por el cliente API.
--
-- O sea que hoy alguien reporta una avería, ve su ticket en la lista, y no lo
-- recibe nadie. Ni sale un correo. Se pierde al limpiar el navegador, y quien
-- lo abrió cree que lo ha dicho.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL NÚMERO
--
-- La 230: `staging` llega a la 228 y otras PR abiertas ocupan la 223, la 224 y la 229 (#483, #484, #509). Antes era la 213, que choco con 213_matriculas_datos_de_admision.
-- Antes de aplicarla, comprobar que sigue libre. Va numerada aparte en cada CRM.
--
-- Se aplica como `postgres`, con `psql -v ON_ERROR_STOP=1`, y después hay que
-- darle los permisos a `crm_user` y pasarle la propiedad (las tablas nuevas
-- nacen de `postgres`, #71): sin eso la API no puede leer ni escribir tickets.
-- Es reaplicable (`IF NOT EXISTS`).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ NO SE TRAE
--
-- Los tickets que alguien tenga hoy en su navegador NO se migran: están en
-- `localStorage`, en su máquina, y desde el servidor no se alcanzan. La
-- pantalla lo dirá en vez de hacerlos desaparecer en silencio.

-- ── Los tickets ─────────────────────────────────────────────────────────────
--
-- Las tres enumeraciones salen TAL CUAL del frontal, que ya las tiene escritas
-- y usadas en la pantalla. Se copian en vez de inventar otras para que la
-- migración no obligue a tocar la interfaz:
--
--     TicketStatus    open | in_review | resolved | closed
--     TicketSeverity  low | medium | high | critical
--     TicketKind      bug | feature | question
CREATE TABLE IF NOT EXISTS tickets (
  id                SERIAL PRIMARY KEY,

  -- De quién es. `abierto_por` no se borra en cascada: si alguien deja la
  -- empresa, su avería sigue siendo real y el histórico de tiempos también.
  abierto_por       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- El proyecto desde el que se abrió. Puede ser NULL: se puede reportar algo
  -- del CRM en general, sin que sea de un proyecto.
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,

  kind              VARCHAR(16) NOT NULL DEFAULT 'bug'
                      CHECK (kind IN ('bug', 'feature', 'question')),
  severity          VARCHAR(16) NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  estado            VARCHAR(16) NOT NULL DEFAULT 'open'
                      CHECK (estado IN ('open', 'in_review', 'resolved', 'closed')),

  titulo            VARCHAR(300) NOT NULL,
  descripcion       TEXT,
  -- Los cuatro campos que el formulario ya pide y que son los que hacen
  -- reproducible una avería. Se guardan aparte y no concatenados en la
  -- descripción: así se pueden enseñar con su rótulo y buscar por separado.
  pasos             TEXT,
  esperado          TEXT,
  observado         TEXT,
  por_que_importa   TEXT,
  -- La dirección donde ocurrió. Es lo primero que se mira al reproducir.
  url               TEXT,

  -- ── Cuánto se tarda ──────────────────────────────────────────────────────
  --
  -- La última subfase del ticket pide «cuánto se tarda en responder y en
  -- cerrar». Se guardan los dos INSTANTES, no las duraciones: una duración
  -- guardada se queda vieja en cuanto cambia una fecha, y de los instantes se
  -- saca siempre restando.
  --
  -- `primera_respuesta_at` es la primera respuesta de alguien QUE NO SEA quien
  -- abrió el ticket. Si contara la suya, responderse a uno mismo pondría el
  -- tiempo de respuesta a cero y el número dejaría de significar nada.
  primera_respuesta_at TIMESTAMPTZ,
  cerrado_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El listado se abre siempre por lo más reciente, y filtrado por estado o por
-- quién lo abrió. Sin esto, cada apertura recorre la tabla entera.
CREATE INDEX IF NOT EXISTS idx_tickets_recientes ON tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_estado    ON tickets (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_autor     ON tickets (abierto_por, created_at DESC);

-- ── La conversación ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_mensajes (
  id           SERIAL PRIMARY KEY,
  -- En cascada SÍ: un mensaje sin su ticket no es nada.
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cuerpo       TEXT NOT NULL,
  -- Una nota interna no la ve quien abrió el ticket. Hace falta para poder
  -- discutir una avería sin que el mensaje salga hacia fuera.
  interna      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_mensajes_hilo
  ON ticket_mensajes (ticket_id, created_at);

-- ── Los adjuntos ────────────────────────────────────────────────────────────
--
-- Se guarda la CLAVE en disco, no el fichero: una captura de pantalla dentro de
-- una columna hincha la tabla y los backups.
--
-- OJO CON CÓMO SE SIRVEN. La ruta de descarga tiene que pedir sesión y
-- comprobar de quién es el ticket. En Matrículas se hizo al revés —la ruta de
-- documentos quedó pública «porque la URL es no-guessable», y la URL es un
-- entero correlativo— y hoy se descargan DNI escaneados sin credencial. Aquí
-- no se repite.
CREATE TABLE IF NOT EXISTS ticket_adjuntos (
  id           SERIAL PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  mensaje_id   INTEGER REFERENCES ticket_mensajes(id) ON DELETE CASCADE,
  nombre       VARCHAR(255) NOT NULL,
  clave        TEXT NOT NULL,
  mime         VARCHAR(120),
  bytes        INTEGER,
  subido_por   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_adjuntos_ticket
  ON ticket_adjuntos (ticket_id);

COMMENT ON TABLE tickets IS
  'Soporte (#38). Antes vivian en el localStorage del navegador y no los recibia nadie.';
COMMENT ON COLUMN tickets.primera_respuesta_at IS
  'Primera respuesta de alguien distinto de quien abrio el ticket.';

-- Que el CRM pueda leer y escribir aunque la migración la pase postgres (como la 230 y la 232).
-- Faltaba: en /testeo, Soporte daba «permission denied for table tickets» (02/11).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tickets, ticket_mensajes, ticket_adjuntos TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE tickets_id_seq, ticket_mensajes_id_seq, ticket_adjuntos_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
