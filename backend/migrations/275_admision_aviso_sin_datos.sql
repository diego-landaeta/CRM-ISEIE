-- ============================================================
-- 275: el aviso de admisión, sin datos (#714)
-- ============================================================
-- Las solicitudes de admisión se guardan solo en el CRM (Matrículas). El correo
-- únicamente avisa de que ha llegado una, con un enlace a su ficha y sin datos
-- personales ni adjuntos. Estas son las direcciones a las que avisa cada webhook
-- (las que hoy reciben el correo de Make o de la web: admisiones@…, info@…).
-- Vacía = no se avisa a nadie.
ALTER TABLE project_webhook_tokens
  ADD COLUMN IF NOT EXISTS aviso_emails TEXT[] NOT NULL DEFAULT '{}';
