-- ============================================================
-- Abandoned Checkouts: adicionar dados de contato e produtos
-- ============================================================
-- A tabela original só guardava total_amount e created_at.
-- A API da Nuvemshop retorna nome, email, telefone, endereço
-- e lista de produtos — informações essenciais para recuperar
-- carrinhos abandonados.
-- ============================================================

alter table public.abandoned_checkouts
  add column if not exists contact_name  text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists contact_state char(2),
  add column if not exists products      jsonb;

comment on column public.abandoned_checkouts.contact_name is 'Nome do cliente que abandonou (pode não ser cliente cadastrado).';
comment on column public.abandoned_checkouts.contact_email is 'Email do cliente — útil para remarketing.';
comment on column public.abandoned_checkouts.contact_phone is 'Telefone do cliente — formato +55XXXXXXXXXXX.';
comment on column public.abandoned_checkouts.contact_state is 'UF extraída do shipping_address.';
comment on column public.abandoned_checkouts.products is 'Array JSON com {name, quantity, price, variant_id} dos produtos no carrinho.';
