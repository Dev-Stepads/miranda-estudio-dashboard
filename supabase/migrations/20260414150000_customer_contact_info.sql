-- ============================================================
-- Customers: adicionar email e telefone
-- ============================================================

alter table public.customers
  add column if not exists email text,
  add column if not exists phone text;

comment on column public.customers.email is 'Email do cliente — Nuvemshop ou NF-e Conta Azul.';
comment on column public.customers.phone is 'Telefone do cliente — formato varia por fonte.';
