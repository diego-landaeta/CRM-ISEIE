-- Opt-in per-project para que admins reciban leads del round-robin.
-- gestor → siempre entra al round-robin (no depende de esta flag)
-- admin / superadmin → solo si user_projects.recibe_leads = TRUE para ESE proyecto
ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS recibe_leads BOOLEAN NOT NULL DEFAULT FALSE;
