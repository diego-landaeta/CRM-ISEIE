-- Default del estado de un lead nuevo cambia de 'nuevo' → 'por_contactar'.
-- El ENUM ya contemplaba ese valor desde 001_initial_schema.
-- Los webhooks no setean status explícito → toman este DEFAULT automáticamente.
ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'por_contactar';
