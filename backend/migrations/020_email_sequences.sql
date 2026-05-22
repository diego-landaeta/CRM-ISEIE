-- ============================================================
-- 020: Secuencias de email seguimiento (CRM-185)
-- ============================================================

CREATE TABLE IF NOT EXISTS email_sequences (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  trigger_event VARCHAR(50) NOT NULL,  -- lead_created, status_changed, conversion_created, manual
  trigger_filter JSONB DEFAULT '{}'::jsonb,  -- {status_to: 'contactado'} etc
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{delay_hours, brevo_template_id, subject?, body?}]
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seq_project ON email_sequences(project_id);
CREATE INDEX IF NOT EXISTS idx_seq_active ON email_sequences(active) WHERE active;

CREATE TABLE IF NOT EXISTS email_sequence_runs (
  id SERIAL PRIMARY KEY,
  sequence_id INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 0,
  next_send_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, completed, stopped, failed
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seqrun_pending ON email_sequence_runs(next_send_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_seqrun_lead ON email_sequence_runs(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_seqrun_lead_seq ON email_sequence_runs(lead_id, sequence_id);
