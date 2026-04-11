-- ============================================================
-- Miranda Studio Dashboard — Initial Schema
-- ============================================================
-- Cria as tabelas raw (staging, append-only) e canônicas
-- conforme MODELAGEM_DADOS.txt.
--
-- Convenções:
--   * Raw tables são APPEND-ONLY. ETL nunca dá UPDATE em raw_*.
--     Deduplicação e reescrita acontecem na camada canônica.
--   * Todos os timestamps são timestamptz (UTC on disk, exibição
--     em America/Sao_Paulo via view/aplicação — ver REGRAS §1.1).
--   * Valores monetários: numeric(14,2).
--   * Enums implementados como text + CHECK constraint (mais fácil
--     de evoluir que PG ENUM type).
--   * PKs são bigserial (simples, denso, suficiente pro workload).
--   * RLS habilitado em TODAS as tabelas. Sem policies → default deny
--     para anon/authenticated. ETL roda com service_role (bypass).
-- ============================================================

-- ------------------------------------------------------------
-- RAW TABLES — append-only staging
-- ------------------------------------------------------------
-- Padrão: id bigserial + source_id (quando aplicável) + payload
-- jsonb + ingested_at. Permite reprocessar o canônico a partir
-- do histórico completo de respostas das APIs.

-- Conta Azul ---------------------------------------------------
create table public.raw_contaazul_sales (
  id            bigserial primary key,
  source_id     text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
comment on table public.raw_contaazul_sales is 'Raw payload de vendas da Conta Azul. Append-only.';

create index idx_raw_ca_sales_source_id on public.raw_contaazul_sales (source_id) where source_id is not null;
create index idx_raw_ca_sales_ingested_at on public.raw_contaazul_sales (ingested_at desc);

create table public.raw_contaazul_sale_items (
  id            bigserial primary key,
  source_id     text,
  source_sale_id text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_ca_items_sale_id on public.raw_contaazul_sale_items (source_sale_id) where source_sale_id is not null;

create table public.raw_contaazul_customers (
  id            bigserial primary key,
  source_id     text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_ca_customers_source_id on public.raw_contaazul_customers (source_id) where source_id is not null;

-- Nuvemshop ----------------------------------------------------
create table public.raw_nuvemshop_orders (
  id            bigserial primary key,
  source_id     text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
comment on table public.raw_nuvemshop_orders is 'Raw payload de pedidos da Nuvemshop. Append-only.';
create index idx_raw_ns_orders_source_id on public.raw_nuvemshop_orders (source_id) where source_id is not null;
create index idx_raw_ns_orders_ingested_at on public.raw_nuvemshop_orders (ingested_at desc);

create table public.raw_nuvemshop_customers (
  id            bigserial primary key,
  source_id     text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_ns_customers_source_id on public.raw_nuvemshop_customers (source_id) where source_id is not null;

create table public.raw_nuvemshop_abandoned_checkouts (
  id            bigserial primary key,
  source_id     text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_ns_abandoned_source_id on public.raw_nuvemshop_abandoned_checkouts (source_id) where source_id is not null;

-- Meta Ads -----------------------------------------------------
create table public.raw_meta_insights_campaign (
  id            bigserial primary key,
  date_start    date,
  campaign_id   text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
comment on table public.raw_meta_insights_campaign is 'Raw insights diários por campanha. Meta recalcula histórico: UPSERT no canônico.';
create index idx_raw_meta_camp_date on public.raw_meta_insights_campaign (date_start, campaign_id);

create table public.raw_meta_insights_adset (
  id            bigserial primary key,
  date_start    date,
  adset_id      text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_meta_adset_date on public.raw_meta_insights_adset (date_start, adset_id);

create table public.raw_meta_insights_ad (
  id            bigserial primary key,
  date_start    date,
  ad_id         text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_meta_ad_date on public.raw_meta_insights_ad (date_start, ad_id);

create table public.raw_meta_ads_metadata (
  id            bigserial primary key,
  entity_type   text check (entity_type in ('campaign','adset','ad','creative')),
  entity_id     text,
  payload       jsonb not null,
  ingested_at   timestamptz not null default now()
);
create index idx_raw_meta_meta_entity on public.raw_meta_ads_metadata (entity_type, entity_id);

-- ------------------------------------------------------------
-- CANONICAL TABLES
-- ------------------------------------------------------------

-- products -----------------------------------------------------
create table public.products (
  product_id      bigserial primary key,
  canonical_name  text not null,
  sku             text,
  source_refs     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
comment on table public.products is 'Catálogo consolidado. Um produto = um canonical_name ou um SKU compartilhado entre fontes.';
comment on column public.products.source_refs is 'jsonb no formato {"conta_azul": "<id>", "nuvemshop": "<id>"}';

-- SKU é unique só quando não-nulo (produtos sem SKU podem coexistir)
create unique index uq_products_sku on public.products (sku) where sku is not null;
create index idx_products_canonical_name on public.products (lower(canonical_name));

-- customers ----------------------------------------------------
create table public.customers (
  customer_id              bigserial primary key,
  source                   text not null check (source in ('conta_azul','nuvemshop')),
  source_customer_id       text not null,
  name                     text,
  gender                   text not null default 'unknown' check (gender in ('M','F','unknown')),
  age                      int,
  age_range                text not null default 'unknown' check (age_range in ('18-24','25-34','35-44','45-54','55+','unknown')),
  state                    char(2),
  city                     text,
  inferred_state_from_ddd  boolean not null default false,
  created_at               timestamptz not null default now(),
  unique (source, source_customer_id)
);
comment on table public.customers is 'Clientes canônicos. Um cliente por (source, source_customer_id).';
comment on column public.customers.inferred_state_from_ddd is 'true quando state foi deduzido do DDD do telefone (edge case Conta Azul).';

-- sales --------------------------------------------------------
create table public.sales (
  sale_id          bigserial primary key,
  source           text not null check (source in ('conta_azul','nuvemshop')),
  source_sale_id   text not null,
  sale_date        timestamptz not null,
  gross_revenue    numeric(14,2) not null,
  net_revenue      numeric(14,2),
  status           text not null check (status in ('paid','cancelled','refunded','pending')),
  customer_id      bigint references public.customers(customer_id) on delete set null,
  payment_method   text,
  ingested_at      timestamptz not null default now(),
  unique (source, source_sale_id)
);
comment on table public.sales is 'Uma linha por pedido. sale_date segue REGRAS §1.2 (paid_at pra Nuvemshop, Data de venda pra Conta Azul).';
comment on column public.sales.status is 'paid inclui partially_paid da Nuvemshop (ver REGRAS §2.2).';

create index idx_sales_source_date on public.sales (source, sale_date desc);
create index idx_sales_date on public.sales (sale_date desc);
create index idx_sales_customer on public.sales (customer_id) where customer_id is not null;
create index idx_sales_status on public.sales (status);

-- sale_items ---------------------------------------------------
create table public.sale_items (
  sale_item_id   bigserial primary key,
  sale_id        bigint not null references public.sales(sale_id) on delete cascade,
  product_id     bigint references public.products(product_id) on delete set null,
  product_name   text not null,
  sku            text,
  quantity       int not null check (quantity > 0),
  unit_price     numeric(14,2) not null,
  total_price    numeric(14,2) not null
);
comment on column public.sale_items.product_name is 'Nome como veio da fonte original, antes da consolidação por canonical_name.';

create index idx_sale_items_sale on public.sale_items (sale_id);
create index idx_sale_items_product on public.sale_items (product_id) where product_id is not null;
create index idx_sale_items_sku on public.sale_items (sku) where sku is not null;

-- abandoned_checkouts (Nuvemshop) ------------------------------
create table public.abandoned_checkouts (
  checkout_id         bigserial primary key,
  source_checkout_id  text not null unique,
  created_at          timestamptz not null,
  total_amount        numeric(14,2) not null,
  customer_id         bigint references public.customers(customer_id) on delete set null,
  ingested_at         timestamptz not null default now()
);
comment on table public.abandoned_checkouts is 'Carrinhos abandonados da Nuvemshop. API retém 30 dias, deleta definitivamente em 90.';

create index idx_abandoned_created_at on public.abandoned_checkouts (created_at desc);

-- meta_ads_insights --------------------------------------------
create table public.meta_ads_insights (
  insight_id      bigserial primary key,
  date            date not null,
  level           text not null check (level in ('campaign','adset','ad')),
  campaign_id     text not null,
  campaign_name   text,
  adset_id        text,
  adset_name      text,
  ad_id           text,
  ad_name         text,
  spend           numeric(14,2) not null default 0,
  impressions     bigint not null default 0,
  reach           bigint not null default 0,
  clicks          bigint not null default 0,
  purchases       int not null default 0,
  purchase_value  numeric(14,2) not null default 0,
  ingested_at     timestamptz not null default now()
);
comment on table public.meta_ads_insights is 'Insights diários Meta Ads. UPSERT diário — Meta recalcula janela de 7 dias.';

-- Uniqueness por (date, level, campaign_id, adset_id, ad_id) com
-- colunas nullable — usa expressão COALESCE pra transformar null em '':
create unique index uq_meta_insights on public.meta_ads_insights (
  date, level, campaign_id, coalesce(adset_id,''), coalesce(ad_id,'')
);
create index idx_meta_insights_date on public.meta_ads_insights (date desc);
create index idx_meta_insights_level_date on public.meta_ads_insights (level, date desc);

-- ------------------------------------------------------------
-- RLS — default deny em todas as tabelas
-- ------------------------------------------------------------
-- Sem policies: anon e authenticated são bloqueados por padrão.
-- O ETL usa service_role, que tem bypass automático de RLS.
-- Quando o frontend começar a ler via anon/authenticated,
-- criamos policies de read em views específicas.

alter table public.raw_contaazul_sales                 enable row level security;
alter table public.raw_contaazul_sale_items            enable row level security;
alter table public.raw_contaazul_customers             enable row level security;
alter table public.raw_nuvemshop_orders                enable row level security;
alter table public.raw_nuvemshop_customers             enable row level security;
alter table public.raw_nuvemshop_abandoned_checkouts   enable row level security;
alter table public.raw_meta_insights_campaign          enable row level security;
alter table public.raw_meta_insights_adset             enable row level security;
alter table public.raw_meta_insights_ad                enable row level security;
alter table public.raw_meta_ads_metadata               enable row level security;
alter table public.products                            enable row level security;
alter table public.customers                           enable row level security;
alter table public.sales                               enable row level security;
alter table public.sale_items                          enable row level security;
alter table public.abandoned_checkouts                 enable row level security;
alter table public.meta_ads_insights                   enable row level security;
