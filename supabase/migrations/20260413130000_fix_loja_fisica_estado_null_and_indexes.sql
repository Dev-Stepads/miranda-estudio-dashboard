-- ============================================================
-- Fix v_loja_fisica_estado NULL state + add performance indexes
-- ============================================================
--
-- 1. v_loja_fisica_estado incluia linhas com state NULL (vendas
--    sem cliente ou cliente sem estado). Isso poluia o mapa.
-- 2. Adiciona indice em sale_items.product_name para performance
--    de GROUP BY nas views de top produtos.
-- ============================================================

-- 1. Fix view: filtrar state NULL
create or replace view public.v_loja_fisica_estado as
select
  c.state,
  count(s.sale_id)::int as orders_count,
  sum(s.gross_revenue) as revenue
from public.sales s
left join public.customers c on c.customer_id = s.customer_id
where s.status = 'paid' and s.source = 'conta_azul'
  and c.state is not null
group by c.state;

-- 2. Performance index for product name grouping
create index if not exists idx_sale_items_product_name
  on public.sale_items (product_name);
