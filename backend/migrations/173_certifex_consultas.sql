-- Las consultas que llegan desde la web de Certifex: el apartado «Certifex» del CRM.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- En Certifex, «quiero inscribir mi campus» llevaba a un formulario que abría el
-- programa de correo del visitante hacia una dirección que en producción estaba
-- vacía: no llegaba nada a nadie. Ángel: que llegue «a un apartado en el CRM y
-- también en el apartado de soporte en Certifex».
--
-- Certifex guarda cada consulta y la reenvía aquí desde su servidor, con un secreto
-- compartido (CERTIFEX_WEBHOOK_SECRETO). Si este CRM no contesta, Certifex reintenta.
--
-- POR QUÉ UNA TABLA PROPIA Y NO UN LEAD
--
-- Un lead vive dentro de un proyecto —una marca— y entra al reparto entre gestoras,
-- que le manda un correo a la que le toca. Esto no es de ninguna marca: es un centro
-- que quiere usar Certifex, o alguien con una duda sobre un título. Mezclarlo con los
-- prospectos de Psiko o de ISEIH lo escondería, y el reparto mandaría correos que
-- nadie pidió. Aquí se ve aparte y el aviso va por la campana.
--
-- LO QUE EVITA LOS DUPLICADOS
--
-- `certifex_id` es el id de la consulta en Certifex. Un reintento de Certifex tras un
-- corte trae el mismo, y se ignora: la consulta no aparece dos veces.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certifex_consultas (
  id              SERIAL PRIMARY KEY,
  certifex_id     BIGINT NOT NULL UNIQUE,
  tipo            TEXT   NOT NULL CHECK (tipo IN ('centro', 'consulta')),
  nombre          TEXT   NOT NULL,
  email           TEXT   NOT NULL,
  telefono        TEXT,
  organizacion    TEXT,
  url_campus      TEXT,
  mensaje         TEXT   NOT NULL,
  idioma          TEXT,
  estado          TEXT   NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva', 'en_curso', 'resuelta', 'spam')),
  nota_interna    TEXT,
  atendida_por    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recibida_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  creada_en_certifex TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_certifex_consultas_estado ON certifex_consultas (estado, recibida_en DESC);
