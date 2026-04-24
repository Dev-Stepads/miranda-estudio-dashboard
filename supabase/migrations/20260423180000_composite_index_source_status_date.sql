-- Composite index for the dominant dashboard query pattern:
-- WHERE source = X AND status = 'paid' AND sale_date >= Y
-- This replaces bitmap-AND of 3 separate indexes with a single scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_source_status_date
  ON public.sales (source, status, sale_date DESC);
