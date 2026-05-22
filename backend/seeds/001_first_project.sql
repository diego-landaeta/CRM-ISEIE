-- ============================================================
-- Seed 001: Primer proyecto ISEIE
-- Idempotente: si ya existe el slug, no hace nada.
-- ============================================================
--
-- Ejecutar después de:
--   1. Aplicar 001_initial_schema.sql
--   2. Crear el superadmin con: node scripts/create-superadmin.js …
--
-- Luego asocia el superadmin al proyecto manualmente o vía UI cuando exista.
-- Para asociar ahora mismo desde psql:
--   INSERT INTO user_projects (user_id, project_id, orden_cola)
--     SELECT u.id, p.id, 0
--       FROM users u, projects p
--      WHERE u.email = 'tu@email.com' AND p.slug = 'iseie';
-- ============================================================

BEGIN;

INSERT INTO projects (nombre, slug, type, emoji, webhook_api_key, theme_color, active)
VALUES (
  'ISEIE',
  'iseie',
  'crm',
  '🎓',
  -- webhook_api_key se regenera vía UI; aquí basta con uno provisional
  encode(gen_random_bytes(32), 'hex'),
  '#002776',
  true
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
