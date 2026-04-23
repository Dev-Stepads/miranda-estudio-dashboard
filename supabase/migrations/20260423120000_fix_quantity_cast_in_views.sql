-- Fix: views de produtos faziam sum(si.quantity)::int, truncando
-- quantidades fracionarias (ex: 2.04 + 3.2 = 5 em vez de 5.24).
-- Corrigido para ::numeric(12,2) apos T52 ter mudado a coluna
-- para numeric(12,3).
-- DROP necessario porque Postgres nao permite CREATE OR REPLACE
-- quando o tipo da coluna muda (int → numeric).

DROP VIEW IF EXISTS public.v_visao_geral_top_produtos;
DROP VIEW IF EXISTS public.v_loja_fisica_produtos;
DROP VIEW IF EXISTS public.v_nuvemshop_produtos;

CREATE VIEW public.v_visao_geral_top_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::numeric(12,2) AS quantity_total,
  sum(si.total_price)  AS revenue_total,
  coalesce(sum(si.quantity)    FILTER (WHERE s.source = 'conta_azul'), 0)::numeric(12,2) AS quantity_loja_fisica,
  coalesce(sum(si.quantity)    FILTER (WHERE s.source = 'nuvemshop'),  0)::numeric(12,2) AS quantity_nuvemshop,
  coalesce(sum(si.total_price) FILTER (WHERE s.source = 'conta_azul'), 0)     AS revenue_loja_fisica,
  coalesce(sum(si.total_price) FILTER (WHERE s.source = 'nuvemshop'),  0)     AS revenue_nuvemshop
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid'
GROUP BY si.product_name, si.sku, p.product_id;

CREATE OR REPLACE VIEW public.v_loja_fisica_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::numeric(12,2) AS quantity,
  sum(si.total_price)  AS revenue
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid' AND s.source = 'conta_azul'
GROUP BY si.product_name, si.sku, p.product_id;

CREATE OR REPLACE VIEW public.v_nuvemshop_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::numeric(12,2) AS quantity,
  sum(si.total_price)  AS revenue
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid' AND s.source = 'nuvemshop'
GROUP BY si.product_name, si.sku, p.product_id;
