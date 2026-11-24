-- STRIPE PRESTADO (24/11/2026).
--
-- Diego: «ICTESS US e Instituto Naval usarán momentáneamente el Stripe de
-- ICTESS». Un campus puede cobrar con la cuenta de Stripe de OTRO campus de su
-- misma empresa (`sociedad_emisora_id`), sin claves propias:
--
--   · sus links se crean con la clave de links del campus dueño y llevan su
--     propia marca (`crm_project_id` del campus que vende);
--   · el aviso de Stripe llega por la ruta del dueño y, si la marca es de un
--     campus que le toma prestada la cuenta, se procesa como ese campus;
--   · la sincronización de cargos es UNA (la del dueño): cada cargo va a un solo
--     campus, el de su marca si es de uno que la toma prestada, o al dueño.
--
-- Copiar la integración «Stripe» al otro campus NO vale: cada campus con esa
-- integración sincroniza TODOS los cargos de la cuenta y el dinero del dueño
-- saldría dos o tres veces.
--
-- Reglas (las comprueba también el servidor al leerlo; si un día no se
-- cumplen, el préstamo se ignora y el campus sale sin Stripe):
--   · el dueño es otro campus (no uno mismo);
--   · los dos son de la misma empresa;
--   · un solo nivel: el dueño no toma prestada la de nadie, y quien la toma
--     prestada no se la presta a otros.
--
-- Declararlo (lo hace un superadmin al desplegar):
--   UPDATE projects SET stripe_prestado_de = <dueño> WHERE id IN (<campus>);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS stripe_prestado_de INTEGER REFERENCES projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN projects.stripe_prestado_de IS
  'Campus cuya cuenta de Stripe usa este (misma empresa, sin claves propias). NULL = su propia cuenta o ninguna.';

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_stripe_prestado_no_a_si_mismo;
ALTER TABLE projects ADD CONSTRAINT projects_stripe_prestado_no_a_si_mismo
  CHECK (stripe_prestado_de IS NULL OR stripe_prestado_de <> id);

CREATE INDEX IF NOT EXISTS idx_projects_stripe_prestado_de
  ON projects (stripe_prestado_de) WHERE stripe_prestado_de IS NOT NULL;

CREATE OR REPLACE FUNCTION projects_stripe_prestado_valido() RETURNS trigger AS $$
DECLARE
  dueno RECORD;
BEGIN
  IF NEW.stripe_prestado_de IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, sociedad_emisora_id, stripe_prestado_de INTO dueno
    FROM projects WHERE id = NEW.stripe_prestado_de;
  IF NEW.sociedad_emisora_id IS NULL OR dueno.sociedad_emisora_id IS DISTINCT FROM NEW.sociedad_emisora_id THEN
    RAISE EXCEPTION 'Stripe prestado: el campus % y el campus % no son de la misma empresa', NEW.id, NEW.stripe_prestado_de;
  END IF;
  IF dueno.stripe_prestado_de IS NOT NULL THEN
    RAISE EXCEPTION 'Stripe prestado: el campus % ya usa la cuenta de otro; no puede prestarla', NEW.stripe_prestado_de;
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE stripe_prestado_de = NEW.id) THEN
    RAISE EXCEPTION 'Stripe prestado: otros campus usan la cuenta del campus %; no puede tomar prestada otra', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_stripe_prestado ON projects;
CREATE TRIGGER trg_projects_stripe_prestado
  BEFORE INSERT OR UPDATE OF stripe_prestado_de ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_stripe_prestado_valido();
