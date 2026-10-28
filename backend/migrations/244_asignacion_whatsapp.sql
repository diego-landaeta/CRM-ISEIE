-- 244 · Asignación por actividad: la parte de WhatsApp (CRM#513 · CRM-ISEIE#284, fase 5; 27/10/2026)
--
-- Dos consultas nuevas de `asignacion.actividad.js`, que se hacen en cada
-- formulario y en cada visita a una web con el widget:
--
--  · ¿ha escrito la gestora por WhatsApp en los últimos minutos? Ahora cuenta
--    también lo que manda desde su móvil con el número conectado, así que se
--    busca por la hora de WhatsApp (`ts`) en todos los mensajes salientes, no
--    solo en los mandados desde el CRM.
--  · ¿cuántas conversaciones le abrieron hoy? Se buscan por `created_at`.
--
-- Sin estos índices, las dos recorren las tablas enteras.
--
-- Se puede pasar dos veces.

CREATE INDEX IF NOT EXISTS idx_wa_mensajes_saliente_ts
    ON wa_mensajes (ts) WHERE direccion = 'saliente';

CREATE INDEX IF NOT EXISTS idx_wa_conversaciones_creada
    ON wa_conversaciones (created_at);
