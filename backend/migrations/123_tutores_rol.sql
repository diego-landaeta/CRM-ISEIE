-- Tutores · el rol nuevo
--
-- Va en su propio fichero, separado de las tablas, a proposito: en PostgreSQL
-- «ALTER TYPE ... ADD VALUE» no se puede usar en la misma transaccion en la que
-- se añade, y varias versiones ni siquiera lo aceptan dentro de una. Partirlo
-- evita depender de la version que tenga cada servidor.
--
-- Y ojo con esto, que ya mordio una vez: users.role NO es texto con un CHECK,
-- es un ENUM de Postgres (user_role). Buscar restricciones CHECK y no encontrar
-- nada hace creer que vale cualquier valor; luego el INSERT falla. Eso rompio
-- las conversiones en los dos CRMs.
--
-- Regalo del enum: el reparto de leads filtra por
--   u.role = 'gestor' OR (admin/superadmin AND recibe_leads)
-- asi que un tutor queda fuera del round-robin sin tocar una sola linea.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'tutor';
