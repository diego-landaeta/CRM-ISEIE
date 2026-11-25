-- ============================================================
-- 344: Apostilla de La Haya (CRM-ISEIE#786, gemela de CRM#1130)
-- ============================================================
-- Un apartado interno para llevar el trámite de cada apostilla que se vende:
-- en qué paso está, quién la lleva, sus documentos y su historial. Decisiones
-- de Diego (25/11/2026):
--
--   1. Un producto «Apostilla de La Haya» en el catálogo de cada campus activo,
--      a 300 €. El precio se puede cambiar al venderla (el formulario de venta ya
--      lo deja). Sin descuento. Es un SERVICIO, no una formación: sin módulos, y
--      fuera de las cifras de Formaciones y Alumnos y de la matrícula en Moodle.
--   2. La ven todos los que entran al CRM (no tutores, colaboradores ni
--      redactoras); la gestionan admin y la gestora de esa venta.
--   3. Estados de la tarea y aviso en la campana si lleva 7 días (configurable
--      por campus) en el mismo estado. NUNCA un correo al alumno.
--
--   products.servicio              'apostilla' en el producto de la apostilla;
--                                  NULL en las formaciones (lo de siempre).
--   stripe_links_externos.servicio 'apostilla' en un link creado directamente
--                                  en Stripe para cobrarla: su cobro abre una
--                                  venta de apostilla y no se cuelga de otra.
--   apostillas                     una por apostilla vendida.
--   apostilla_eventos              el historial: quién hizo qué y cuándo.
--   apostilla_documentos           diploma, apostilla escaneada, justificante…
--                                  (en el almacenamiento del CRM, nunca por correo).
--   apostillas_ajustes             a los cuántos días avisa, por campus.
--
-- Importe, fecha, forma de pago y «pagada» NO se copian en `apostillas`: se
-- leen de la venta o del cargo de Stripe, para que nunca se descuadren.
--
-- Estado y tipos son VARCHAR con CHECK, no ENUM: listas cortas que pueden
-- crecer sin `ALTER TYPE` (que no va dentro de una transacción).
--
-- Se puede pasar dos veces (IF NOT EXISTS / WHERE NOT EXISTS). Mismo contenido
-- en los dos CRMs (aquí 344; en el 360, 333).

BEGIN;

-- ── El producto ──────────────────────────────────────────────────────────────

ALTER TABLE products ADD COLUMN IF NOT EXISTS servicio VARCHAR(20);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_servicio_check;
ALTER TABLE products ADD CONSTRAINT products_servicio_check
  CHECK (servicio IS NULL OR servicio IN ('apostilla'));
COMMENT ON COLUMN products.servicio IS
  'Servicio que no es una formación (CRM#1130): ''apostilla''. NULL = formación. Fuera de Formaciones, Alumnos y Moodle.';
CREATE INDEX IF NOT EXISTS idx_products_servicio
  ON products (project_id, servicio) WHERE servicio IS NOT NULL;

-- Si un campus ya tenía un producto activo con ese nombre, se marca ese y no se
-- crea otro (el índice único por campus y nombre lo impediría).
UPDATE products p
   SET servicio = 'apostilla', updated_at = NOW()
 WHERE p.servicio IS NULL AND p.active
   AND LOWER(TRIM(p.nombre)) = 'apostilla de la haya'
   AND NOT EXISTS (SELECT 1 FROM products x WHERE x.project_id = p.project_id AND x.servicio = 'apostilla');

INSERT INTO products (project_id, nombre, descripcion, precio, moneda, servicio, active)
SELECT pr.id, 'Apostilla de La Haya',
       'Trámite de la Apostilla de La Haya del título. Es un servicio, no una formación: no lleva módulos ni cuenta en Formaciones ni en Alumnos. El precio se puede cambiar al venderla.',
       300.00, 'EUR', 'apostilla', true
  FROM projects pr
 WHERE pr.active
   AND COALESCE(pr.type::text, 'crm') <> 'ia'
   AND NOT EXISTS (SELECT 1 FROM products x WHERE x.project_id = pr.id AND x.servicio = 'apostilla')
   AND NOT EXISTS (SELECT 1 FROM products x WHERE x.project_id = pr.id AND x.active
                     AND LOWER(TRIM(x.nombre)) = 'apostilla de la haya');

-- ── Los links creados directamente en Stripe ─────────────────────────────────

ALTER TABLE stripe_links_externos ADD COLUMN IF NOT EXISTS servicio VARCHAR(20);
ALTER TABLE stripe_links_externos DROP CONSTRAINT IF EXISTS stripe_links_externos_servicio_check;
ALTER TABLE stripe_links_externos ADD CONSTRAINT stripe_links_externos_servicio_check
  CHECK (servicio IS NULL OR servicio IN ('apostilla'));
COMMENT ON COLUMN stripe_links_externos.servicio IS
  '''apostilla'' si el link cobra la Apostilla de La Haya (CRM#1130): su cobro abre una venta de apostilla.';
-- Los que ya hay con ese nombre (en ISEIE, «Plan de pago - Apostilla HAYA»).
UPDATE stripe_links_externos SET servicio = 'apostilla'
 WHERE servicio IS NULL AND nombre ~* 'apostill';

-- ── Las apostillas ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS apostillas (
  id                  SERIAL       PRIMARY KEY,
  project_id          INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- NULL = «Sin asociar»: el cobro llegó y no se sabe de quién es.
  lead_id             INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
  conversion_id       INTEGER      REFERENCES conversions(id) ON DELETE SET NULL,
  conversion_item_id  INTEGER      REFERENCES conversion_items(id) ON DELETE SET NULL,
  stripe_payment_id   INTEGER      REFERENCES stripe_payments(id) ON DELETE SET NULL,
  origen              VARCHAR(10)  NOT NULL DEFAULT 'venta',
  estado              VARCHAR(30)  NOT NULL DEFAULT 'pendiente_inicio',
  estado_desde        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  responsable_id      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  -- El título que se apostilla (texto libre: puede ser de antes del CRM).
  formacion           TEXT,
  direccion_envio     TEXT,
  numero_seguimiento  VARCHAR(120),
  notas               TEXT,
  -- El último aviso de «atascada» que salió (uno por cada N días en el estado).
  aviso_atasco_at     TIMESTAMPTZ,
  creada_por          INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT apostillas_origen_check CHECK (origen IN ('venta', 'stripe', 'manual')),
  CONSTRAINT apostillas_estado_check CHECK (estado IN (
    'pendiente_inicio', 'pendiente_documentacion', 'en_tramite',
    'apostillada', 'enviada', 'entregada', 'cancelada'))
);

-- El mismo cobro no crea dos fichas: una por línea de venta, una por cargo de
-- Stripe y una por venta sin línea (las ventas a mano antiguas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_apostillas_linea
  ON apostillas (conversion_item_id) WHERE conversion_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_apostillas_cargo
  ON apostillas (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_apostillas_venta_sin_linea
  ON apostillas (conversion_id) WHERE conversion_id IS NOT NULL AND conversion_item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_apostillas_campus_estado ON apostillas (project_id, estado, estado_desde);
CREATE INDEX IF NOT EXISTS idx_apostillas_lead ON apostillas (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_apostillas_venta ON apostillas (conversion_id) WHERE conversion_id IS NOT NULL;

COMMENT ON TABLE apostillas IS
  'Apostilla de La Haya (CRM#1130): una por apostilla vendida. Importe y «pagada» se leen de la venta o del cargo, no se copian.';

CREATE TABLE IF NOT EXISTS apostilla_eventos (
  id            SERIAL       PRIMARY KEY,
  apostilla_id  INTEGER      NOT NULL REFERENCES apostillas(id) ON DELETE CASCADE,
  tipo          VARCHAR(20)  NOT NULL,
  de            TEXT,
  a             TEXT,
  nota          TEXT,
  user_id       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT apostilla_eventos_tipo_check CHECK (tipo IN (
    'creada', 'estado', 'responsable', 'nota', 'documento', 'envio', 'enlazada', 'datos'))
);
CREATE INDEX IF NOT EXISTS idx_apostilla_eventos ON apostilla_eventos (apostilla_id, created_at DESC);

CREATE TABLE IF NOT EXISTS apostilla_documentos (
  id            SERIAL        PRIMARY KEY,
  apostilla_id  INTEGER       NOT NULL REFERENCES apostillas(id) ON DELETE CASCADE,
  tipo          VARCHAR(20)   NOT NULL DEFAULT 'otro',
  nombre        VARCHAR(255)  NOT NULL,
  clave         VARCHAR(500)  NOT NULL,
  mime          VARCHAR(120),
  bytes         INTEGER,
  subido_por    INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT apostilla_documentos_tipo_check CHECK (tipo IN ('diploma', 'apostilla', 'justificante_envio', 'otro'))
);
CREATE INDEX IF NOT EXISTS idx_apostilla_documentos ON apostilla_documentos (apostilla_id);

CREATE TABLE IF NOT EXISTS apostillas_ajustes (
  project_id   INTEGER      PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  dias_aviso   SMALLINT     NOT NULL DEFAULT 7,
  updated_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT apostillas_ajustes_dias_check CHECK (dias_aviso BETWEEN 1 AND 90)
);
COMMENT ON TABLE apostillas_ajustes IS
  'A los cuántos días en el mismo estado avisa una apostilla atascada (CRM#1130). Sin fila = 7.';

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['apostillas', 'apostilla_eventos', 'apostilla_documentos', 'apostillas_ajustes'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END LOOP;
      FOREACH t IN ARRAY ARRAY['apostillas_id_seq', 'apostilla_eventos_id_seq', 'apostilla_documentos_id_seq'] LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
