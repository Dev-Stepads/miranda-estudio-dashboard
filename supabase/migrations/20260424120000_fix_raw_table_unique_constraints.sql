-- ============================================================
-- Fix: converter unique indexes parciais em constraints reais
-- ============================================================
-- As raw tables tinham unique indexes com WHERE source_id IS NOT NULL.
-- PostgREST (Supabase JS) nao reconhece indexes parciais para
-- ON CONFLICT — exige UNIQUE CONSTRAINT real. Isso fazia os
-- upserts de raw payload falharem com:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
-- Antes do T56 o erro era silencioso. Depois do T56, o ETL
-- passou a contar como erro e sair com exit code 1, quebrando
-- o cron do GitHub Actions desde 2026-04-23 16:54.
--
-- Fix: dropar os indexes parciais, setar source_id NOT NULL
-- DEFAULT '', e criar UNIQUE CONSTRAINTS reais.
-- ============================================================

-- 1. raw_nuvemshop_orders
UPDATE raw_nuvemshop_orders SET source_id = '' WHERE source_id IS NULL;
ALTER TABLE raw_nuvemshop_orders ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE raw_nuvemshop_orders ALTER COLUMN source_id SET DEFAULT '';
DROP INDEX IF EXISTS uq_raw_ns_orders_source_id;
DROP INDEX IF EXISTS idx_raw_ns_orders_source_id;
ALTER TABLE raw_nuvemshop_orders ADD CONSTRAINT uq_raw_ns_orders_source_id UNIQUE (source_id);

-- 2. raw_nuvemshop_customers
UPDATE raw_nuvemshop_customers SET source_id = '' WHERE source_id IS NULL;
ALTER TABLE raw_nuvemshop_customers ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE raw_nuvemshop_customers ALTER COLUMN source_id SET DEFAULT '';
DROP INDEX IF EXISTS uq_raw_ns_customers_source_id;
DROP INDEX IF EXISTS idx_raw_ns_customers_source_id;
ALTER TABLE raw_nuvemshop_customers ADD CONSTRAINT uq_raw_ns_customers_source_id UNIQUE (source_id);

-- 3. raw_nuvemshop_abandoned_checkouts
UPDATE raw_nuvemshop_abandoned_checkouts SET source_id = '' WHERE source_id IS NULL;
ALTER TABLE raw_nuvemshop_abandoned_checkouts ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE raw_nuvemshop_abandoned_checkouts ALTER COLUMN source_id SET DEFAULT '';
DROP INDEX IF EXISTS uq_raw_ns_abandoned_source_id;
DROP INDEX IF EXISTS idx_raw_ns_abandoned_source_id;
ALTER TABLE raw_nuvemshop_abandoned_checkouts ADD CONSTRAINT uq_raw_ns_abandoned_source_id UNIQUE (source_id);
