-- Migración 056: añadir 'whatsapp' al enum utm_channel

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'whatsapp'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'utm_channel')
  ) THEN
    ALTER TYPE utm_channel ADD VALUE 'whatsapp';
  END IF;
END$$;
