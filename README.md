# Dashboard Miranda Studio

Dashboard consolidado da Miranda Studio com três origens de dados:
- **Conta Azul** — vendas da loja física
- **Nuvemshop** — e-commerce
- **Meta Ads** — tráfego pago

## Estrutura do dashboard

O dashboard é dividido em quatro abas:

1. **Visão Geral** — consolida loja física + e-commerce: faturamento total, participação por canal, ranking de produtos.
2. **Loja Física** — faturamento, produtos, ticket médio, distribuição por estado. (Sem análise por gênero ou faixa etária — ver `docs/context/DECISOES.txt` 2026-04-10: o Conta Azul usado pela Miranda não coleta esses dados.)
3. **Nuvemshop** — faturamento, produtos, geografia, gênero, faixa etária, carrinhos abandonados.
4. **Meta Ads** — investimento, faturamento atribuído, ROAS, CTR, CPC, CPM, alcance, impressões, cliques, ranking de criativos.

## Estrutura do repositório

```
/docs
  /context        → HANDOFF, DECISOES, STATUS_ATUAL (contexto vivo do projeto)
  /producao       → BACKLOG, MAPEAMENTOS por fonte, MODELAGEM, REGRAS
  /qa             → CHECKLIST de validação
/src
  /integrations
    /conta-azul   → autenticação + coleta Conta Azul
    /nuvemshop    → autenticação + coleta Nuvemshop
    /meta-ads     → autenticação + coleta Meta Ads
  /etl            → transformação e consolidação
  /dashboard      → frontend do dashboard
```

## Como assumir o projeto (revezamento)

**ANTES de alterar qualquer código, leia nesta ordem:**

1. `/docs/context/HANDOFF.txt` — o que foi feito, o que falta, próximo passo
2. `/docs/context/STATUS_ATUAL.txt` — estado geral do projeto
3. `/docs/producao/MAPEAMENTO_{fonte}.txt` — se for mexer em uma fonte específica

**AO TERMINAR a sessão, atualize:**

1. `/docs/context/HANDOFF.txt` — com o que você fez, o que falta, próximo passo exato
2. `/docs/context/STATUS_ATUAL.txt` — se mudou o estado geral
3. `/docs/context/DECISOES.txt` — se tomou alguma decisão técnica/de negócio relevante

**Regra de ouro:** Todo push relevante leva código + HANDOFF atualizado. Sem isso, não sobe.

## Stack

- **Repositório:** GitHub
- **Banco/Backend:** Supabase (conta dev@stepads.com.br)
- **Deploy:** Vercel (conta dev@stepads.com.br)

## Padrão de branches

- `feature/conta-azul-auth`
- `feature/conta-azul-vendas`
- `feature/nuvemshop-orders`
- `feature/meta-ads-kpis`
- `feature/consolidacao-produtos`
- `feature/dashboard-visao-geral`

## Padrão de commits

- `feat: integra auth conta azul`
- `fix: corrige cálculo de ROAS`
- `docs: atualiza handoff e status`
