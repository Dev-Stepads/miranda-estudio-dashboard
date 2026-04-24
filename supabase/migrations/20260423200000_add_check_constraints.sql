-- Defensive CHECK constraints on customers table.
-- state: must be exactly 2 uppercase letters (Brazilian UF codes)
-- age: must be between 0 and 150 (or null)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_customers_state_format'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_state_format
      CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_customers_age_range'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_age_range
      CHECK (age IS NULL OR (age >= 0 AND age <= 150));
  END IF;
END $$;
