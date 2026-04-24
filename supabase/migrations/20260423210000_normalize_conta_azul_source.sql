-- Fix: ETL antigo escrevia source='conta-azul' (hyphen) mas o CHECK
-- constraint original exige 'conta_azul' (underscore). Em producao,
-- o CHECK pode ter sido alterado para aceitar ambos. Esta migration
-- normaliza todos os registros existentes para 'conta_azul' e garante
-- que o CHECK constraint esta correto.

-- 1. Normalizar dados existentes (se houver registros com hyphen)
UPDATE public.customers SET source = 'conta_azul' WHERE source = 'conta-azul';
UPDATE public.sales SET source = 'conta_azul' WHERE source = 'conta-azul';

-- 2. Recriar CHECK constraints para aceitar apenas os valores corretos.
-- DROP e re-ADD para garantir que o constraint esta no estado correto,
-- independente do que foi alterado manualmente no banco.
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_source_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_source_check CHECK (source IN ('conta_azul', 'nuvemshop'));

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_source_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_source_check CHECK (source IN ('conta_azul', 'nuvemshop'));
