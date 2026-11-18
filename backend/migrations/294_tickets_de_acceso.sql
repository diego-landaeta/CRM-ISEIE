-- Peticiones de acceso como tickets de Soporte (CRM-ISEIE#501, gemela de CRM#820)
--
-- «Dale acceso a X», «se me cerró Claude», «necesito permisos de tutor»: hasta
-- ahora llegaban por chat a Diego y las atendía a mano. Desde el 17/11 el
-- soporte lo lleva el rol `soporte`, y las peticiones entran por el CRM con el
-- botón «Pedir acceso o permiso».
--
-- No es otra bandeja: es un ticket más (#38, migración 267) con `kind = 'access'`, que ven
-- soporte y los admins con el mismo alcance que el resto de tickets. El ticket
-- NO crea usuarios ni da permisos; solo deja la petición apuntada.
--
-- `kind` es VARCHAR con CHECK (migración 267, la 230 de MultiCRM), no un ENUM: basta con rehacer el
-- CHECK. El nombre es el que Postgres le puso al crearlo en línea.
--
-- `acceso` guarda lo que pide el formulario con su forma, para enseñarlo con su
-- rótulo y no tener que leerlo de un texto:
--   { "tipo": "alta" | "permiso" | "campus" | "claude" | "otro",
--     "permiso": "leads.view",            -- la clave que falta, si la hay
--     "persona": { "nombre": "…", "correo": "…" },  -- si es un alta
--     "campus": "…" }                     -- un campus que no es suyo, escrito

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_kind_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_kind_check
  CHECK (kind IN ('bug', 'feature', 'question', 'access'));

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS acceso JSONB;

COMMENT ON COLUMN tickets.acceso IS
  'Solo en kind = access (CRM#820): tipo, permiso, persona {nombre, correo} y campus pedidos.';

CREATE INDEX IF NOT EXISTS idx_tickets_tipo ON tickets (kind, created_at DESC);
