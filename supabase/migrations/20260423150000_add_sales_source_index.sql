-- Index on sales.source — used in almost every dashboard query
-- (.eq('source', 'nuvemshop'), .eq('source', 'conta_azul'))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_source
  ON public.sales (source);
