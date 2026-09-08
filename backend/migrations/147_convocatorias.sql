-- Las convocatorias, y a quién se le ofrecieron (#86).
--
-- Lo que había estaba en el sitio equivocado: `products.plazas_totales` y
-- `products.fecha_cierre_convocatoria`, como si una convocatoria fuese una
-- propiedad del curso. No lo es. Diego lo dijo claro:
--
--   «Las convocatorias es como un proceso de ventas adicional, como el
--    descuento que aplica y para qué fecha, no un producto.»
--
-- El mismo curso puede tener tres al año, cada una con lo suyo, y en el modelo
-- viejo solo cabía una.
--
-- TRES DECISIONES QUE EXPLICAN LA FORMA DE ESTO:
--
-- 1. LA CONVOCATORIA NO LLEVA DESCUENTO. «Son aleatorias porque el proceso de
--    venta decide cuánto dar»: el porcentaje se decide persona a persona, en la
--    negociación. Lo que aporta la convocatoria no es el número, es la excusa y
--    el reloj. Por eso el descuento vive en el OFRECIMIENTO.
--
-- 2. LAS FECHAS TAMBIÉN VAN EN EL OFRECIMIENTO. «No tienen fecha límite en sí,
--    pero para el cliente sí»: CETLAT está siempre abierta; lo que caduca es la
--    ventana que se le da a ESTA persona. Son dos: hasta cuándo puede pedirla y
--    cuándo se le contesta.
--
-- 3. SI COMPRÓ NO SE GUARDA. Se deduce de sus ventas posteriores al
--    ofrecimiento, igual que en la agenda del proceso. Un dato copiado que hay
--    que mantener a mano acaba contradiciendo al original.

CREATE TABLE IF NOT EXISTS convocatorias (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nombre        VARCHAR(120) NOT NULL,
  descripcion   TEXT,
  -- CETLAT no caduca: se apaga cuando deja de ofrecerse, no cuando pasa una
  -- fecha.
  activa        BOOLEAN NOT NULL DEFAULT true,
  -- Los topes internos SÍ son fijos, y ya estaban escritos en la nota del paso
  -- 4 del proceso: «formación nueva máx. 40 %; formación ya habilitada hasta
  -- 70 %, reservado para quien casi no ha respondido». Aquí dejan de ser algo
  -- que alguien tiene que recordar.
  tope_nueva       SMALLINT NOT NULL DEFAULT 40,
  tope_habilitada  SMALLINT NOT NULL DEFAULT 70,
  -- Interno: no se comparte con el cliente.
  nota_interna  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT convocatorias_unica UNIQUE (project_id, nombre)
);

CREATE TABLE IF NOT EXISTS convocatoria_ofrecimientos (
  id                 SERIAL PRIMARY KEY,
  convocatoria_id    INTEGER NOT NULL REFERENCES convocatorias(id) ON DELETE CASCADE,
  lead_id            INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Quién y cuándo se la ofreció, y por dónde.
  ofrecida_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ofrecida_por       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  canal              VARCHAR(30),
  -- Lo que se le dijo al cliente. Las dos.
  fecha_limite       DATE,
  fecha_resultado    DATE,
  -- «Cuántos llenan la solicitud (poner un aviso: ¿llenó la solicitud?)».
  -- NULL = todavía no se sabe. Distinto de false, que es «no la llenó».
  solicitud_llenada  BOOLEAN,
  solicitud_at       TIMESTAMPTZ,
  -- «Cuánto le dieron de descuento». En por ciento, y lo decide la venta.
  descuento          NUMERIC(5,2),
  resultado          VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  nota               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A la misma persona no se le ofrece dos veces la misma convocatoria. Si hay
  -- que volver a intentarlo, se edita el ofrecimiento que ya está.
  CONSTRAINT ofrecimiento_unico UNIQUE (convocatoria_id, lead_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ofrecimiento_resultado_valido') THEN
    ALTER TABLE convocatoria_ofrecimientos ADD CONSTRAINT ofrecimiento_resultado_valido
      CHECK (resultado IN ('pendiente', 'concedida', 'denegada', 'caducada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ofrecimiento_descuento_valido') THEN
    ALTER TABLE convocatoria_ofrecimientos ADD CONSTRAINT ofrecimiento_descuento_valido
      CHECK (descuento IS NULL OR (descuento >= 0 AND descuento <= 100));
  END IF;
  -- El resultado no puede llegar antes que el límite para pedirla: sería
  -- contestar a quien todavía puede apuntarse.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ofrecimiento_fechas_coherentes') THEN
    ALTER TABLE convocatoria_ofrecimientos ADD CONSTRAINT ofrecimiento_fechas_coherentes
      CHECK (fecha_limite IS NULL OR fecha_resultado IS NULL OR fecha_resultado >= fecha_limite);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'convocatorias_topes_validos') THEN
    ALTER TABLE convocatorias ADD CONSTRAINT convocatorias_topes_validos
      CHECK (tope_nueva BETWEEN 0 AND 100 AND tope_habilitada BETWEEN 0 AND 100);
  END IF;
END $$;

-- El embudo se pide por convocatoria y por fechas.
CREATE INDEX IF NOT EXISTS idx_ofrecimientos_convocatoria
  ON convocatoria_ofrecimientos (convocatoria_id, ofrecida_at);
-- Y la ficha de una persona pregunta por ella.
CREATE INDEX IF NOT EXISTS idx_ofrecimientos_lead
  ON convocatoria_ofrecimientos (lead_id);
-- El aviso del día del resultado busca por esa fecha.
CREATE INDEX IF NOT EXISTS idx_ofrecimientos_resultado
  ON convocatoria_ofrecimientos (fecha_resultado)
  WHERE resultado = 'pendiente';

-- CETLAT, sembrada en cada proyecto. Es la que existe hoy y la que nombra el
-- paso 4 del proceso comercial; los topes vienen de su propia nota.
INSERT INTO convocatorias (project_id, nombre, descripcion, tope_nueva, tope_habilitada, nota_interna)
SELECT p.id, 'Convocatoria CETLAT',
       'Beca CETLAT. Se ofrece en el paso 4 del proceso, como último recurso.',
       40, 70,
       'Interno, no se comparte: formación nueva máx. 40 %; formación ya habilitada hasta 70 %, reservado para quien casi no ha respondido.'
  FROM projects p
 WHERE NOT EXISTS (
   SELECT 1 FROM convocatorias c WHERE c.project_id = p.id AND c.nombre = 'Convocatoria CETLAT'
 );

-- Permisos (#71): las tablas nuevas nacen siendo de `postgres` porque la
-- migración corre como postgres. Se comprueba SIEMPRE con el usuario del CRM.
DO $$
DECLARE
  u TEXT;
  t TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      FOREACH t IN ARRAY ARRAY['convocatorias', 'convocatoria_ofrecimientos'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, u);
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I_id_seq TO %I', t, u);
      END LOOP;
    END IF;
  END LOOP;
END $$;
