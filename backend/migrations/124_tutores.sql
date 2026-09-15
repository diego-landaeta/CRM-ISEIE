-- Tutores y colaboraciones · las tablas
--
-- El documento pedia cinco tablas; tres de ellas ya existian con otro nombre
-- (conversion_payments, conversions, products), asi que aqui solo van las que
-- de verdad faltan.
--
-- Lo que NO se reutiliza es `commissions`, la de las gestoras: tiene
-- UNIQUE (conversion_id), o sea UNA comision por venta. Aqui hace falta una por
-- CADA PAGO, porque el tutor cobra segun se va cobrando, no de golpe.

BEGIN;

-- ── Datos del tutor ─────────────────────────────────────────────────────────
-- Aparte de `users` porque son datos fiscales y bancarios: no tienen por que
-- estar en la tabla que se lee en cada peticion para comprobar permisos.
CREATE TABLE IF NOT EXISTS tutor_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dni_nif     VARCHAR(32),
  iban        VARCHAR(40),
  telefono    VARCHAR(32),
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Que formaciones lleva cada tutor, desde cuando, y a que porcentaje ──────
-- El porcentaje vive AQUI, no en el tutor: el mismo puede estar al 10% en una
-- formacion y al 50% en otra, tal como pide el documento.
--
-- Y `vigente_desde` es LA FECHA EN QUE ESE TUTOR EMPEZO con esa formacion. No
-- todos entran el mismo dia, asi que no puede haber una sola fecha global: el
-- que se incorpora a mitad de mes cobra desde su dia, no desde el uno.
--
-- Las vigencias sirven ademas para otra cosa: aplicar «el % que regia el dia
-- del cobro» cuando un pago se apunta con retraso. En este CRM eso pasa
-- constantemente —se cobra un dia y se registra tres semanas despues— y sin
-- fechas el tutor cobraria al porcentaje de hoy por trabajo de hace un mes.
CREATE TABLE IF NOT EXISTS tutor_collaborations (
  id             SERIAL PRIMARY KEY,
  tutor_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pct            NUMERIC(5,2) NOT NULL DEFAULT 10.00
                   CHECK (pct >= 0 AND pct <= 100),
  vigente_desde  DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta  DATE,
  activa         BOOLEAN NOT NULL DEFAULT TRUE,
  notas          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_tc_tutor    ON tutor_collaborations (tutor_id, activa);
CREATE INDEX IF NOT EXISTS idx_tc_producto ON tutor_collaborations (product_id, activa);

-- Dos colaboraciones del mismo tutor y formacion no pueden solaparse en el
-- tiempo: si lo hicieran, no habria forma de saber que % aplicar a un pago.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tc_vigente
  ON tutor_collaborations (tutor_id, product_id, vigente_desde);

-- ── La comision, una por cada pago ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_commissions (
  id                SERIAL PRIMARY KEY,
  payment_id        INTEGER NOT NULL REFERENCES conversion_payments(id) ON DELETE CASCADE,
  tutor_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collaboration_id  INTEGER REFERENCES tutor_collaborations(id) ON DELETE SET NULL,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  -- Se guarda aunque hoy sea siempre igual al importe del pago: permite
  -- auditar años despues con que cifra se calculo, sin depender de que el pago
  -- no se haya tocado desde entonces.
  base_calculo      NUMERIC(12,2) NOT NULL,
  pct               NUMERIC(5,2) NOT NULL,
  importe           NUMERIC(12,2) NOT NULL,
  estado            VARCHAR(16) NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente','pagada','revertida')),
  periodo           CHAR(7) NOT NULL,          -- 'YYYY-MM', el mes que se liquida
  fecha_liquidacion DATE,
  liquidada_por     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LA PIEZA IMPORTANTE de todo esto.
--
-- La idempotencia vive en la BASE DE DATOS, no en el codigo: es lo que impide
-- que un reintento de Stripe, una resincronizacion o una doble ejecucion del
-- job dupliquen dinero a pagar. El modulo de facturas aprendio esto por las
-- malas —una factura duplicada salio de un pago repetido— y aqui se evita por
-- construccion.
--
-- La clave es (pago, tutor) y no solo (pago) para que varios tutores puedan
-- cobrar del mismo pago, que es justo lo que pide el documento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tcom_pago_tutor
  ON tutor_commissions (payment_id, tutor_id);

CREATE INDEX IF NOT EXISTS idx_tcom_tutor_periodo ON tutor_commissions (tutor_id, periodo);
CREATE INDEX IF NOT EXISTS idx_tcom_estado        ON tutor_commissions (estado, periodo);

-- ── Ajustes de la instalacion ───────────────────────────────────────────────
-- Una sola fila. `aplica_desde` es el SUELO de todo el modulo: por debajo de esa
-- fecha no se genera comision a nadie, pase lo que pase. Arranca en agosto de
-- 2026, que es cuando se empieza a pagar.
--
-- Es movible a proposito: si mañana se decide incorporar julio, se cambia aqui
-- y el job de reconciliacion rellena solo. Por eso no es una constante en el
-- codigo.
--
-- OJO a como se combina con las fechas de cada tutor. Son DOS cosas distintas:
--
--   aplica_desde                → desde cuando paga la empresa (agosto)
--   colaboracion.vigente_desde  → desde cuando trabaja ESE tutor en ESA
--                                 formacion
--
-- La que manda es la MAS TARDIA de las dos. Un tutor que entro el 20 de agosto
-- no cobra los cobros del 5, aunque la empresa ya pagara comisiones ese dia. Y
-- uno que lleva desde junio tampoco cobra junio, porque el suelo es agosto.
CREATE TABLE IF NOT EXISTS tutor_settings (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  aplica_desde     DATE NOT NULL DEFAULT DATE '2026-08-01',
  pct_por_defecto  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO tutor_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ── Quien puede gestionar colaboraciones ────────────────────────────────────
-- Una casilla, no un rol nuevo. Es el mismo patron que `factura_manager`, que
-- en este repositorio SI funciona; el sistema de roles personalizados ya tiene
-- un caso a medias (project_manager) y no conviene repetirlo.
--
-- Da de alta tutores y edita porcentajes. NO marca liquidaciones: eso mueve
-- dinero y se queda en manos de un administrador.
ALTER TABLE users ADD COLUMN IF NOT EXISTS gestor_colaboraciones BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Quien es el dueño de estas tablas ───────────────────────────────────────
-- Sin esto, una migracion aplicada con `sudo -u postgres` deja las tablas a
-- nombre de postgres y la API —que entra con otro usuario— se estrella con
-- «permission denied for table tutor_profiles». Ya paso con whatsapp_templates.
--
-- El dueño se saca del DUEÑO DE LA BASE, no se escribe a mano: en un CRM es
-- crm_user y en el otro crm_iseie_user, y un nombre fijo romperia uno de los
-- dos. Asi la misma migracion vale para ambos.
DO $$
DECLARE
  duenyo TEXT;
  t      TEXT;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO duenyo
    FROM pg_database WHERE datname = current_database();

  FOREACH t IN ARRAY ARRAY['tutor_profiles','tutor_collaborations','tutor_commissions','tutor_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO %I', t, duenyo);
  END LOOP;

  -- Las secuencias de los SERIAL van aparte: cambiar el dueño de la tabla no
  -- cambia el de su secuencia, y un INSERT necesita las dos.
  FOREACH t IN ARRAY ARRAY['tutor_collaborations_id_seq','tutor_commissions_id_seq']
  LOOP
    EXECUTE format('ALTER SEQUENCE %I OWNER TO %I', t, duenyo);
  END LOOP;
END $$;

COMMIT;
