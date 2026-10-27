-- 242 · El equipo de cada tarea, el de quien la lleva (Diego, 27/10/2026)
--
-- «El equipo es según la persona enlazada. Desarrollo y SEO somos casi todos.»
--
-- Desde ahora el servidor pone el equipo según el responsable. Esta migración
-- ordena las de antes: a las tareas «Sin equipo», o con un equipo del que su
-- responsable no es, les pone el de su responsable. Si está en varios, el de
-- la empresa del campus de la tarea; si no, el primero (por empresa y orden).
-- Si el responsable no está en ningún equipo, la tarea se queda como está.
--
-- No cambia updated_at. Se puede pasar dos veces.

BEGIN;

UPDATE tasks t
   SET team_id = (
         SELECT m.team_id
           FROM task_team_members m
           JOIN task_teams tm ON tm.id = m.team_id AND tm.is_active
           JOIN invoice_issuers ii ON ii.id = tm.issuer_id
           LEFT JOIN projects p ON p.id = t.project_id
          WHERE m.user_id = t.assigned_to
          ORDER BY (tm.issuer_id IS NOT DISTINCT FROM p.sociedad_emisora_id) DESC, ii.razon_social, tm.sort_order, tm.name
          LIMIT 1)
 WHERE t.assigned_to IS NOT NULL
   AND (t.team_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM task_team_members m2 WHERE m2.team_id = t.team_id AND m2.user_id = t.assigned_to))
   AND EXISTS (SELECT 1 FROM task_team_members m3
                 JOIN task_teams tm3 ON tm3.id = m3.team_id AND tm3.is_active
                WHERE m3.user_id = t.assigned_to);

COMMIT;
