-- Datos (23/11/2026; CRM#1015 / CRM-ISEIE#687): el equipo «Tutoras redactoras»
-- de cada empresa que tiene alguna, y ellas dentro como «Miembro».
--
-- Va DESPUÉS de la migración que da task_teams.tipo = 'redactoras' (314 en el
-- 360, 325 en ISEIE). No activa a nadie ni manda correos: las que estén
-- desactivadas siguen así, solo quedan en su equipo para cuando se activen.
-- La encargada (si la hay) se elige después en Configurar tablero › Equipos.
--
-- Una redactora es de una empresa por cualquiera de sus tres caminos: un campus
-- (user_projects), la empresa entera (user_empresas) o como tutora
-- (tutor_empresas). La que no tenga ninguno sale en la lista del final: hay
-- que darle empresa y volver a pasar el script. Reaplicable.
BEGIN;

CREATE TEMP TABLE redactora_empresa ON COMMIT DROP AS
SELECT DISTINCT u.id AS user_id, e.issuer_id
  FROM users u
  JOIN LATERAL (
        SELECT ue.issuer_id FROM user_empresas ue WHERE ue.user_id = u.id
        UNION SELECT p.sociedad_emisora_id FROM user_projects up JOIN projects p ON p.id = up.project_id
               WHERE up.user_id = u.id AND up.active AND p.sociedad_emisora_id IS NOT NULL
        UNION SELECT te.issuer_id FROM tutor_empresas te WHERE te.tutor_id = u.id
       ) e ON TRUE
 WHERE u.role::text = 'tutor_redactor' OR 'tutor_redactor' = ANY(COALESCE(u.roles_extra, '{}')::text[]);

-- El equipo, uno por empresa. Si ya hay uno con ese nombre, se le pone el tipo.
INSERT INTO task_teams (issuer_id, name, color, tipo, sort_order)
SELECT DISTINCT re.issuer_id, 'Tutoras redactoras', 'purple', 'redactoras', 50
  FROM redactora_empresa re
ON CONFLICT (issuer_id, lower(name)) DO UPDATE SET tipo = 'redactoras', is_active = TRUE, updated_at = NOW();

-- Sus cargos de serie, como los equipos nuevos de la pantalla.
INSERT INTO task_team_roles (team_id, name, level, sort_order)
SELECT tm.id, c.name, c.level, c.sort_order
  FROM task_teams tm
  CROSS JOIN (VALUES ('Encargado', 2, 1), ('Miembro', 1, 2)) AS c(name, level, sort_order)
 WHERE tm.tipo = 'redactoras' AND lower(tm.name) = 'tutoras redactoras'
ON CONFLICT (team_id, lower(name)) DO NOTHING;

-- Ellas, como «Miembro». A quien ya está no se le cambia el cargo.
INSERT INTO task_team_members (team_id, user_id, team_role_id)
SELECT tm.id, re.user_id, r.id
  FROM redactora_empresa re
  JOIN task_teams tm ON tm.issuer_id = re.issuer_id AND tm.tipo = 'redactoras' AND lower(tm.name) = 'tutoras redactoras'
  JOIN task_team_roles r ON r.team_id = tm.id AND lower(r.name) = 'miembro'
ON CONFLICT (team_id, user_id) DO NOTHING;

-- Lo que ha quedado.
SELECT ii.razon_social AS empresa, u.id, u.nombre, u.active AS activa, r.name AS cargo
  FROM task_team_members m
  JOIN task_teams tm ON tm.id = m.team_id AND tm.tipo = 'redactoras'
  JOIN invoice_issuers ii ON ii.id = tm.issuer_id
  JOIN users u ON u.id = m.user_id
  JOIN task_team_roles r ON r.id = m.team_role_id
 ORDER BY 1, 3;

-- Redactoras sin empresa: no entran en ningún equipo hasta que se les dé una.
SELECT u.id, u.nombre, u.active AS activa
  FROM users u
 WHERE (u.role::text = 'tutor_redactor' OR 'tutor_redactor' = ANY(COALESCE(u.roles_extra, '{}')::text[]))
   AND NOT EXISTS (SELECT 1 FROM redactora_empresa re WHERE re.user_id = u.id)
 ORDER BY u.nombre;

COMMIT;
