-- Fix: views castavam sum(quantity) para numeric(12,2) mas a coluna
-- eh numeric(12,3). Preservar as 3 casas decimais na agregacao para
-- nao perder precisao em quantidades fracionarias (kg/L).

DROP VIEW IF EXISTS public.v_visao_geral_top_produtos;
DROP VIEW IF EXISTS public.v_loja_fisica_produtos;
DROP VIEW IF EXISTS public.v_nuvemshop_produtos;

CREATE VIEW public.v_visao_geral_top_produtos AS
SELECT
  si.product_name,
  si.sku,
  p.product_id,
  sum(si.quantity)::numeric(12,3) AS quantity_total,
  sum(si.total_price)  AS revenue_total,
  coalesce(sum(si.quantity)    FILTER (WHERE s.source = 'conta_azul'), 0)::numeric(12,3) AS quantity_loja_fisica,
  coalesce(sum(si.quantity)    FILTER (WHERE s.source = 'nuvemshop'),  0)::numeric(12,3) AS quantity_nuvemshop,
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
  sum(si.quantity)::numeric(12,3) AS quantity,
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
  sum(si.quantity)::numeric(12,3) AS quantity,
  sum(si.total_price)  AS revenue
FROM public.sale_items si
JOIN public.sales s ON s.sale_id = si.sale_id
LEFT JOIN public.products p ON p.product_id = si.product_id
WHERE s.status = 'paid' AND s.source = 'nuvemshop'
GROUP BY si.product_name, si.sku, p.product_id;
