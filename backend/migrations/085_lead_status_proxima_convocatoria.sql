-- 085 — Añade el valor 'proxima_convocatoria' al enum lead_status.
-- Replica de la migration 087 del CRM ISEIH hermano.

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'proxima_convocatoria';
