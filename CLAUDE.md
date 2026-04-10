# Instruções para o Claude — Projeto Miranda Studio

Este arquivo é lido automaticamente pelo Claude Code toda vez que alguém abre este repositório. Ele contém as regras que **qualquer Claude** (não importa quem esteja sentado na frente) precisa seguir ao trabalhar neste projeto.

Se você é uma pessoa: não precisa ler isso, leia o `README.md` e o `docs/context/HANDOFF.txt`.

---

## 1. Contexto do projeto

Dashboard consolidado da Miranda Studio com três fontes de dados:
- **Conta Azul** (vendas loja física)
- **Nuvemshop** (e-commerce)
- **Meta Ads** (tráfego pago)

Projeto revezado entre múltiplas pessoas/sessões. Contexto vive em `docs/context/`.

---

## 2. Regras obrigatórias (não negociáveis)

### 2.1. SEMPRE ler antes de qualquer alteração
Antes de escrever código ou mexer em configuração, leia nesta ordem:
1. `docs/context/HANDOFF.txt` — o que foi feito por último, o que falta, próximo passo exato
2. `docs/context/STATUS_ATUAL.txt` — estado macro do projeto
3. `docs/context/DECISOES.txt` — decisões técnicas/de negócio já tomadas
4. `docs/producao/BACKLOG_MIRANDA.txt` — backlog com IDs de task (T1a, T1b, …)

Se for mexer em uma fonte específica, leia também `docs/producao/MAPEAMENTO_{fonte}.txt`.

### 2.2. SEMPRE atualizar os 3 docs vivos quando o estado mudar
**Sem pedir permissão.** Toda vez que você:
- concluir uma task do backlog (T1a, T1b, etc.),
- descobrir um bloqueio,
- criar infra nova (Supabase, Vercel, banco, etc.),
- tomar uma decisão técnica relevante,

você DEVE atualizar **os três arquivos abaixo na mesma resposta**, sempre:

1. `docs/producao/BACKLOG_MIRANDA.txt` — marcar a task `[x]` com data, URL, e notas breves (projeto, região, etc.). **Este é o mais esquecido — atenção redobrada.**
2. `docs/context/HANDOFF.txt` — seções 1, 2, 3, 4 e 5 (próximo passo exato)
3. `docs/context/STATUS_ATUAL.txt` — checkboxes, URLs, datas
4. `docs/context/DECISOES.txt` — se foi uma decisão (append-only, ver 2.3)

**Checklist mental antes de terminar a resposta:** "atualizei os 3 docs vivos (BACKLOG + HANDOFF + STATUS_ATUAL)?"

Não perguntar "quer que eu atualize?". Fazer junto com a ação. Sem isso, a próxima sessão herda contexto errado e retrabalha — isso já aconteceu no projeto e é a razão desta regra existir.

### 2.3. `DECISOES.txt` é append-only
Nunca apagar decisões antigas. Se uma decisão foi revertida, adicionar uma nova entrada marcando a anterior como revertida e explicando o porquê. O histórico importa.

### 2.4. Nunca commitar credenciais
- `.env.local` está no `.gitignore` (linha 8) — não mexer nessa proteção.
- Se o usuário colar credenciais no chat, lembrar ao final da sessão que ele pode rotacionar as que passaram por chat.
- Nunca escrever chaves direto em código, mesmo "temporariamente".

---

## 3. Regras de negócio que NÃO dá pra deduzir do código

### 3.1. Visão Geral = Loja Física + Nuvemshop (NÃO inclui Meta Ads no faturamento)
A aba "Visão Geral" consolida **apenas** Conta Azul (loja física) + Nuvemshop (e-commerce). **Meta Ads é atribuição de marketing, não venda** — entra na própria aba de Meta Ads, mas nunca soma no faturamento geral. Esse erro é fácil de cometer e distorce todo o dashboard.

### 3.2. Timezone
Tudo em `America/Sao_Paulo`. Variável `DASHBOARD_TIMEZONE` no `.env.local`.

### 3.3. Consolidação de produtos
Produtos da loja física e do e-commerce podem ter nomes diferentes mas ser o mesmo SKU. Regras em `docs/producao/REGRAS_CONSOLIDACAO.txt`.

---

## 4. Workflow de tasks

Backlog completo em `docs/producao/BACKLOG_MIRANDA.txt` (T1–T45). Ao iniciar trabalho:
1. Identifique qual task você está executando (ex: "estou em T1c — Vercel").
2. Faça o trabalho.
3. Atualize HANDOFF + STATUS_ATUAL (ver 2.2).
4. Se for commitar, mensagem no padrão `feat:`, `fix:`, `docs:`, etc. (ver README).

---

## 5. Stack e infraestrutura

- **GitHub:** https://github.com/Dev-Stepads/miranda-estudio-dashboard
- **Supabase:** conta `dev@stepads.com.br`, projeto `miranda-dashboard`
- **Vercel:** conta `dev@stepads.com.br`

URLs específicas e estado atual ficam em `STATUS_ATUAL.txt` (fonte da verdade), não aqui — este arquivo é regra permanente, não estado.

---

## 6. O que NÃO fazer

- Não criar arquivos de documentação novos em `docs/` sem necessidade clara. O conjunto atual é suficiente.
- Não refatorar estrutura de pastas sem alinhar via `DECISOES.txt`.
- Não inventar features fora do backlog. Se achar que falta algo, proponha e registre em `DECISOES.txt` antes de implementar.
- Não rodar comandos destrutivos (drop table, force push, reset --hard) sem confirmar com o usuário.
- Não incluir Meta Ads no faturamento da Visão Geral (ver 3.1).
