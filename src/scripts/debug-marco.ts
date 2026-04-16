/**
 * Diagnóstico Conta Azul — Março 2026
 *
 * Objetivo: entender por que o dashboard mostra R$ 84.423,90 para março
 * enquanto a Miranda reportou R$ 82.944,79 (diff: +R$ 1.479,11).
 *
 * Investigação:
 *  1. Recebíveis com data_vencimento em março 2026
 *     → breakdown por centro de custo
 *     → breakdown por status
 *     → sum(pago) vs sum(total)
 *  2. Comparar com Supabase sales para março (o que o ETL carregou)
 *  3. Detectar vendas cujo pago > valor_venda (indício de parcela somada fora do mês)
 *  4. Listar top 20 recebíveis "sem centro" pra cross-check manual
 *
 * Uso:
 *   npx tsx --env-file=.env.local src/scripts/debug-marco.ts
 */

import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';
import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const BASE = 'https://api-v2.contaazul.com/v1';
const UA = 'Miranda Dashboard Debug (dev@stepads.com.br)';

interface Receb {
  id: string;
  status: string;
  total: number;
  descricao: string;
  data_vencimento: string;
  data_previsao?: string;
  data_pagamento?: string;
  pago: number;
  nao_pago: number;
  centros_de_custo?: Array<{ id: string; nome: string }>;
  cliente?: { id: string; nome: string };
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRecebiveis(
  accessToken: string,
  dataDe: string,
  dataAte: string,
  filterParam: 'data_vencimento' | 'data_pagamento' = 'data_vencimento',
): Promise<Receb[]> {
  const all: Receb[] = [];
  let page = 1;
  const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': UA };

  while (true) {
    await sleep(250);
    const url = `${BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?${filterParam}_de=${dataDe}&${filterParam}_ate=${dataAte}&tamanho_pagina=200&pagina=${page}`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      if (page === 1) {
        const body = await resp.text();
        console.log(`  ⚠ Filter by ${filterParam}: HTTP ${resp.status} — ${body.slice(0, 200)}`);
      }
      return all;
    }

    const json = (await resp.json()) as { itens_totais: number; itens: Receb[] };
    if (json.itens.length === 0) break;
    all.push(...json.itens);
    if (all.length >= json.itens_totais) break;
    page++;
  }

  return all;
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('DEBUG MARÇO 2026 — Conta Azul');
  console.log('========================================\n');

  const supabase = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // 1. Load refresh token from Supabase (fonte da verdade)
  const { data: cfg } = await supabase
    .from('etl_config')
    .select('value')
    .eq('key', 'conta_azul_refresh_token')
    .limit(1);

  const refreshToken = (cfg?.[0]?.value as string) || env('CONTA_AZUL_REFRESH_TOKEN');

  const tokenManager = new ContaAzulTokenManager({
    clientId: env('CONTA_AZUL_CLIENT_ID'),
    clientSecret: env('CONTA_AZUL_CLIENT_SECRET'),
    refreshToken,
    onRefresh: async (tokens) => {
      await supabase.from('etl_config').upsert(
        {
          key: 'conta_azul_refresh_token',
          value: tokens.newRefreshToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
      console.log('  ✅ Refresh token rotated + saved to Supabase\n');
    },
  });

  const accessToken = await tokenManager.getAccessToken();
  console.log('🔑 Token obtained\n');

  // 2. Fetch recebíveis — filtros diferentes
  console.log('📥 Fetching recebiveis com data_vencimento em marco 2026...');
  const byVencimento = await fetchRecebiveis(accessToken, '2026-03-01', '2026-03-31', 'data_vencimento');
  console.log(`   ${byVencimento.length} recebiveis\n`);

  console.log('📥 Fetching recebiveis com data_pagamento em marco 2026 (se API suportar)...');
  const byPagamento = await fetchRecebiveis(accessToken, '2026-03-01', '2026-03-31', 'data_pagamento');
  console.log(`   ${byPagamento.length} recebiveis\n`);

  // 3. Análise do conjunto por VENCIMENTO (critério atual)
  console.log('========================================');
  console.log('ANÁLISE — FILTRO POR VENCIMENTO (atual)');
  console.log('========================================\n');

  // Status breakdown
  const statusMap = new Map<string, { count: number; total: number; pago: number }>();
  for (const r of byVencimento) {
    const s = statusMap.get(r.status) ?? { count: 0, total: 0, pago: 0 };
    s.count += 1;
    s.total += r.total;
    s.pago += r.pago;
    statusMap.set(r.status, s);
  }

  console.log('Por status:');
  for (const [status, s] of [...statusMap.entries()].sort((a, b) => b[1].pago - a[1].pago)) {
    console.log(`  ${status.padEnd(20)} ${String(s.count).padStart(4)} recebíveis | total R$ ${fmt(s.total).padStart(12)} | pago R$ ${fmt(s.pago).padStart(12)}`);
  }

  // Centro de custo breakdown
  const cdcMap = new Map<string, { count: number; total: number; pago: number }>();
  for (const r of byVencimento) {
    const centros = r.centros_de_custo ?? [];
    const key = centros.length === 0 ? '(SEM CENTRO)' : centros.map((c) => c.nome).join(' + ');
    const s = cdcMap.get(key) ?? { count: 0, total: 0, pago: 0 };
    s.count += 1;
    s.total += r.total;
    s.pago += r.pago;
    cdcMap.set(key, s);
  }

  console.log('\nPor centro de custo:');
  for (const [cdc, s] of [...cdcMap.entries()].sort((a, b) => b[1].pago - a[1].pago)) {
    console.log(`  ${cdc.padEnd(40)} ${String(s.count).padStart(4)}x | total R$ ${fmt(s.total).padStart(12)} | pago R$ ${fmt(s.pago).padStart(12)}`);
  }

  // Totais por critério
  const semCentro = byVencimento.filter((r) => (r.centros_de_custo ?? []).length === 0);
  const semCentroPago = semCentro.reduce((sum, r) => sum + r.pago, 0);
  const semCentroTotal = semCentro.reduce((sum, r) => sum + r.total, 0);

  console.log('\n🎯 FILTRO ATUAL DO SYNC (sem centro + vencimento em marco):');
  console.log(`   ${semCentro.length} recebiveis`);
  console.log(`   Sum(pago):  R$ ${fmt(semCentroPago)}`);
  console.log(`   Sum(total): R$ ${fmt(semCentroTotal)}`);

  // 4. Análise por PAGAMENTO (se API respondeu)
  if (byPagamento.length > 0) {
    console.log('\n========================================');
    console.log('ANÁLISE — FILTRO POR DATA DE PAGAMENTO');
    console.log('========================================\n');
    const semCentroPag = byPagamento.filter((r) => (r.centros_de_custo ?? []).length === 0);
    const pagoPag = semCentroPag.reduce((sum, r) => sum + r.pago, 0);
    const totalPag = semCentroPag.reduce((sum, r) => sum + r.total, 0);
    console.log(`🎯 SEM CENTRO + pagamento em marco:`);
    console.log(`   ${semCentroPag.length} recebiveis`);
    console.log(`   Sum(pago):  R$ ${fmt(pagoPag)}`);
    console.log(`   Sum(total): R$ ${fmt(totalPag)}`);
  } else {
    console.log('\n⚠ API nao retornou nada com data_pagamento_de/ate (filtro nao suportado ou sem dados)');
  }

  // 5. Cross-check: Supabase sales de março
  console.log('\n========================================');
  console.log('CROSS-CHECK SUPABASE — sales de marco');
  console.log('========================================\n');

  const { data: salesMar } = await supabase
    .from('sales')
    .select('source_sale_id, sale_date, gross_revenue, net_revenue, status')
    .eq('source', 'conta_azul')
    .gte('sale_date', '2026-03-01T03:00:00Z')
    .lt('sale_date', '2026-04-01T03:00:00Z')
    .limit(10000);

  const salesRows = salesMar ?? [];
  const supaTotal = salesRows.reduce((sum, r) => sum + Number(r.gross_revenue ?? 0), 0);
  const supaNet = salesRows.reduce((sum, r) => sum + Number(r.net_revenue ?? 0), 0);
  console.log(`Sales no Supabase (source=conta_azul, sale_date em marco):`);
  console.log(`   ${salesRows.length} linhas`);
  console.log(`   Sum(gross_revenue): R$ ${fmt(supaTotal)}`);
  console.log(`   Sum(net_revenue):   R$ ${fmt(supaNet)}`);

  // 6. Reconciliação: qual R$ bate R$ 82.944,79?
  console.log('\n========================================');
  console.log('RECONCILIAÇÃO — target R$ 82.944,79');
  console.log('========================================\n');

  const target = 82944.79;
  const candidates: Array<{ label: string; value: number }> = [
    { label: 'Sem centro (venc) pago', value: semCentroPago },
    { label: 'Sem centro (venc) total', value: semCentroTotal },
    { label: 'Supabase sales gross', value: supaTotal },
  ];
  if (byPagamento.length > 0) {
    const semCentroPag = byPagamento.filter((r) => (r.centros_de_custo ?? []).length === 0);
    candidates.push({ label: 'Sem centro (pgto) pago', value: semCentroPag.reduce((s, r) => s + r.pago, 0) });
    candidates.push({ label: 'Sem centro (pgto) total', value: semCentroPag.reduce((s, r) => s + r.total, 0) });
  }

  for (const c of candidates) {
    const diff = c.value - target;
    const pct = ((c.value / target) * 100).toFixed(2);
    const flag = Math.abs(diff) < 1 ? '🎯 MATCH' : Math.abs(diff) < 100 ? '🔥 NEAR' : '';
    console.log(`  ${c.label.padEnd(30)} R$ ${fmt(c.value).padStart(12)} | diff ${diff >= 0 ? '+' : ''}${fmt(diff)} | ${pct}% ${flag}`);
  }

  // 7. Top 20 recebíveis "sem centro" (pra cross-check manual)
  console.log('\n========================================');
  console.log('TOP 20 "sem centro" por pago (cross-check manual)');
  console.log('========================================\n');

  const sorted = [...semCentro].sort((a, b) => b.pago - a.pago).slice(0, 20);
  console.log('idx | data_venc   | status         | pago           | total          | cliente              | desc');
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const cliente = (r.cliente?.nome ?? '—').slice(0, 20).padEnd(20);
    const desc = r.descricao.slice(0, 40);
    console.log(`${String(i + 1).padStart(3)} | ${r.data_vencimento.slice(0, 10)} | ${r.status.padEnd(14)} | R$ ${fmt(r.pago).padStart(11)} | R$ ${fmt(r.total).padStart(11)} | ${cliente} | ${desc}`);
  }

  // 8. Shape de um recebível (pra ver quais campos existem)
  console.log('\n========================================');
  console.log('SHAPE DE UM RECEBÍVEL (primeiro da lista)');
  console.log('========================================\n');
  if (byVencimento[0]) {
    console.log(JSON.stringify(byVencimento[0], null, 2));
  }

  // 9. Sanity check: sales com o mesmo source_sale_id múltiplos venda no Supabase
  console.log('\n========================================');
  console.log('DUPLICATAS — sales com gross > net ou com source_sale_id estranho');
  console.log('========================================\n');

  const suspiciousSales = salesRows
    .filter((r) => {
      const gross = Number(r.gross_revenue ?? 0);
      const net = Number(r.net_revenue ?? 0);
      return Math.abs(gross - net) > 0.5;
    })
    .sort((a, b) => Math.abs(Number(b.gross_revenue) - Number(b.net_revenue)) - Math.abs(Number(a.gross_revenue) - Number(a.net_revenue)))
    .slice(0, 10);

  console.log(`Sales com |gross - net| > 0.50: ${suspiciousSales.length}`);
  for (const s of suspiciousSales) {
    const gross = Number(s.gross_revenue);
    const net = Number(s.net_revenue);
    console.log(`  ${(s.source_sale_id as string).slice(0, 40).padEnd(40)} | sale_date ${(s.sale_date as string).slice(0, 10)} | gross R$ ${fmt(gross).padStart(11)} | net R$ ${fmt(net).padStart(11)}`);
  }

  // 10. source_sale_id começando com "receb-" (fallback createSaleFromRecebivel)
  const receboIds = salesRows.filter((s) => (s.source_sale_id as string).startsWith('receb-'));
  console.log(`\nSales criados via fallback "receb-*" (createSaleFromRecebivel): ${receboIds.length}`);
  console.log(`   Sum(gross): R$ ${fmt(receboIds.reduce((s, r) => s + Number(r.gross_revenue), 0))}`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
