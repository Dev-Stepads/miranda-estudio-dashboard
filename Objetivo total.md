Objetivo

Criar um dashboard consolidado da Miranda Studio com três origens:

1. Loja física via API Conta Azul

2. E-commerce via API Nuvemshop

3. Tráfego pago Meta Ads



Estrutura geral do dashboard

1. Visão Geral (soma da Loja física + Nuvemshop)

2. Loja Física

3. Nuvemshop

4. Tráfego Pago - Meta Ads

Vou adicionar subtarefas para falar de cada uma das estruturas separadamente.

Aba > Visão Geral

Objetivo

Consolidar os dados da loja física + e-commerce.



Blocos principais

2.1. Faturamento total

• Exibir o faturamento total consolidado

• Fórmula:

• Faturamento total = faturamento loja física + faturamento Nuvemshop

2.2. Participação por canal

• Exibir um gráfico de pizza/donut

• Mostrar a participação de cada canal no faturamento:

• Loja física

• Nuvemshop

2.3. Produtos mais vendidos no consolidado

• Exibir ranking dos produtos mais vendidos considerando os dois canais juntos

• Ideal trazer:

nome do produto
quantidade vendida
faturamento gerado
participação no total


Lucca Cardoso
6d


Aba > Loja Física



Fonte

• Conta Azul API

• A API da Conta Azul possui recursos de vendas com filtros por período e também consulta dos itens da venda, o que atende bem a construção de dashboards de faturamento e ranking de produtos. A autenticação é via OAuth 2.0. ￼

https://login.contaazul.com/#/
aloalo@mirandaestudio.com.br
Contaazul@2014

Blocos principais



3.1. Faturamento

• Exibir faturamento total da loja física no período selecionado



3.2. Produtos mais vendidos

• Ranking dos produtos mais vendidos da loja física

• Ideal trazer:

• nome do produto

• quantidade vendida

• faturamento por produto



3.3. Dados Demográficos

• Gênero

• Idade

• Ticket médio (se puder fazer o filtro por gênero seria ótimo
- Estado (com base no ddd do telefone)

Aba > Nuvemshop



Fonte

• Nuvemshop API

• A Nuvemshop possui recursos de orders, customers e abandoned checkout, o que permite puxar pedidos, produtos comprados, dados de cliente e carrinhos abandonados. ￼


https://www.nuvemshop.com.br/login

luccacoliveira@hotmail.com
@Spinoff2023

Blocos principais

4.1. Faturamento

• Exibir faturamento total do e-commerce no período selecionado

4.2. Produtos mais vendidos

• Ranking dos produtos mais vendidos no e-commerce

• Ideal trazer:

• nome do produto

• quantidade vendida

• faturamento por produto

4.3. Geografia / localização por compra

• Exibir onde estão os compradores

• Cruzar localização com volume de compra

• Pode mostrar:

• cidades com maior número de compras

• estados com maior número de compras

• mapa ou ranking por região

• A Nuvemshop expõe endereço/cidade/estado/país em dados de cliente e checkout, então essa leitura geográfica é viável. ￼

4.4. Gênero por compra

• Exibir distribuição de compras por gênero:

• masculino

• feminino

4.5. Faixa etária por compra

• Exibir distribuição por idade / faixas:

• 18–24

• 25–34

• 35–44

• 45–54

• 55+

4.6. Carrinhos abandonados

• Exibir indicadores de abandono

• Sugestões:

• total de carrinhos abandonados

• valor potencial abandonado

• A API de abandoned checkout existe na Nuvemshop, com acesso aos carrinhos abandonados por até 30 dias após criação

Aba > Tráfego Pago / Meta Ads



Fonte

• Meta Ads

Estrutura sugerida

6.1. Visão geral de mídia

• investimento

• faturamento atribuído

• ROAS

• ticket médio

• CTR

• CPC

• CPM

• alcance

• impressões

• cliques

6.2. Criativos que mais venderam

• Ranking dos criativos com melhor desempenho

• Ideal mostrar:

• nome do criativo / campanha / conjunto

• valor investido

• compras

• faturamento

• ROAS

• CTR

• CPC