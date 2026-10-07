-- Pasa la propiedad de todo el esquema `public` al usuario del CRM. Tarea #71.
--
-- EL PROBLEMA
--   Parte de las tablas son del rol `postgres` y no de `crm_user`. Postgres exige
--   ser DUENYO para un ALTER TABLE, asi que el CRM no puede aplicar sus propias
--   migraciones: fallan con «debe ser dueño de la tabla users». Medido en local:
--   45 tablas de `postgres` y 51 de `crm_user` en la misma base.
--
--   Se nota tarde y mal. El login contesta «Error del sistema» porque la consulta
--   pide una columna que la migracion no pudo crear, y nada en esa pantalla
--   sugiere que el problema sea de permisos.
--
-- COMO EJECUTARLO (hace falta ser superusuario; pedira la contrasena de postgres)
--   psql -U postgres -h 127.0.0.1 -d crm_test_db -f scripts/dar-propiedad-a-crm-user.sql
--
--   En el VPS, lo mismo cambiando la base: crm_prod_db o crm_test_db.
--   En ISEIE: crm_iseie (el destino sale solo: el dueño de la base).
--
-- ES IDEMPOTENTE. Las migraciones se aplican como postgres, así que cada tabla
-- nueva nace suya: pasar este script DESPUÉS de cada tanda de migraciones (02/10:
-- 94 de 141 tablas ajenas en MultiCRM, 167 de 212 en ISEIE, 13 en /testeo).
--
-- NO BORRA NI MODIFICA DATOS: solo cambia quien figura como dueño.
DO $$
DECLARE
  -- El dueño de la base es el usuario de la aplicación en los dos CRM (crm_user en
  -- MultiCRM, crm_iseie_user en ISEIE): así el mismo script vale para las dos.
  destino TEXT := (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database());
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tableowner <> destino LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, destino);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Tablas cambiadas: %', n;

  -- Las secuencias van aparte: un SERIAL crea la suya y hereda el dueño de quien
  -- la creo, no el de la tabla. Sin esto, insertar seguiria fallando.
  n := 0;
  FOR r IN SELECT c.relname FROM pg_class c
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind = 'S'
              AND pg_get_userbyid(c.relowner) <> destino LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.relname, destino);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Secuencias cambiadas: %', n;

  -- Y los TIPOS. Se olvidan siempre porque no salen en `\dt`, pero un ENUM es
  -- suyo igual: sin esto, seis migraciones siguen fallando con «debe ser dueño
  -- del tipo user_role» aunque todas las tablas ya esten bien.
  n := 0;
  FOR r IN SELECT t.typname FROM pg_type t
             JOIN pg_namespace ns ON ns.oid = t.typnamespace
            WHERE ns.nspname = 'public' AND t.typtype = 'e'
              AND pg_get_userbyid(t.typowner) <> destino LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO %I', r.typname, destino);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Tipos cambiados: %', n;

  n := 0;
  FOR r IN SELECT viewname FROM pg_views
            WHERE schemaname = 'public' AND viewowner <> destino LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO %I', r.viewname, destino);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Vistas cambiadas: %', n;

  -- Las funciones del CRM (en ISEIE, `set_updated_at`), para que una migración
  -- pueda hacer CREATE OR REPLACE. Las de una extensión (pgcrypto, unaccent) NO:
  -- son de la extensión y deben seguir siendo de postgres.
  n := 0;
  FOR r IN SELECT p.oid::regprocedure AS firma FROM pg_proc p
             JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND pg_get_userbyid(p.proowner) <> destino
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.firma, destino);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Funciones cambiadas: %', n;
END $$;

-- Comprobacion: despues de esto no debe quedar ninguna fila con otro dueño.
SELECT tableowner AS dueno, COUNT(*) AS tablas
  FROM pg_tables WHERE schemaname = 'public'
 GROUP BY 1 ORDER BY 2 DESC;
