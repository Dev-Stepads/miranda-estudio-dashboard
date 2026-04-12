-- ============================================================
-- Fix: deduplicar raw tables e prevenir duplicatas futuras
-- ============================================================
-- As raw tables são append-only por design, mas o ETL estava
-- re-inserindo os mesmos registros a cada run (inclusive
-- incremental). Resultado: raw_nuvemshop_customers cresceu
-- de 4913 pra 39320+ após 8 runs.
--
-- Fix: unique index em source_id + cleanup de duplicatas.
-- ============================================================

-- 1. Cleanup: deletar duplicatas, manter só o mais recente por source_id

DELETE FROM raw_nuvemshop_orders a
USING raw_nuvemshop_orders b
WHERE a.id < b.id AND a.source_id = b.source_id AND a.source_id IS NOT NULL;

DELETE FROM raw_nuvemshop_customers a
USING raw_nuvemshop_customers b
WHERE a.id < b.id AND a.source_id = b.source_id AND a.source_id IS NOT NULL;

DELETE FROM raw_nuvemshop_abandoned_checkouts a
USING raw_nuvemshop_abandoned_checkouts b
WHERE a.id < b.id AND a.source_id = b.source_id AND a.source_id IS NOT NULL;

DELETE FROM raw_contaazul_sales a
USING raw_contaazul_sales b
WHERE a.id < b.id AND a.source_id = b.source_id AND a.source_id IS NOT NULL;

-- 2. Unique indexes pra prevenir duplicatas futuras
-- (partial: só quando source_id IS NOT NULL)

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_ns_orders_source_id
  ON raw_nuvemshop_orders (source_id) WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_ns_customers_source_id
  ON raw_nuvemshop_customers (source_id) WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_ns_abandoned_source_id
  ON raw_nuvemshop_abandoned_checkouts (source_id) WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_ca_sales_source_id
  ON raw_contaazul_sales (source_id) WHERE source_id IS NOT NULL;
