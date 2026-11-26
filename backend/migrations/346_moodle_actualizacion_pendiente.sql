-- 346 · El Moodle de un campus con una actualización pendiente (Campus-Moodle#24)
--
-- El 25/11/2026 el Moodle de ISEIE recibió los ficheros de local_crm 1.11.4 pero no el paso
-- de base de datos y se quedó en «Comprobación de plugins» sin que nadie se enterara. Desde la
-- 1.12.0 el plugin lo cuenta (aviso `plugin_estado` y el repaso de cada 15 minutos) y aquí se
-- guarda: NULL = al día; si no, { version_disco, version_bd, pendientes, mensaje, desde }.
-- Lo enseña Integraciones › Moodle y, al pasar a pendiente, avisa a los super admin
-- (backend/src/modules/consultas/consultas.actualizacion.js).
--
-- Solo añade una columna que admite NULL. El código funciona sin ella (avisa igual, una vez al
-- día). Se puede pasar dos veces.

BEGIN;

ALTER TABLE moodle_plugin_campus ADD COLUMN IF NOT EXISTS actualizacion_pendiente JSONB;

COMMIT;
