-- ============================================================
-- Miranda Studio Dashboard — Meta Ads: fix unique constraint +
-- account-level view
-- ============================================================
--
-- Dois problemas resolvidos aqui:
--
-- 1) UNIQUE CONSTRAINT PARA UPSERT
--    O schema original (20260411120000) criou:
--      create unique index uq_meta_insights on meta_ads_insights (
--        date, level, campaign_id, coalesce(adset_id,''), coalesce(ad_id,'')
--      );
--    Isso eh um EXPRESSION INDEX, nao uma constraint real. O Supabase
--    JS client `.upsert({ onConflict: 'date,level,campaign_id,adset_id,ad_id' })`
--    espera uma UNIQUE CONSTRAINT nas colunas simples pra funcionar.
--    Expression indexes nao sao alcancaveis via PostgREST `on_conflict`.
--
--    Fix: transformar adset_id e ad_id em NOT NULL DEFAULT '' (string vazia
--    quando nao-aplicavel pro nivel) e substituir o expression index por
--    uma UNIQUE CONSTRAINT de verdade. Postgres agora trata '' como valor
--    ordinario pro proposito da unicidade (e o NULL sumiu de cena).
--
--    Semantica preservada: '' == "nao aplicavel pro nivel" (campaign-level
--    rows tem adset_id='' e ad_id=''). As views ja filtram por
--    `where level = 'adset'` / 'ad' entao '' nao aparece em ranking.
--
--    Impacto no ETL: sync.ts.mapper produz null pra adset_id/ad_id
--    quando nao-aplicavel, e o sync.ts converte pra '' antes do upsert.
--
-- 2) VIEW AGREGADA CONTA-INTEIRA
--    `v_meta_campanha_daily` ja existe e agrega por campanha+dia. O
--    frontend precisa de uma view ainda mais alta (soma de todas as
--    campanhas por dia) pra alimentar os KPI cards e o grafico de serie
--    temporal da aba Meta Ads. Fazer isso no frontend exigiria
--    paginacao de 1000 rows da Supabase — a view encapsula o SUM.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fix unique constraint
-- ------------------------------------------------------------

-- Normaliza qualquer dado legado de seed com NULL pra '' antes de
-- aplicar NOT NULL. Se a tabela estiver vazia (caso atual, ETL ainda
-- nao rodou), esses UPDATEs sao no-op.
update public.meta_ads_insights set adset_id = '' where adset_id is null;
update public.meta_ads_insights set ad_id    = '' where ad_id    is null;

alter table public.meta_ads_insights
  alter column adset_id set default '',
  alter column adset_id set not null,
  alter column ad_id    set default '',
  alter column ad_id    set not null;

-- Remove o expression index antigo (nao-alcancavel via PostgREST).
drop index if exists public.uq_meta_insights;

-- Cria constraint real — essa sim eh alcancavel via
-- Supabase JS `.upsert({ onConflict: 'date,level,campaign_id,adset_id,ad_id' })`.
alter table public.meta_ads_insights
  add constraint uq_meta_insights
  unique (date, level, campaign_id, adset_id, ad_id);

-- ------------------------------------------------------------
-- 2. Account-level daily view
-- ------------------------------------------------------------

create or replace view public.v_meta_account_daily as
select
  date,
  sum(spend) as spend,
  sum(impressions)::bigint as impressions,
  sum(reach)::bigint as reach,
  sum(clicks)::bigint as clicks,
  sum(purchases)::int as purchases,
  sum(purchase_value) as purchase_value,
  case when sum(impressions) > 0
       then round((sum(clicks)::numeric / sum(impressions)) * 100, 4)
       else 0 end as ctr_pct,
  case when sum(clicks) > 0
       then round(sum(spend) / sum(clicks), 2)
       else 0 end as cpc,
  case when sum(impressions) > 0
       then round((sum(spend) / sum(impressions)) * 1000, 2)
       else 0 end as cpm,
  case when sum(spend) > 0
       then round(sum(purchase_value) / sum(spend), 4)
       else 0 end as roas
from public.meta_ads_insights
where level = 'campaign'
group by date;

comment on view public.v_meta_account_daily is
  'Meta Ads diario — agregacao conta-inteira. KPI cards e grafico de serie temporal da aba Meta Ads. Apenas level=campaign pra evitar double-counting.';
