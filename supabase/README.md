# Supabase — Miranda Studio Dashboard

Migrations do banco Postgres do projeto. Todo schema do dashboard (staging + canônico) vive aqui.

## Estrutura

```
supabase/
  migrations/
    20260411120000_initial_schema.sql   # tabelas raw_* + canônicas, RLS, índices
```

## Como aplicar

### Opção A — Supabase CLI (recomendado)

```bash
# instalar a CLI (uma vez por máquina)
npm install -g supabase

# logar
supabase login

# linkar ao projeto remoto (pegar o ref no painel do projeto)
supabase link --project-ref <project-ref>

# aplicar todas as migrations pendentes
supabase db push
```

### Opção B — SQL Editor do painel (quick + dirty)

1. Abrir o projeto em https://supabase.com/dashboard
2. Ir em **SQL Editor** → **New query**
3. Colar o conteúdo de `migrations/20260411120000_initial_schema.sql`
4. Run

Essa rota é útil em setup inicial ou debugging, mas todo schema de produção deve ir via CLI pra manter histórico.

## Regras do schema

- **Tabelas `raw_*` são APPEND-ONLY.** O ETL nunca dá `UPDATE` nelas. Deduplicação, reescrita e correção acontecem na camada canônica (`sales`, `customers`, etc.).
- **Timestamps** são sempre `timestamptz`. O banco armazena em UTC; conversão pra `America/Sao_Paulo` acontece na leitura (view ou aplicação).
- **Valores monetários** são `numeric(14,2)`.
- **Enums** são `text` + `CHECK constraint`. É mais fácil de evoluir que tipo `ENUM` nativo do PG (que precisa de migration especial pra adicionar valor).
- **RLS** está habilitado em todas as tabelas. Sem policies → `anon` e `authenticated` são bloqueados por padrão. O ETL roda com `service_role`, que tem bypass de RLS. Quando o frontend começar a consumir dados, criamos policies de leitura em views específicas.

## Próximas migrations

- Tabela `oauth_tokens` (T7/T13/T23 — autenticação das 3 fontes).
- Views do dashboard (`v_visao_geral_*`, `v_loja_fisica_*`, `v_nuvemshop_*`, `v_meta_*`) — ver `docs/producao/MODELAGEM_DADOS.txt`.

Cada migration nova entra como arquivo SQL separado com prefixo de timestamp em `migrations/`, seguindo a convenção da CLI do Supabase.
