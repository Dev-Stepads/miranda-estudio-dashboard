/**
 * Investigar issues encontradas na validação:
 * 1. Nov 2025: banco R$ 43.721 vs API R$ 122.983 (faltam R$ 79.262)
 * 2. 152 sales com gross=0 mas status=paid
 * 3. Meses Dez/2025 a Abr/2026 — verificar se também têm gap
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/investigate-issues.ts
 */

import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';
import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const BASE = 'https://api-v2.contaazul.com/v1';
const UA = 'Miranda Dashboard Validation (dev@stepads.com.br)';

async function main(): Promise<void> {
  const sb = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // Token
  const { data: cfg } = await sb.from('etl_config').select('value').eq('key', 'conta_azul_refresh_token').limit(1);
  const refreshToken = (cfg?.[0]?.value as string) || env('CONTA_AZUL_REFRESH_TOKEN');
  const tokenManager = new ContaAzulTokenManager({
    clientId: env('CONTA_AZUL_CLIENT_ID'),
    clientSecret: env('CONTA_AZUL_CLIENT_SECRET'),
    refreshToken,
    onRefresh: async (tokens) => {
      await sb.from('etl_config').upsert(
        { key: 'conta_azul_refresh_token', value: tokens.newRefreshToken, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    },
  });
  const accessToken = await tokenManager.getAccessToken();
  console.log('Token obtido.\n');

  // ============================================================
  // ISSUE 1: Nov 2025 — banco falta R$ 79.262
  // Hipótese: sync histórico cobriu Jan 2023 a Out 2025.
  // Nov 2025 pode ter dados parciais do sync antigo (recebíveis)
  // que foi substituído pelo sync de vendas, mas Nov 2025 ficou
  // entre os dois períodos de sync.
  // ============================================================
  console.log('========================================');
  console.log('ISSUE 1: Nov 2025 — gap R$ 79.262');
  console.log('========================================\n');

  // Verificar meses Nov 2025 a Abr 2026 (pós-sync histórico)
  const checkMonths = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'];
  const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': UA };

  console.log('Mês       | Banco (view)    | API aprovado    | Diff            | Sales count');
  console.log('-'.repeat(90));

  for (const month of checkMonths) {
    const [year, mon] = month.split('-');
    const lastDay = new Date(Number(year), Number(mon), 0).getDate();
    const from = `${month}-01`;
    const to = `${month}-${lastDay}`;

    // Banco
    const { data: viewRows } = await sb
      .from('v_visao_geral_daily')
      .select('gross_revenue, orders_count')
      .eq('source', 'conta_azul')
      .gte('day', from)
      .lte('day', to)
      .limit(10000);

    const bancoRevenue = (viewRows ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const bancoOrders = (viewRows ?? []).reduce((s, r) => s + Number(r.orders_count), 0);

    // API
    await sleep(350);
    const url = `${BASE}/venda/busca?data_inicio=${from}&data_fim=${to}&tamanho_pagina=1`;
    let apiAprovado = 0;
    let apiItens = 0;
    try {
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        const json = await resp.json() as { totais?: { aprovado?: number }; itens_totais?: number };
        apiAprovado = json.totais?.aprovado ?? 0;
        apiItens = json.itens_totais ?? 0;
      }
    } catch {}

    const diff = bancoRevenue - apiAprovado;
    const status = Math.abs(diff) < 1 ? '✅' : '❌';
    console.log(
      `${month}   | R$ ${fmt(bancoRevenue).padStart(12)} | R$ ${fmt(apiAprovado).padStart(12)} | ${diff >= 0 ? '+' : ''}R$ ${fmt(diff).padStart(11)} | banco: ${bancoOrders}, API: ${apiItens} ${status}`
    );
  }

  // Contar sales de Nov 2025 por tipo de source_sale_id
  console.log('\nDetalhamento Nov 2025:');
  const { data: novSales } = await sb
    .from('sales')
    .select('source_sale_id, gross_revenue, sale_date')
    .eq('source', 'conta_azul')
    .eq('status', 'paid')
    .gte('sale_date', '2025-11-01T03:00:00Z')
    .lt('sale_date', '2025-12-01T03:00:00Z')
    .limit(10000);

  const novRows = novSales ?? [];
  const novNstag = novRows.filter(r => (r.source_sale_id as string).startsWith('nstag-'));
  const novRegular = novRows.filter(r => !(r.source_sale_id as string).startsWith('nstag-'));
  const novGrossZero = novRows.filter(r => Number(r.gross_revenue) === 0);

  console.log(`  Total sales CA em Nov: ${novRows.length}`);
  console.log(`  nstag (NS): ${novNstag.length} | R$ ${fmt(novNstag.reduce((s, r) => s + Number(r.gross_revenue), 0))}`);
  console.log(`  Regular (loja): ${novRegular.length} | R$ ${fmt(novRegular.reduce((s, r) => s + Number(r.gross_revenue), 0))}`);
  console.log(`  Gross=0: ${novGrossZero.length}`);
  console.log(`  Sum gross total: R$ ${fmt(novRows.reduce((s, r) => s + Number(r.gross_revenue), 0))}`);

  // ============================================================
  // ISSUE 2: 152 sales com gross=0
  // ============================================================
  console.log('\n========================================');
  console.log('ISSUE 2: Sales com gross=0 (152)');
  console.log('========================================\n');

  const { data: zeroSales } = await sb
    .from('sales')
    .select('sale_id, source, source_sale_id, sale_date, gross_revenue, net_revenue, status')
    .eq('gross_revenue', 0)
    .eq('status', 'paid')
    .order('sale_date', { ascending: true })
    .limit(200);

  // Agrupar por mês
  const zeroByMonth = new Map<string, { count: number; netSum: number }>();
  for (const s of zeroSales ?? []) {
    const month = (s.sale_date as string).slice(0, 7);
    const entry = zeroByMonth.get(month) ?? { count: 0, netSum: 0 };
    entry.count += 1;
    entry.netSum += Number(s.net_revenue ?? 0);
    zeroByMonth.set(month, entry);
  }

  console.log('Distribuição por mês:');
  console.log('Mês       | Count | Net Revenue perdida');
  for (const [month, m] of [...zeroByMonth.entries()].sort()) {
    console.log(`${month}   | ${String(m.count).padStart(5)} | R$ ${fmt(m.netSum)}`);
  }

  // Verificar na API se essas vendas têm total > 0
  console.log('\nVerificando 10 amostras na API (venda/{id})...');
  const samples = (zeroSales ?? []).slice(0, 10);
  for (const s of samples) {
    const vendaId = s.source_sale_id as string;
    await sleep(300);
    try {
      const resp = await fetch(`${BASE}/venda/${vendaId}`, { headers });
      if (resp.ok) {
        const venda = await resp.json() as { total?: number; situacao?: string; data?: string };
        console.log(`  ${vendaId.slice(0, 30)} | banco gross=0 | API total=R$ ${fmt(venda.total ?? 0)} | situacao=${venda.situacao ?? '?'}`);
      } else {
        console.log(`  ${vendaId.slice(0, 30)} | HTTP ${resp.status}`);
      }
    } catch {
      console.log(`  ${vendaId.slice(0, 30)} | FETCH ERROR`);
    }
  }

  // ============================================================
  // ISSUE 3: Sale items coverage (amostras maiores)
  // ============================================================
  console.log('\n========================================');
  console.log('ISSUE 3: Sales sem items por fonte');
  console.log('========================================\n');

  // CA
  const { count: caSalesCount } = await sb.from('sales').select('*', { count: 'exact', head: true }).eq('source', 'conta_azul').eq('status', 'paid');
  const { count: caItemsDistinct } = await sb.from('sale_items').select('sale_id', { count: 'exact', head: true });

  // Contar sales CA que têm pelo menos 1 item
  const { data: caWithItems } = await sb.rpc('count_sales_with_items', {});
  // Fallback: verificar por amostra
  const { data: caSample } = await sb
    .from('sales')
    .select('sale_id')
    .eq('source', 'conta_azul')
    .eq('status', 'paid')
    .order('sale_date', { ascending: false })
    .limit(100);

  let caWithItemsCount = 0;
  for (const s of caSample ?? []) {
    const { count } = await sb.from('sale_items').select('*', { count: 'exact', head: true }).eq('sale_id', s.sale_id);
    if ((count ?? 0) > 0) caWithItemsCount++;
  }

  console.log(`CA: ${caWithItemsCount}/100 das sales mais recentes têm items`);

  // NS
  const { data: nsSample } = await sb
    .from('sales')
    .select('sale_id')
    .eq('source', 'nuvemshop')
    .eq('status', 'paid')
    .order('sale_date', { ascending: false })
    .limit(100);

  let nsWithItemsCount = 0;
  for (const s of nsSample ?? []) {
    const { count } = await sb.from('sale_items').select('*', { count: 'exact', head: true }).eq('sale_id', s.sale_id);
    if ((count ?? 0) > 0) nsWithItemsCount++;
  }

  console.log(`NS: ${nsWithItemsCount}/100 das sales mais recentes têm items`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
