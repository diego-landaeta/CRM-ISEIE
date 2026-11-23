-- 322 · Links de pago: seguimiento de los que no se pagan (gemela de CRM#984, #659)
--
-- Diego, 21/11/2026 (cómo escalar los links de pago):
--   · si el alumno abre el link y no paga en X horas, se avisa a la gestora;
--   · recordatorio al alumno a las 24 h y a las 72 h, si el link lleva correo;
--   · los caducados se marcan solos (ya lo hace el cron de la 250) y se pueden
--     renovar con un clic;
--   · el estado en la lista de «Links de pago».
--
-- En el link:
--   · `abierto_el`: la primera vez que el alumno llegó a la página de pago. Un
--     Payment Link de Stripe no avisa al abrirse, pero cada visita crea una sesión
--     de Checkout: el seguimiento las mira cada 15 minutos.
--   · `sesiones_revisadas_el`: la última vez que se miraron, para repartir las
--     llamadas a Stripe entre los links vivos.
--   · `aviso_gestora_el`, `recordatorio_24h_el`, `recordatorio_72h_el`: cuándo
--     salió cada aviso. Cada uno sale UNA vez: con la fecha puesta no se repite.
--   · `renovado_de` / `renovado_por`: el link caducado y el nuevo que lo sustituye.
--
-- En el campus (Integraciones › Links de pago):
--   · `links_pago_aviso_abierto_horas`: las X horas (2 de serie, de 1 a 72);
--   · `links_pago_recordatorios`: si se manda el recordatorio al alumno (sí de serie).
--
-- Los avisos solo salen con el seguimiento encendido en el servidor
-- (LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION=1 en producción; en /staging, siempre).
--
-- Se puede pasar dos veces.

BEGIN;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS abierto_el            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sesiones_revisadas_el TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aviso_gestora_el      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recordatorio_24h_el   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recordatorio_72h_el   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renovado_de           INTEGER,
  ADD COLUMN IF NOT EXISTS renovado_por          INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_renovado_de_fk') THEN
    ALTER TABLE payment_links ADD CONSTRAINT payment_links_renovado_de_fk
      FOREIGN KEY (renovado_de) REFERENCES payment_links(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_links_renovado_por_fk') THEN
    ALTER TABLE payment_links ADD CONSTRAINT payment_links_renovado_por_fk
      FOREIGN KEY (renovado_por) REFERENCES payment_links(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Un caducado se renueva una vez: dos clics a la vez no crean dos links.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_renovado_de
    ON payment_links (renovado_de) WHERE renovado_de IS NOT NULL;
-- El seguimiento mira solo los vivos, por fecha de creación.
CREATE INDEX IF NOT EXISTS idx_payment_links_vivos_creados
    ON payment_links (created_at) WHERE estado IN ('creado', 'abierto');

COMMENT ON COLUMN payment_links.abierto_el IS
  'Primera vez que el alumno abrió la página de pago (sesión de Checkout del link) (CRM#984, 322).';
COMMENT ON COLUMN payment_links.aviso_gestora_el IS
  'Cuándo se avisó a quien lo creó de que el alumno lo abrió y no pagó (CRM#984).';
COMMENT ON COLUMN payment_links.recordatorio_24h_el IS 'Cuándo salió el recordatorio de las 24 h al alumno (CRM#984).';
COMMENT ON COLUMN payment_links.recordatorio_72h_el IS 'Cuándo salió el recordatorio de las 72 h al alumno (CRM#984).';
COMMENT ON COLUMN payment_links.renovado_de IS 'El link caducado al que sustituye este (CRM#984).';
COMMENT ON COLUMN payment_links.renovado_por IS 'El link nuevo que sustituye a este caducado (CRM#984).';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS links_pago_aviso_abierto_horas INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS links_pago_recordatorios       BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_links_pago_aviso_abierto_rango') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_links_pago_aviso_abierto_rango
      CHECK (links_pago_aviso_abierto_horas BETWEEN 1 AND 72);
  END IF;
END $$;

COMMENT ON COLUMN projects.links_pago_aviso_abierto_horas IS
  'Horas desde que el alumno abre un link sin pagarlo hasta que se avisa a la gestora (CRM#984).';
COMMENT ON COLUMN projects.links_pago_recordatorios IS
  'Si se manda al alumno el recordatorio de las 24 h y de las 72 h de un link sin pagar (CRM#984).';

COMMIT;
