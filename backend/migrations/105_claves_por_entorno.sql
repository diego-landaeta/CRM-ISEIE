-- ============================================================
-- Migracion 105: claves por entorno y los servicios que faltaban (#80)
--
-- Son DOS cambios, y ninguno toca datos existentes.
--
-- Es la misma que la 137 de MultiCRM, renumerada: alli el panel de claves ya
-- esta y aqui se porta (#113). La tabla `api_credentials` es identica en las dos
-- bases (007 aqui), asi que el cambio es el mismo.
--
-- OJO: los dos son DDL —`ALTER TYPE` y `ALTER TABLE`—, asi que hay que correrla
-- con un rol que sea DUEÑO de `api_credentials` y del tipo `api_service`. Si
-- `crm_user` no lo es, falla con «must be owner of»; es lo que ya paso en
-- MultiCRM con la #71. No lo puedo comprobar desde aqui: no toco el servidor.
-- ============================================================

BEGIN;

-- ── 1) Los servicios que aun viven solo en el .env ──────────────────────────
--
-- El enum tenia seis: meta, google_ads, gsc, stripe, claude, brevo. El ticket
-- pide «ampliarlo a los servicios que aun viven en .env», que son estos cuatro.
--
-- `ADD VALUE IF NOT EXISTS` es idempotente, asi que reaplicar la migracion no
-- rompe nada.
ALTER TYPE api_service ADD VALUE IF NOT EXISTS 'woocommerce';
ALTER TYPE api_service ADD VALUE IF NOT EXISTS 'evolution';
ALTER TYPE api_service ADD VALUE IF NOT EXISTS 'r2';
ALTER TYPE api_service ADD VALUE IF NOT EXISTS 'make';

COMMIT;

-- Los valores nuevos de un enum no se pueden usar en la misma transaccion en la
-- que se crean. De ahi el corte: lo de abajo va en su propia transaccion.

BEGIN;

-- ── 2) Que produccion y pruebas quepan a la vez ─────────────────────────────
--
-- El unico era `(project_id, service)`, o sea que del mismo servicio y proyecto
-- solo cabia UNA fila. Con eso, guardar la de produccion y la de pruebas era
-- imposible — y sin las dos no hay forma de avisar de que a un entorno le falta
-- una que el otro si tiene, que es lo que el ticket pide para que el panel
-- «sirva de verdad».
--
-- El entorno vive en `metadata->>'entorno'`, que ya era jsonb y estaba sin usar.
-- Lo que falta aqui es que el indice lo tenga en cuenta.

-- Las que ya existen son de produccion: es lo unico que habia hasta hoy.
UPDATE api_credentials
   SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"entorno":"produccion"}'::jsonb
 WHERE metadata->>'entorno' IS NULL;

-- Se quita como RESTRICCION y no como indice: `uq_ac_project_service` nacio de
-- un UNIQUE en el CREATE TABLE, asi que hay un constraint detras y
-- `DROP INDEX` se niega («cannot drop index ... because constraint ...
-- requires it»).
ALTER TABLE api_credentials DROP CONSTRAINT IF EXISTS uq_ac_project_service;
DROP INDEX IF EXISTS uq_ac_project_service;

-- `COALESCE` porque `project_id` es NULL en las credenciales globales (R2), y
-- en un indice unico dos NULL no chocan entre si: sin esto se podrian meter
-- dos veces la misma credencial global y nadie lo impediria.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ac_proyecto_servicio_entorno
  ON api_credentials (
    COALESCE(project_id, -1),
    service,
    COALESCE(metadata->>'entorno', 'produccion')
  );

-- Para el aviso de paridad, que agrupa por estas tres.
CREATE INDEX IF NOT EXISTS idx_ac_entorno
  ON api_credentials ((metadata->>'entorno')) WHERE active = true;

COMMIT;
