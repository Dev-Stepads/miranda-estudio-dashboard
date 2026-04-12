-- ============================================================
-- Fix: Views de ranking de produtos agrupam por product_name
-- ============================================================
-- PROBLEMA (descoberto em 2026-04-12 após ETL real):
-- As views originais agrupavam por products.product_id /
-- products.canonical_name via LEFT JOIN. Mas 97% dos
-- sale_items têm product_id = NULL porque a Miranda não
-- preenche SKU no catálogo da Nuvemshop (pendência P3).
-- Resultado: todos os items caíam num único grupo "null".
--
-- FIX: agrupar por sale_items.product_name (sempre presente
-- no pedido) + sale_items.sku (quando disponível). O LEFT JOIN
-- em products é mantido pra quando o product_id existir, mas
-- não é mais a chave de agrupamento.
--
-- ⚠ CREATE OR REPLACE VIEW — não-destrutivo, substitui a
-- definição anterior preservando grants/policies existentes.
-- ============================================================

-- 1. Visão Geral — top produtos consolidado
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
  'Ranking de produtos consolidado entre fontes, agrupado por product_name + sku. Ordenar por revenue_total desc no frontend.';

-- 2. Loja Física — top produtos
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

-- 3. Nuvemshop — top produtos
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

-- ============================================================
-- Validação (rodar depois de aplicar):
-- ============================================================
-- SELECT product_name, quantity, revenue
-- FROM v_nuvemshop_produtos
-- WHERE product_name IS NOT NULL
-- ORDER BY revenue DESC
-- LIMIT 20;
--
-- Esperado: ~centenas de produtos distintos da Miranda com
-- revenue > 0, não mais aquele único row com product_name=null.
-- ============================================================
