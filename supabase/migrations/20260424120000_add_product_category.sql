-- Fase 4: Adicionar categoria de produto (Casa, Corpo, Papelaria, etc.)
-- Dados vem da API Nuvemshop (campo categories nos produtos).
-- Armazenado como texto simples — sao apenas 3 categorias raiz.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category text DEFAULT NULL;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS category text DEFAULT NULL;

COMMENT ON COLUMN public.products.category IS
  'Categoria raiz do produto na Nuvemshop (CASA, CORPO, PAPELARIA). NULL para produtos sem categoria ou do Conta Azul.';

COMMENT ON COLUMN public.sale_items.category IS
  'Categoria do produto no momento da venda. Denormalizado aqui para filtros rapidos sem JOIN com products.';

-- Index para filtros por categoria
CREATE INDEX IF NOT EXISTS idx_sale_items_category ON public.sale_items (category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category) WHERE category IS NOT NULL;
