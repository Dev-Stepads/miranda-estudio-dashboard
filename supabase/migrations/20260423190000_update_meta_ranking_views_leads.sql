-- Miranda Studio Dashboard — Add leads/leads_value to ranking views
-- The leads and leads_value columns were added to meta_ads_insights in
-- migration 20260414160000 but the ranking views were not updated.

-- v_meta_ranking_campanhas
drop view if exists public.v_meta_ranking_campanhas;
create or replace view public.v_meta_ranking_campanhas as
select
  campaign_id,
  campaign_name,
  sum(spend) as total_spend,
  sum(impressions)::bigint as total_impressions,
  sum(clicks)::bigint as total_clicks,
  sum(purchases)::int as total_purchases,
  sum(purchase_value) as total_purchase_value,
  sum(leads)::int as total_leads,
  sum(leads_value) as total_leads_value,
  case when sum(spend) > 0 then round(sum(purchase_value) / sum(spend), 4) else 0 end as roas
from public.meta_ads_insights
where level = 'campaign'
group by campaign_id, campaign_name;

-- v_meta_ranking_conjuntos
drop view if exists public.v_meta_ranking_conjuntos;
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
  sum(leads)::int as total_leads,
  sum(leads_value) as total_leads_value,
  case when sum(spend) > 0 then round(sum(purchase_value) / sum(spend), 4) else 0 end as roas
from public.meta_ads_insights
where level = 'adset'
group by adset_id, adset_name, campaign_id, campaign_name;

-- v_meta_ranking_criativos
drop view if exists public.v_meta_ranking_criativos;
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
  sum(leads)::int as total_leads,
  sum(leads_value) as total_leads_value,
  case when sum(spend) > 0 then round(sum(purchase_value) / sum(spend), 4) else 0 end as roas
from public.meta_ads_insights
where level = 'ad'
group by ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name;
