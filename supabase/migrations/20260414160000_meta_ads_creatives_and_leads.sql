-- ============================================================
-- Miranda Studio Dashboard — Meta Ads: thumbnails + leads
-- ============================================================
--
-- Duas mudancas para suportar o ranking de criativos com imagem
-- e colunas de leads/CPL (referencia visual enviada pela Miranda
-- 2026-04-14):
--
-- 1) TABELA meta_ads_creatives
--    O endpoint /insights nao retorna thumbnail. Precisa buscar
--    separadamente via /act_<id>/ads?fields=id,creative{thumbnail_url,
--    image_url}. Guardamos aqui (1 linha por ad_id) e fazemos lookup
--    em memoria no frontend. Tabela pequena (~200 rows), refresh
--    semanal no ETL.
--
-- 2) COLUNAS leads / leads_value em meta_ads_insights
--    Leads vem no mesmo actions[] das purchases, mas com outro
--    action_type (lead / onsite_conversion.lead_grouped / etc.).
--    Adicionamos as colunas nullable default 0 pra nao quebrar
--    upserts antigos; mapper vai popular a partir da proxima
--    sincronizacao.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela meta_ads_creatives
-- ------------------------------------------------------------

create table if not exists public.meta_ads_creatives (
  ad_id           text primary key,
  thumbnail_url   text,
  image_url       text,
  creative_name   text,
  last_synced_at  timestamptz not null default now()
);

comment on table public.meta_ads_creatives is
  'Thumbnails e imagens full dos criativos Meta Ads. Populado por ETL separado apos sync de insights (ver src/etl/meta-ads/sync.ts).';

alter table public.meta_ads_creatives enable row level security;

-- ------------------------------------------------------------
-- 2. Colunas leads em meta_ads_insights
-- ------------------------------------------------------------

alter table public.meta_ads_insights
  add column if not exists leads       int           not null default 0,
  add column if not exists leads_value numeric(14,2) not null default 0;

comment on column public.meta_ads_insights.leads is
  'Leads atribuidos (action_type=lead/onsite_conversion.lead_grouped). Populado pelo mapper a partir de 2026-04-14.';

-- ------------------------------------------------------------
-- 3. View v_meta_account_daily — recriar com leads
-- ------------------------------------------------------------
-- DROP antes de CREATE porque Postgres nao aceita CREATE OR REPLACE
-- quando a ORDEM das colunas muda (leads/leads_value precisam vir
-- antes de ctr_pct pra agrupamento conceitual). Se a view tivesse
-- dependents, teriamos que usar CASCADE — nao tem no nosso caso.
drop view if exists public.v_meta_account_daily;

create view public.v_meta_account_daily as
select
  date,
  sum(spend) as spend,
  sum(impressions)::bigint as impressions,
  sum(reach)::bigint as reach,
  sum(clicks)::bigint as clicks,
  sum(purchases)::int as purchases,
  sum(purchase_value) as purchase_value,
  sum(leads)::int as leads,
  sum(leads_value) as leads_value,
  case when sum(impressions) > 0
       then round((sum(clicks)::numeric / sum(impressions)) * 100, 4)
       else 0 end as ctr_pct,
  case when sum(clicks) > 0
       then round(sum(spend) / sum(clicks), 2)
       else 0 end as cpc,
  case when sum(impressions) > 0
       then round((sum(spend) / sum(impressions)) * 1000, 2)
       else 0 end as cpm,
  case when sum(leads) > 0
       then round(sum(spend) / sum(leads), 2)
       else 0 end as cpl,
  case when sum(spend) > 0
       then round(sum(purchase_value) / sum(spend), 4)
       else 0 end as roas
from public.meta_ads_insights
where level = 'campaign'
group by date;

comment on view public.v_meta_account_daily is
  'Meta Ads diario — agregacao conta-inteira. KPI cards e grafico de serie temporal da aba Meta Ads. Apenas level=campaign pra evitar double-counting.';
