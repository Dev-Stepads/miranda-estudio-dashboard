-- ============================================================
-- Miranda Studio Dashboard — Dev Seed (dados sintéticos)
-- ============================================================
-- PROPÓSITO: popular um Supabase de desenvolvimento com dados
--   realistas pra construir ETL, views e frontend ANTES das
--   credenciais reais das 3 APIs chegarem.
--
-- ⚠️  ATENÇÃO — este seed é DESTRUTIVO.
--     Usa TRUNCATE RESTART IDENTITY CASCADE em todas as tabelas
--     canônicas e raw. NUNCA rodar em produção. Só aplicar em
--     ambientes de dev/staging.
--
-- NICHO FICTÍCIO: Miranda Estúdio modelada como boutique de moda/
--   acessórios para este seed. Nomes de produtos, clientes e
--   campanhas são 100% inventados e servem apenas como placeholders.
--   Quando o catálogo real entrar via ETL, esta seed perde valor
--   e pode ser descartada ou reescrita.
--
-- DATAS: timestamps relativos a now() com intervals — o seed
--   continua "fresco" conforme o tempo passa.
--
-- APLICAR VIA: SQL Editor do painel Supabase (colar e Run) OU
--   supabase db reset (se estiver usando CLI local).
-- ============================================================

BEGIN;

TRUNCATE TABLE
  sale_items,
  sales,
  abandoned_checkouts,
  customers,
  products,
  meta_ads_insights,
  raw_contaazul_sales,
  raw_contaazul_sale_items,
  raw_contaazul_customers,
  raw_nuvemshop_orders,
  raw_nuvemshop_customers,
  raw_nuvemshop_abandoned_checkouts,
  raw_meta_insights_campaign,
  raw_meta_insights_adset,
  raw_meta_insights_ad,
  raw_meta_ads_metadata
RESTART IDENTITY CASCADE;

-- ------------------------------------------------------------
-- products (10 itens — 3 compartilhados entre fontes)
-- ------------------------------------------------------------
INSERT INTO products (product_id, canonical_name, sku, source_refs) VALUES
  (1,  'Camiseta Básica Branca P', 'CAMISETA-BR-P', '{"conta_azul":"ca-p-001","nuvemshop":"ns-p-001"}'),
  (2,  'Camiseta Básica Branca M', 'CAMISETA-BR-M', '{"conta_azul":"ca-p-002","nuvemshop":"ns-p-002"}'),
  (3,  'Camiseta Básica Preta M',  'CAMISETA-PT-M', '{"conta_azul":"ca-p-003","nuvemshop":"ns-p-003"}'),
  (4,  'Calça Jeans Skinny 38',    'JEANS-SKN-38',  '{"nuvemshop":"ns-p-004"}'),
  (5,  'Calça Jeans Skinny 40',    'JEANS-SKN-40',  '{"nuvemshop":"ns-p-005"}'),
  (6,  'Vestido Midi Floral M',    'VST-FLR-M',     '{"nuvemshop":"ns-p-006"}'),
  (7,  'Moletom Canguru Cinza M',  'MOLTOM-CZ-M',   '{"conta_azul":"ca-p-007"}'),
  (8,  'Bolsa Transversal Bege',   'BLS-BG-U',      '{"conta_azul":"ca-p-008"}'),
  (9,  'Cinto Couro Marrom M',     'CNT-MR-M',      '{"conta_azul":"ca-p-009"}'),
  (10, 'Kit Meias 3 pares',        NULL,            '{"conta_azul":"ca-p-010"}');

SELECT setval('products_product_id_seq', 10);

-- ------------------------------------------------------------
-- customers (12 — 6 Nuvemshop com demografia, 6 Conta Azul unknown)
-- ------------------------------------------------------------
INSERT INTO customers (customer_id, source, source_customer_id, name, gender, age, age_range, state, city) VALUES
  -- Nuvemshop (gênero/idade conhecidos)
  (1,  'nuvemshop',  'ns-c-1001', 'Ana Paula Souza', 'F',       28,   '25-34',   'SP', 'São Paulo'),
  (2,  'nuvemshop',  'ns-c-1002', 'Bruna Lima',      'F',       35,   '35-44',   'RJ', 'Rio de Janeiro'),
  (3,  'nuvemshop',  'ns-c-1003', 'Carla Mendes',    'F',       22,   '18-24',   'MG', 'Belo Horizonte'),
  (4,  'nuvemshop',  'ns-c-1004', 'Diego Ferreira',  'M',       41,   '35-44',   'RS', 'Porto Alegre'),
  (5,  'nuvemshop',  'ns-c-1005', 'Elisa Costa',     'F',       56,   '55+',     'PR', 'Curitiba'),
  (6,  'nuvemshop',  'ns-c-1006', 'Fernanda Alves',  'F',       30,   '25-34',   'SP', 'Campinas'),
  -- Conta Azul (sem gênero/idade — campo não coletado)
  (7,  'conta_azul', 'ca-c-2001', 'Cliente Consumidor Final', 'unknown', NULL, 'unknown', 'SP', 'São Paulo'),
  (8,  'conta_azul', 'ca-c-2002', 'Gustavo Almeida', 'unknown', NULL, 'unknown', 'SP', 'Santos'),
  (9,  'conta_azul', 'ca-c-2003', 'Helena Rocha',    'unknown', NULL, 'unknown', 'SP', 'São Bernardo do Campo'),
  (10, 'conta_azul', 'ca-c-2004', 'Igor Martins',    'unknown', NULL, 'unknown', 'RJ', 'Niterói'),
  (11, 'conta_azul', 'ca-c-2005', 'Juliana Ribeiro', 'unknown', NULL, 'unknown', 'SP', 'São Paulo'),
  (12, 'conta_azul', 'ca-c-2006', 'Leonardo Castro', 'unknown', NULL, 'unknown', 'MG', 'Uberlândia');

-- Igor teve o estado deduzido via DDD (edge case Conta Azul)
UPDATE customers SET inferred_state_from_ddd = true WHERE customer_id = 10;

SELECT setval('customers_customer_id_seq', 12);

-- ------------------------------------------------------------
-- sales (20 — 12 loja física + 8 e-commerce, espalhadas em 30d)
-- ------------------------------------------------------------
-- Totais conferem com a soma dos sale_items abaixo.
INSERT INTO sales (sale_id, source, source_sale_id, sale_date, gross_revenue, net_revenue, status, customer_id, payment_method) VALUES
  -- Conta Azul — loja física
  (1,  'conta_azul', 'CA-1001', now() - interval '1 day',   99.80,  99.80,  'paid',      7,  'dinheiro'),
  (2,  'conta_azul', 'CA-1002', now() - interval '2 days',  49.90,  49.90,  'paid',      8,  'debito'),
  (3,  'conta_azul', 'CA-1003', now() - interval '3 days',  289.80, 289.80, 'paid',      9,  'credito'),
  (4,  'conta_azul', 'CA-1004', now() - interval '5 days',  49.90,  49.90,  'paid',      7,  'pix'),
  (5,  'conta_azul', 'CA-1005', now() - interval '7 days',  329.80, 329.80, 'paid',      10, 'credito'),
  (6,  'conta_azul', 'CA-1006', now() - interval '8 days',  129.90, 129.90, 'cancelled', 11, 'credito'),
  (7,  'conta_azul', 'CA-1007', now() - interval '10 days', 129.70, 129.70, 'paid',      12, 'pix'),
  (8,  'conta_azul', 'CA-1008', now() - interval '12 days', 89.70,  89.70,  'paid',      7,  'dinheiro'),
  (9,  'conta_azul', 'CA-1009', now() - interval '15 days', 419.70, 419.70, 'paid',      8,  'credito'),
  (10, 'conta_azul', 'CA-1010', now() - interval '18 days', 49.90,  49.90,  'paid',      9,  'debito'),
  (11, 'conta_azul', 'CA-1011', now() - interval '22 days', 129.70, 129.70, 'paid',      10, 'pix'),
  (12, 'conta_azul', 'CA-1012', now() - interval '27 days', 219.80, 219.80, 'paid',      11, 'credito'),
  -- Nuvemshop — e-commerce
  (13, 'nuvemshop',  'NS-2001', now() - interval '1 day',   259.70, 259.70, 'paid',      1,  'credito'),
  (14, 'nuvemshop',  'NS-2002', now() - interval '3 days',  239.80, 239.80, 'paid',      2,  'pix'),
  (15, 'nuvemshop',  'NS-2003', now() - interval '5 days',  159.90, 159.90, 'paid',      3,  'credito'),
  (16, 'nuvemshop',  'NS-2004', now() - interval '9 days',  389.80, 389.80, 'paid',      4,  'boleto'),
  (17, 'nuvemshop',  'NS-2005', now() - interval '11 days', 99.80,  99.80,  'paid',      5,  'credito'),
  (18, 'nuvemshop',  'NS-2006', now() - interval '14 days', 189.90, 189.90, 'pending',   6,  'credito'),
  (19, 'nuvemshop',  'NS-2007', now() - interval '20 days', 159.90, 159.90, 'paid',      1,  'pix'),
  (20, 'nuvemshop',  'NS-2008', now() - interval '25 days', 239.80, 239.80, 'paid',      3,  'credito');

SELECT setval('sales_sale_id_seq', 20);

-- ------------------------------------------------------------
-- sale_items
-- ------------------------------------------------------------
INSERT INTO sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, total_price) VALUES
  -- CA-1001 = 99.80
  (1,  1,  'Camiseta Básica Branca P', 'CAMISETA-BR-P', 2, 49.90,  99.80),
  -- CA-1002 = 49.90
  (2,  2,  'Camiseta Básica Branca M', 'CAMISETA-BR-M', 1, 49.90,  49.90),
  -- CA-1003 = 289.80
  (3,  7,  'Moletom Canguru Cinza M',  'MOLTOM-CZ-M',   1, 199.90, 199.90),
  (3,  9,  'Cinto Couro Marrom M',     'CNT-MR-M',      1, 89.90,  89.90),
  -- CA-1004 = 49.90
  (4,  3,  'Camiseta Básica Preta M',  'CAMISETA-PT-M', 1, 49.90,  49.90),
  -- CA-1005 = 329.80
  (5,  7,  'Moletom Canguru Cinza M',  'MOLTOM-CZ-M',   1, 199.90, 199.90),
  (5,  8,  'Bolsa Transversal Bege',   'BLS-BG-U',      1, 129.90, 129.90),
  -- CA-1006 = 129.90 (cancelled)
  (6,  8,  'Bolsa Transversal Bege',   'BLS-BG-U',      1, 129.90, 129.90),
  -- CA-1007 = 129.70
  (7,  1,  'Camiseta Básica Branca P', 'CAMISETA-BR-P', 2, 49.90,  99.80),
  (7,  10, 'Kit Meias 3 pares',        NULL,            1, 29.90,  29.90),
  -- CA-1008 = 89.70
  (8,  10, 'Kit Meias 3 pares',        NULL,            3, 29.90,  89.70),
  -- CA-1009 = 419.70
  (9,  7,  'Moletom Canguru Cinza M',  'MOLTOM-CZ-M',   1, 199.90, 199.90),
  (9,  9,  'Cinto Couro Marrom M',     'CNT-MR-M',      1, 89.90,  89.90),
  (9,  8,  'Bolsa Transversal Bege',   'BLS-BG-U',      1, 129.90, 129.90),
  -- CA-1010 = 49.90
  (10, 2,  'Camiseta Básica Branca M', 'CAMISETA-BR-M', 1, 49.90,  49.90),
  -- CA-1011 = 129.70
  (11, 3,  'Camiseta Básica Preta M',  'CAMISETA-PT-M', 2, 49.90,  99.80),
  (11, 10, 'Kit Meias 3 pares',        NULL,            1, 29.90,  29.90),
  -- CA-1012 = 219.80
  (12, 8,  'Bolsa Transversal Bege',   'BLS-BG-U',      1, 129.90, 129.90),
  (12, 9,  'Cinto Couro Marrom M',     'CNT-MR-M',      1, 89.90,  89.90),
  -- NS-2001 = 259.70
  (13, 1,  'Camiseta Básica Branca P', 'CAMISETA-BR-P', 2, 49.90,  99.80),
  (13, 6,  'Vestido Midi Floral M',    'VST-FLR-M',     1, 159.90, 159.90),
  -- NS-2002 = 239.80
  (14, 4,  'Calça Jeans Skinny 38',    'JEANS-SKN-38',  1, 189.90, 189.90),
  (14, 3,  'Camiseta Básica Preta M',  'CAMISETA-PT-M', 1, 49.90,  49.90),
  -- NS-2003 = 159.90
  (15, 6,  'Vestido Midi Floral M',    'VST-FLR-M',     1, 159.90, 159.90),
  -- NS-2004 = 389.80
  (16, 5,  'Calça Jeans Skinny 40',    'JEANS-SKN-40',  1, 189.90, 189.90),
  (16, 7,  'Moletom Canguru Cinza M',  'MOLTOM-CZ-M',   1, 199.90, 199.90),
  -- NS-2005 = 99.80
  (17, 1,  'Camiseta Básica Branca P', 'CAMISETA-BR-P', 1, 49.90,  49.90),
  (17, 2,  'Camiseta Básica Branca M', 'CAMISETA-BR-M', 1, 49.90,  49.90),
  -- NS-2006 = 189.90 (pending)
  (18, 4,  'Calça Jeans Skinny 38',    'JEANS-SKN-38',  1, 189.90, 189.90),
  -- NS-2007 = 159.90
  (19, 6,  'Vestido Midi Floral M',    'VST-FLR-M',     1, 159.90, 159.90),
  -- NS-2008 = 239.80
  (20, 5,  'Calça Jeans Skinny 40',    'JEANS-SKN-40',  1, 189.90, 189.90),
  (20, 3,  'Camiseta Básica Preta M',  'CAMISETA-PT-M', 1, 49.90,  49.90);

-- ------------------------------------------------------------
-- abandoned_checkouts (5 — só Nuvemshop)
-- ------------------------------------------------------------
INSERT INTO abandoned_checkouts (source_checkout_id, created_at, total_amount, customer_id) VALUES
  ('NS-AB-1', now() - interval '1 day',   279.80, 1),
  ('NS-AB-2', now() - interval '2 days',  189.90, 2),
  ('NS-AB-3', now() - interval '4 days',  159.90, NULL),
  ('NS-AB-4', now() - interval '6 days',  99.80,  3),
  ('NS-AB-5', now() - interval '10 days', 349.80, 5);

-- ------------------------------------------------------------
-- meta_ads_insights (1 campanha × 2 adsets × 2 ads × 7 dias)
-- ------------------------------------------------------------
-- Estrutura: 5 rows/dia = 1 campaign + 2 adsets + 2 ads
-- Total: 35 rows
--
-- Hierarquia:
--   Campanha: "Coleção Outono 2026"
--     Adset A: "Feminino 25-44 SP" → Ad A1: "Vídeo Coleção 15s"
--     Adset B: "Feminino 18-34 Nacional" → Ad B1: "Carrossel 5 peças"
--
-- Valores foram escolhidos pra Campaign = Adset_A + Adset_B
-- (reach real do Meta é deduplicado; aqui simplifico somando).

INSERT INTO meta_ads_insights (date, level, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, reach, clicks, purchases, purchase_value) VALUES
  -- Dia 1 (ontem)
  ((now() - interval '1 day')::date,  'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     150.00, 4500, 3700, 75, 3, 540.00),
  ((now() - interval '1 day')::date,  'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     80.00,  2500, 2000, 40, 2, 360.00),
  ((now() - interval '1 day')::date,  'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     70.00,  2000, 1700, 35, 1, 180.00),
  ((now() - interval '1 day')::date,  'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       80.00,  2500, 2000, 40, 2, 360.00),
  ((now() - interval '1 day')::date,  'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       70.00,  2000, 1700, 35, 1, 180.00),
  -- Dia 2
  ((now() - interval '2 days')::date, 'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     135.00, 4100, 3400, 68, 2, 350.00),
  ((now() - interval '2 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     72.00,  2250, 1850, 36, 1, 180.00),
  ((now() - interval '2 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     63.00,  1850, 1550, 32, 1, 170.00),
  ((now() - interval '2 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       72.00,  2250, 1850, 36, 1, 180.00),
  ((now() - interval '2 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       63.00,  1850, 1550, 32, 1, 170.00),
  -- Dia 3
  ((now() - interval '3 days')::date, 'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     160.00, 4800, 3900, 82, 4, 720.00),
  ((now() - interval '3 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     85.00,  2600, 2100, 44, 2, 360.00),
  ((now() - interval '3 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     75.00,  2200, 1800, 38, 2, 360.00),
  ((now() - interval '3 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       85.00,  2600, 2100, 44, 2, 360.00),
  ((now() - interval '3 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       75.00,  2200, 1800, 38, 2, 360.00),
  -- Dia 4
  ((now() - interval '4 days')::date, 'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     120.00, 3800, 3100, 60, 2, 320.00),
  ((now() - interval '4 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     65.00,  2100, 1700, 32, 1, 180.00),
  ((now() - interval '4 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     55.00,  1700, 1400, 28, 1, 140.00),
  ((now() - interval '4 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       65.00,  2100, 1700, 32, 1, 180.00),
  ((now() - interval '4 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       55.00,  1700, 1400, 28, 1, 140.00),
  -- Dia 5
  ((now() - interval '5 days')::date, 'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     145.00, 4400, 3600, 72, 3, 480.00),
  ((now() - interval '5 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     78.00,  2400, 1950, 39, 2, 320.00),
  ((now() - interval '5 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     67.00,  2000, 1650, 33, 1, 160.00),
  ((now() - interval '5 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       78.00,  2400, 1950, 39, 2, 320.00),
  ((now() - interval '5 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       67.00,  2000, 1650, 33, 1, 160.00),
  -- Dia 6
  ((now() - interval '6 days')::date, 'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     110.00, 3500, 2900, 55, 2, 300.00),
  ((now() - interval '6 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     60.00,  1900, 1550, 30, 1, 160.00),
  ((now() - interval '6 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     50.00,  1600, 1350, 25, 1, 140.00),
  ((now() - interval '6 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       60.00,  1900, 1550, 30, 1, 160.00),
  ((now() - interval '6 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       50.00,  1600, 1350, 25, 1, 140.00),
  -- Dia 7
  ((now() - interval '7 days')::date, 'campaign', '23847562341', 'Coleção Outono 2026', NULL,           NULL,                        NULL,           NULL,                     140.00, 4300, 3500, 70, 3, 500.00),
  ((now() - interval '7 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         NULL,           NULL,                     76.00,  2350, 1900, 38, 2, 340.00),
  ((now() - interval '7 days')::date, 'adset',    '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   NULL,           NULL,                     64.00,  1950, 1600, 32, 1, 160.00),
  ((now() - interval '7 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562342', 'Feminino 25-44 SP',         '23847562343', 'Vídeo Coleção 15s',       76.00,  2350, 1900, 38, 2, 340.00),
  ((now() - interval '7 days')::date, 'ad',       '23847562341', 'Coleção Outono 2026', '23847562344', 'Feminino 18-34 Nacional',   '23847562345', 'Carrossel 5 peças',       64.00,  1950, 1600, 32, 1, 160.00);

COMMIT;

-- ============================================================
-- VALIDAÇÕES (rodar após o seed pra conferir)
-- ============================================================
-- SELECT source, count(*), sum(gross_revenue) FROM sales WHERE status='paid' GROUP BY source;
--   conta_azul → 11 vendas, ~R$ 2.149
--   nuvemshop  → 7  vendas, ~R$ 1.549
-- SELECT level, count(*) FROM meta_ads_insights GROUP BY level;
--   campaign → 7, adset → 14, ad → 14
-- SELECT count(*) FROM abandoned_checkouts;
--   5
