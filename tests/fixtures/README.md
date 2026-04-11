# API Fixtures — Miranda Studio Dashboard

Respostas sintéticas das 3 APIs externas (Conta Azul, Nuvemshop, Meta Ads) usadas para:

1. **Testes unitários** dos HTTP clients e parsers (`msw`, `nock`, ou stubs manuais).
2. **Desenvolvimento offline** — construir ETL sem precisar das credenciais reais.
3. **Referência rápida** — ver a shape exata de cada endpoint sem precisar chamar a API.

## Estrutura

```
tests/fixtures/
  api-responses/
    conta-azul/
      sales_list.json          # GET /v1/sales?... (paginado)
      sale_detail.json         # GET /v1/sales/{id} (com items inline)
      customer_detail.json     # GET /v1/customers/{id}
    nuvemshop/
      orders_list.json         # GET /2025-03/{store}/orders
      order_detail.json        # GET /2025-03/{store}/orders/{id}
      customer_detail.json     # GET /2025-03/{store}/customers/{id}
      abandoned_checkout.json  # GET /2025-03/{store}/checkouts/{id}
      product_detail.json      # GET /2025-03/{store}/products/{id}
    meta-ads/
      insights_campaign.json   # GET /v25.0/act_{id}/insights?level=campaign
      insights_adset.json      # GET /v25.0/act_{id}/insights?level=adset
      insights_ad.json         # GET /v25.0/act_{id}/insights?level=ad
```

## Regras

- **Shapes FIÉIS** às APIs reais. Baseadas nos `docs/producao/MAPEAMENTO_*.txt` §5.
- **Dados fictícios.** Mesma nicho boutique de moda/acessórios do `supabase/seed.sql`.
- **Consistência intencional com o seed.** Os IDs e nomes daqui espelham os IDs usados no `supabase/seed.sql`, para dar pra rastrear "este pedido sintético virou esta linha na canônica".
- **Sem credenciais.** Tokens, IDs de loja, business manager IDs e similares são obviamente falsos (`test-`, `fake-`, `000000`).

## Atualizando

Se uma API mudar de shape (ex: Meta Graph API v26), atualizar o fixture correspondente e o mapeamento ao mesmo tempo. O fixture é a verdade "como a gente acredita que a API se comporta"; o mapeamento é a verdade "como a doc oficial diz que a API se comporta". Os dois devem bater.
