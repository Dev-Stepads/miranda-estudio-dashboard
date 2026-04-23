-- Indexes faltantes detectados na auditoria 2026-04-23.
--
-- 1. sales.source_sale_id — 6 queries filtram NOT LIKE 'nstag-%'
--    sem indice, causando scan sequencial.
-- 2. customers.state — geography queries agrupam/filtram por state
--    sem indice.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_source_sale_id
  ON public.sales (source_sale_id text_pattern_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_state
  ON public.customers (state) WHERE state IS NOT NULL;
