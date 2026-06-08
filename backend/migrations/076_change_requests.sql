-- Módulo RFC (Request For Change): solicitud de cambio + aprobaciones CCB + adjuntos.
-- Flujo: usuario crea → PM analiza → CCB (CEO/PM/DEV) aprueba con firma digital.

-- 1) Nuevo rol project_manager. Acceso total como admin, pero categoría propia
-- para distinguir en RFCs (PM es quien analiza y firma como rol PM).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'project_manager';

-- 2) Solicitudes de cambio.
CREATE TABLE IF NOT EXISTS change_requests (
  id                      SERIAL PRIMARY KEY,
  project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  codigo_rfc              VARCHAR(20) NOT NULL,                   -- ej. "RFC-001"
  titulo                  VARCHAR(300) NOT NULL,
  solicitante_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  fecha_solicitud         DATE NOT NULL DEFAULT CURRENT_DATE,
  estado                  VARCHAR(30) NOT NULL DEFAULT 'propuesto',
  -- propuesto | en_analisis | aprobado | rechazado | diferido | enviado_ceo

  modifica_alcance        BOOLEAN NOT NULL DEFAULT FALSE,
  modifica_cronograma     BOOLEAN NOT NULL DEFAULT FALSE,
  modifica_costos         BOOLEAN NOT NULL DEFAULT FALSE,
  modifica_riesgos        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Parte que llena el solicitante
  descripcion_resumida    TEXT,
  objetivo_intencion      TEXT,
  motivo_negocio          TEXT,
  beneficios_kpi          TEXT,
  beneficios_comercial    TEXT,
  beneficios_operacion    TEXT,

  -- Parte que llena el desarrollador / PM
  opciones_consideradas   JSONB DEFAULT '[]'::jsonb,
  -- ej: [{opcion:"A", descripcion:"...", alcance:"...", costo:"...", tiempo:"...", riesgos:"...", comentarios:"..."}]
  impacto_alcance         TEXT,
  impacto_tiempo          TEXT,
  impacto_costo           TEXT,
  impacto_riesgos         TEXT,
  recomendacion_decision  VARCHAR(20),                            -- aprobar | rechazar | diferir
  recomendacion_justif    TEXT,
  plan_alcance            TEXT,
  plan_hitos              TEXT,
  plan_responsables       TEXT,

  -- Línea base de versiones (admin lo gestiona)
  baseline_alcance        VARCHAR(20),                            -- ej "S-1.0"
  baseline_cronograma     VARCHAR(20),                            -- ej "T-1.0"
  baseline_costos         VARCHAR(20),                            -- ej "C-1.0"

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, codigo_rfc)
);

CREATE INDEX IF NOT EXISTS idx_rfc_project ON change_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_rfc_solicitante ON change_requests(solicitante_user_id);
CREATE INDEX IF NOT EXISTS idx_rfc_estado ON change_requests(estado);

-- 3) Aprobaciones CCB (Change Control Board). Una fila por rol que firma.
CREATE TABLE IF NOT EXISTS change_request_approvals (
  id                      SERIAL PRIMARY KEY,
  change_request_id       INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  rol                     VARCHAR(20) NOT NULL,                   -- ceo | pm | dev
  user_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision                VARCHAR(20),                            -- a_favor | en_contra | diferir
  firma_data              TEXT,                                   -- base64 del canvas firma
  firma_at                TIMESTAMPTZ,
  comentarios             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (change_request_id, rol)
);

CREATE INDEX IF NOT EXISTS idx_approvals_rfc ON change_request_approvals(change_request_id);

-- 4) Adjuntos (fotos, documentos).
CREATE TABLE IF NOT EXISTS change_request_attachments (
  id                      SERIAL PRIMARY KEY,
  change_request_id       INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  file_path               TEXT NOT NULL,                          -- ruta en uploads/rfc/
  file_name               VARCHAR(255) NOT NULL,
  mime_type               VARCHAR(100),
  size_bytes              BIGINT,
  uploaded_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfc_attachments ON change_request_attachments(change_request_id);
