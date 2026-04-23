-- T52: Migrar sale_items.quantity de INT para NUMERIC(12,3)
-- Motivo: Conta Azul permite quantidades fracionarias (kg, L, m).
-- 4 items falharam durante sync historico (2.04, 2.7, 3.2, 7.02).
--
-- Postgres nao permite ALTER TYPE em coluna usada por view.
-- Solucao: DROP views → ALTER → RECREATE views identicas.
-- As views usam sum(si.quantity)::int — semantica preservada.

BEGIN;

-- ============================================================
-- 1. DROP das 3 views que referenciam sale_items.quantity
-- ============================================================
DROP VIEW IF EXISTS public.v_visao_geral_top_produtos;
DROP VIEW IF EXISTS public.v_loja_fisica_produtos;
DROP VIEW IF EXISTS public.v_nuvemshop_produtos;

-- ============================================================
-- 2. ALTER coluna quantity: INT → NUMERIC(12,3)
-- ============================================================
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_quantity_check;
ALTER TABLE public.sale_items ALTER COLUMN quantity TYPE numeric(12,3);
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_quantity_check CHECK (quantity > 0);

-- ============================================================
-- 3. RECREATE views (identicas a 20260412120000)
-- ============================================================

-- 3a. Visao Geral — top produtos consolidado
CREATE OR REPLACE VIEW public.v_visao_geral_top_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::int AS quantity_total,
  sum(si.total_price)  AS revenue_total,
  coalesce(sum(si.quantity)    FILTER (WHERE s.source = 'conta_azul'), 0)::int AS quantity_loja_fisica,
  coalesce(sum(si.quantity)    FILTER (WHERE s.source = 'nuvemshop'),  0)::int AS quantity_nuvemshop,
  coalesce(sum(si.total_price) FILTER (WHERE s.source = 'conta_azul'), 0)     AS revenue_loja_fisica,
  coalesce(sum(si.total_price) FILTER (WHERE s.source = 'nuvemshop'),  0)     AS revenue_nuvemshop
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid'
GROUP BY si.product_name, si.sku, p.product_id;

COMMENT ON VIEW public.v_visao_geral_top_produtos IS
  'Ranking de produtos consolidado entre fontes, agrupado por product_name + sku.';

-- 3b. Loja Fisica — top produtos
CREATE OR REPLACE VIEW public.v_loja_fisica_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::int AS quantity,
  sum(si.total_price)  AS revenue
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid' AND s.source = 'conta_azul'
GROUP BY si.product_name, si.sku, p.product_id;

-- 3c. Nuvemshop — top produtos
CREATE OR REPLACE VIEW public.v_nuvemshop_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::int AS quantity,
  sum(si.total_price)  AS revenue
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid' AND s.source = 'nuvemshop'
GROUP BY si.product_name, si.sku, p.product_id;

COMMIT;
