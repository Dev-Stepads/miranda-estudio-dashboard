-- ============================================================
-- Miranda Studio Dashboard — Dashboard Views
-- ============================================================
-- Views SQL que alimentam as 4 abas do dashboard:
--   1. Visão Geral (Loja Física + Nuvemshop consolidados)
--   2. Loja Física (Conta Azul)
--   3. Nuvemshop (e-commerce)
--   4. Meta Ads (tráfego pago)
--
-- CONVENÇÕES (ver DECISOES.txt 2026-04-11 — Views do dashboard):
--
--   * GRANULARIDADE: views retornam dados AGREGADOS POR DIA ou
--     por entidade (produto, estado, gênero). Single-row KPIs
--     (revenue total, ticket médio, ROAS total) são calculados
--     no FRONTEND a partir desses agregados, usando WHERE clauses
--     pro período escolhido.
--
--   * TIMEZONE: conversão America/Sao_Paulo acontece aqui via
--     `(sale_date at time zone 'America/Sao_Paulo')::date`.
--     O frontend consome o campo `day` como date puro.
--
--   * FILTRO DE REVENUE: apenas vendas com status='paid' entram
--     nas agregações de faturamento. 'cancelled', 'refunded' e
--     'pending' ficam de fora. Na canônica, 'paid' já inclui
--     partially_paid da Nuvemshop (ver REGRAS §2.2).
--
--   * VISÃO GERAL = Loja Física + Nuvemshop. Meta Ads NÃO entra
--     no faturamento (é atribuição, não venda — ver DECISOES
--     2026-04-10 "Escopo da Visão Geral").
--
--   * SEGURANÇA: views usam o padrão PG de security_invoker=false
--     (default em PG <= 15) ou seja, rodam com perm do criador.
--     Tabelas base têm RLS enabled sem policies; views herdam
--     bypass quando acessadas via service_role. Quando o frontend
--     começar a consumir via anon/authenticated, avaliar se dá pra
--     expor diretamente (dados agregados ≠ PII) ou se precisa de
--     policies explícitas.
-- ============================================================

-- ============================================================
-- 1. VISÃO GERAL — consolidação Loja Física + Nuvemshop
-- ============================================================

-- v_visao_geral_daily
-- Faturamento diário por fonte. Frontend soma e calcula share.
create or replace view public.v_visao_geral_daily as
select
  (s.sale_date at time zone 'America/Sao_Paulo')::date as day,
  s.source,
  count(*)::int as orders_count,
  sum(s.gross_revenue) as gross_revenue
from public.sales s
where s.status = 'paid'
group by day, s.source;

comment on view public.v_visao_geral_daily is
  'Faturamento diário por fonte (conta_azul, nuvemshop). Base da aba Visão Geral. Frontend agrega por período.';

-- v_visao_geral_top_produtos
-- Ranking consolidado. Uma linha por produto canônico, separado por canal.
-- Items sem product_id ficam agrupados sob NULL — catch-all pra casos
-- onde o ETL ainda não resolveu a consolidação por SKU/nome.
-- COALESCE nas agregações filter() pra retornar 0 em vez de NULL quando
-- o produto só vende num canal. Simplifica o frontend (sem precisar de
-- ??/?? nos valores antes de somar).
create or replace view public.v_visao_geral_top_produtos as
select
  p.product_id,
  p.canonical_name,
  p.sku,
  sum(si.quantity)::int as quantity_total,
  sum(si.total_price) as revenue_total,
  coalesce(sum(si.quantity) filter (where s.source = 'conta_azul'), 0)::int as quantity_loja_fisica,
  coalesce(sum(si.quantity) filter (where s.source = 'nuvemshop'),  0)::int as quantity_nuvemshop,
  coalesce(sum(si.total_price) filter (where s.source = 'conta_azul'), 0) as revenue_loja_fisica,
  coalesce(sum(si.total_price) filter (where s.source = 'nuvemshop'),  0) as revenue_nuvemshop
from public.sale_items si
join public.sales s on s.sale_id = si.sale_id
left join public.products p on p.product_id = si.product_id
where s.status = 'paid'
group by p.product_id, p.canonical_name, p.sku;

comment on view public.v_visao_geral_top_produtos is
  'Ranking de produtos consolidado entre fontes, com quebra por canal. Ordenar por revenue_total desc no frontend.';

-- ============================================================
-- 2. LOJA FÍSICA — Conta Azul
-- ============================================================

-- v_loja_fisica_daily
create or replace view public.v_loja_fisica_daily as
select
  (s.sale_date at time zone 'America/Sao_Paulo')::date as day,
  count(*)::int as orders_count,
  sum(s.gross_revenue) as gross_revenue,
  round(avg(s.gross_revenue), 2) as avg_ticket
from public.sales s
where s.status = 'paid' and s.source = 'conta_azul'
group by day;

-- v_loja_fisica_produtos
create or replace view public.v_loja_fisica_produtos as
select
  p.product_id,
  p.canonical_name,
  p.sku,
  sum(si.quantity)::int as quantity,
  sum(si.total_price) as revenue
from public.sale_items si
join public.sales s on s.sale_id = si.sale_id
left join public.products p on p.product_id = si.product_id
where s.status = 'paid' and s.source = 'conta_azul'
group by p.product_id, p.canonical_name, p.sku;

-- v_loja_fisica_estado
-- Demografia por gênero/idade NÃO existe (Conta Azul não coleta).
-- Ver DECISOES 2026-04-10 — gap #1 e #2.
create or replace view public.v_loja_fisica_estado as
select
  c.state,
  count(s.sale_id)::int as orders_count,
  sum(s.gross_revenue) as revenue
from public.sales s
left join public.customers c on c.customer_id = s.customer_id
where s.status = 'paid' and s.source = 'conta_azul'
group by c.state;

-- ============================================================
-- 3. NUVEMSHOP — e-commerce
-- ============================================================

-- v_nuvemshop_daily
create or replace view public.v_nuvemshop_daily as
select
  (s.sale_date at time zone 'America/Sao_Paulo')::date as day,
  count(*)::int as orders_count,
  sum(s.gross_revenue) as gross_revenue,
  round(avg(s.gross_revenue), 2) as avg_ticket
from public.sales s
where s.status = 'paid' and s.source = 'nuvemshop'
group by day;

-- v_nuvemshop_produtos
create or replace view public.v_nuvemshop_produtos as
select
  p.product_id,
  p.canonical_name,
  p.sku,
  sum(si.quantity)::int as quantity,
  sum(si.total_price) as revenue
from public.sale_items si
join public.sales s on s.sale_id = si.sale_id
left join public.products p on p.product_id = si.product_id
where s.status = 'paid' and s.source = 'nuvemshop'
group by p.product_id, p.canonical_name, p.sku;

-- v_nuvemshop_geografia
create or replace view public.v_nuvemshop_geografia as
select
  c.state,
  c.city,
  count(s.sale_id)::int as orders_count,
  sum(s.gross_revenue) as revenue
from public.sales s
join public.customers c on c.customer_id = s.customer_id
where s.status = 'paid' and s.source = 'nuvemshop'
group by c.state, c.city;

-- v_nuvemshop_genero
create or replace view public.v_nuvemshop_genero as
select
  c.gender,
  count(s.sale_id)::int as orders_count,
  sum(s.gross_revenue) as revenue
from public.sales s
join public.customers c on c.customer_id = s.customer_id
where s.status = 'paid' and s.source = 'nuvemshop'
group by c.gender;

-- v_nuvemshop_idade
-- Ordem natural de faixas etárias pelo age_range.
create or replace view public.v_nuvemshop_idade as
select
  c.age_range,
  count(s.sale_id)::int as orders_count,
  sum(s.gross_revenue) as revenue
from public.sales s
join public.customers c on c.customer_id = s.customer_id
where s.status = 'paid' and s.source = 'nuvemshop'
group by c.age_range;

-- v_nuvemshop_abandonados
create or replace view public.v_nuvemshop_abandonados as
select
  (created_at at time zone 'America/Sao_Paulo')::date as day,
  count(*)::int as abandoned_count,
  sum(total_amount) as total_amount
from public.abandoned_checkouts
group by day;

-- ============================================================
-- 4. META ADS — tráfego pago
-- ============================================================

-- v_meta_campanha_daily
-- Métricas diárias por campanha + KPIs derivados (CTR, CPC, CPM, ROAS).
-- Apenas level='campaign' pra evitar double-counting (adset/ad
-- somariam em cima do total da campanha).
create or replace view public.v_meta_campanha_daily as
select
  date,
  campaign_id,
  campaign_name,
  spend,
  impressions,
  reach,
  clicks,
  purchases,
  purchase_value,
  case when impressions > 0 then round((clicks::numeric / impressions) * 100, 4) else 0 end as ctr_pct,
  case when clicks > 0      then round(spend / clicks, 2) else 0 end as cpc,
  case when impressions > 0 then round((spend / impressions) * 1000, 2) else 0 end as cpm,
  case when spend > 0       then round(purchase_value / spend, 4) else 0 end as roas
from public.meta_ads_insights
where level = 'campaign';

comment on view public.v_meta_campanha_daily is
  'Insights diários por campanha com KPIs derivados. Nível campaign apenas — adset/ad têm views próprias pro ranking.';

-- v_meta_ranking_campanhas
create or replace view public.v_meta_ranking_campanhas as
select
  campaign_id,
  campaign_name,
  sum(spend) as total_spend,
  sum(impressions)::bigint as total_impressions,
  sum(clicks)::bigint as total_clicks,
  sum(purchases)::int as total_purchases,
  sum(purchase_value) as total_purchase_value,
  case when sum(spend) > 0 then round(sum(purchase_value) / sum(spend), 4) else 0 end as roas
from public.meta_ads_insights
where level = 'campaign'
group by campaign_id, campaign_name;

-- v_meta_ranking_conjuntos
create or replace view public.v_meta_ranking_conjuntos as
select
  adset_id,
  adset_name,
  campaign_id,
  campaign_name,
  sum(spend) as total_spend,
  sum(impressions)::bigint as total_impressions,
  sum(clicks)::bigint as total_clicks,
  sum(purchases)::int as total_purchases,
  sum(purchase_value) as total_purchase_value,
  case when sum(spend) > 0 then round(sum(purchase_value) / sum(spend), 4) else 0 end as roas
from public.meta_ads_insights
where level = 'adset'
group by adset_id, adset_name, campaign_id, campaign_name;

-- v_meta_ranking_criativos
create or replace view public.v_meta_ranking_criativos as
select
  ad_id,
  ad_name,
  adset_id,
  adset_name,
  campaign_id,
  campaign_name,
  sum(spend) as total_spend,
  sum(impressions)::bigint as total_impressions,
  sum(clicks)::bigint as total_clicks,
  sum(purchases)::int as total_purchases,
  sum(purchase_value) as total_purchase_value,
  case when sum(spend) > 0 then round(sum(purchase_value) / sum(spend), 4) else 0 end as roas
from public.meta_ads_insights
where level = 'ad'
group by ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name;

-- ============================================================
-- VALIDAÇÕES CONTRA O SEED (rodar no SQL Editor após aplicar)
-- ============================================================
-- Visão Geral — faturamento total paid por source
-- SELECT source, sum(gross_revenue) FROM v_visao_geral_daily GROUP BY source;
--   conta_azul: ~2149.40  (11 vendas paid)
--   nuvemshop:  ~1549.50  (7  vendas paid)
--   total:      ~3698.90
--
-- Top 3 produtos consolidados
-- SELECT canonical_name, revenue_total FROM v_visao_geral_top_produtos
-- ORDER BY revenue_total DESC LIMIT 3;
--
-- Loja Física por estado
-- SELECT state, revenue FROM v_loja_fisica_estado ORDER BY revenue DESC;
--
-- Nuvemshop por gênero
-- SELECT gender, revenue FROM v_nuvemshop_genero ORDER BY revenue DESC;
--   F deve dominar (6 dos 6 clientes NS com gênero conhecido são F, exceto Diego=M)
--
-- Meta Ads ranking campanha
-- SELECT campaign_name, total_spend, roas FROM v_meta_ranking_campanhas;
--   Coleção Outono 2026: spend ~960, roas ~3.4
