-- ============================================================
-- Seed 002: 11 países donde ISEIE opera (España + 10 LATAM/Asia)
-- Cada país = un `projects` row independiente (multi-tenant).
-- Equivale conceptualmente a los proyectos type='ia' del CRM hermano,
-- pero aquí son type='crm' (educación, sin IA).
-- Idempotente: ON CONFLICT (slug) DO NOTHING.
-- Países origen: https://iseie.com (selector de país en footer).
-- ============================================================

BEGIN;

-- Renombrar el proyecto inicial 'iseie' (creado por seed 001) → 'iseie-es' (España = country code madre)
UPDATE projects
   SET nombre = 'ISEIE España',
       slug = 'iseie-es',
       emoji = '🇪🇸'
 WHERE slug = 'iseie' AND nombre = 'ISEIE';

INSERT INTO projects (nombre, slug, type, emoji, webhook_api_key, theme_color, active) VALUES
  ('ISEIE España',     'iseie-es', 'crm', '🇪🇸', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE México',     'iseie-mx', 'crm', '🇲🇽', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Colombia',   'iseie-co', 'crm', '🇨🇴', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Chile',      'iseie-cl', 'crm', '🇨🇱', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Ecuador',    'iseie-ec', 'crm', '🇪🇨', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Perú',       'iseie-pe', 'crm', '🇵🇪', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Panamá',     'iseie-pa', 'crm', '🇵🇦', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Costa Rica', 'iseie-cr', 'crm', '🇨🇷', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Argentina',  'iseie-ar', 'crm', '🇦🇷', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE Brasil',     'iseie-br', 'crm', '🇧🇷', encode(gen_random_bytes(32), 'hex'), '#002776', true),
  ('ISEIE China',      'iseie-cn', 'crm', '🇨🇳', encode(gen_random_bytes(32), 'hex'), '#002776', true)
ON CONFLICT (slug) DO NOTHING;

-- Asegurar que existe project_queue_state por cada proyecto (round-robin necesita la fila)
INSERT INTO project_queue_state (project_id, last_assigned_index)
SELECT p.id, -1
  FROM projects p
  LEFT JOIN project_queue_state q ON q.project_id = p.id
 WHERE q.project_id IS NULL;

-- Asociar el superadmin (manuel@empresa.com) a TODOS los proyectos país
INSERT INTO user_projects (user_id, project_id, orden_cola, active)
SELECT u.id, p.id, 0, true
  FROM users u, projects p
 WHERE u.email = 'manuel@empresa.com'
   AND p.slug LIKE 'iseie-%'
   AND NOT EXISTS (
     SELECT 1 FROM user_projects up
      WHERE up.user_id = u.id AND up.project_id = p.id
   );

COMMIT;
