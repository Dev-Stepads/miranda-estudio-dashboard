/**
 * Continuação — cruzar TODOS os meses CA com API totais.aprovado
 * + investigar sales com gross=0
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/validate-api-months.ts
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

  // Pegar totais mensais do banco via view
  const { data: allDaily } = await sb
    .from('v_visao_geral_daily')
    .select('day, source, gross_revenue')
    .eq('source', 'conta_azul')
    .order('day', { ascending: true })
    .limit(50000);

  const caByMonth = new Map<string, number>();
  for (const r of allDaily ?? []) {
    const month = (r.day as string).slice(0, 7);
    caByMonth.set(month, (caByMonth.get(month) ?? 0) + Number(r.gross_revenue));
  }

  const months = [...caByMonth.keys()].filter(m => (caByMonth.get(m) ?? 0) > 0).sort();

  console.log('========================================');
  console.log('CA BANCO vs API — TODOS OS MESES');
  console.log('========================================\n');
  console.log('Mês       | Banco           | API aprovado    | Diff            | Status');
  console.log('-'.repeat(95));

  let totalBanco = 0, totalAPI = 0;
  const diffs: Array<{ month: string; banco: number; api: number; diff: number }> = [];

  for (const month of months) {
    const [year, mon] = month.split('-');
    const lastDay = new Date(Number(year), Number(mon), 0).getDate();
    const from = `${month}-01`;
    const to = `${month}-${lastDay}`;

    await sleep(350);
    const url = `${BASE}/venda/busca?data_inicio=${from}&data_fim=${to}&tamanho_pagina=1`;
    const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': UA };

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.log(`${month}   | R$ ${fmt(caByMonth.get(month)!).padStart(12)} | HTTP ${resp.status}        |                 | ⚠`);
        continue;
      }
      const json = await resp.json() as { totais?: { aprovado?: number } };
      const apiAprovado = json.totais?.aprovado ?? 0;
      const banco = caByMonth.get(month)!;
      const diff = banco - apiAprovado;

      totalBanco += banco;
      totalAPI += apiAprovado;
      diffs.push({ month, banco, api: apiAprovado, diff });

      const status = Math.abs(diff) < 0.01 ? '✅' : Math.abs(diff) < 1 ? '✅~' : '❌';
      console.log(
        `${month}   | R$ ${fmt(banco).padStart(12)} | R$ ${fmt(apiAprovado).padStart(12)} | ${diff >= 0 ? '+' : ''}R$ ${fmt(diff).padStart(11)} | ${status}`
      );
    } catch {
      console.log(`${month}   | R$ ${fmt(caByMonth.get(month)!).padStart(12)} | NETWORK ERROR   |                 | ⚠`);
    }
  }

  console.log('-'.repeat(95));
  console.log(`TOTAL     | R$ ${fmt(totalBanco).padStart(12)} | R$ ${fmt(totalAPI).padStart(12)} | ${totalBanco - totalAPI >= 0 ? '+' : ''}R$ ${fmt(totalBanco - totalAPI).padStart(11)} |`);

  // Issues
  const problems = diffs.filter(d => Math.abs(d.diff) >= 1);
  if (problems.length > 0) {
    console.log(`\n❌ ${problems.length} mês(es) com diferença >= R$ 1,00:`);
    for (const p of problems) {
      console.log(`   ${p.month}: banco R$ ${fmt(p.banco)} vs API R$ ${fmt(p.api)} → diff R$ ${fmt(p.diff)}`);
    }
  } else {
    console.log('\n✅ Todos os meses batem com a API.');
  }

  // Investigar sales com gross=0
  console.log('\n========================================');
  console.log('SALES COM GROSS = 0 (investigação)');
  console.log('========================================\n');

  const { data: zeroSales, count: zeroCount } = await sb
    .from('sales')
    .select('sale_id, source, source_sale_id, sale_date, gross_revenue, net_revenue, status', { count: 'exact' })
    .eq('gross_revenue', 0)
    .limit(20);

  console.log(`Total: ${zeroCount}`);
  const bySource = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const s of zeroSales ?? []) {
    bySource.set(s.source as string, (bySource.get(s.source as string) ?? 0) + 1);
    byStatus.set(s.status as string, (byStatus.get(s.status as string) ?? 0) + 1);
  }
  console.log('Por source (amostra 20):', Object.fromEntries(bySource));
  console.log('Por status (amostra 20):', Object.fromEntries(byStatus));

  console.log('\nAmostra:');
  for (const s of (zeroSales ?? []).slice(0, 10)) {
    console.log(`  ${s.source} | ${s.status} | ${(s.source_sale_id as string).slice(0, 35).padEnd(35)} | ${(s.sale_date as string).slice(0, 10)} | net R$ ${fmt(Number(s.net_revenue))}`);
  }

  // Impacto no dashboard: views filtram status='paid', gross=0 não afeta soma mas afeta contagem
  const { count: zeroPaid } = await sb
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('gross_revenue', 0)
    .eq('status', 'paid');
  console.log(`\nSales gross=0 com status='paid' (afetam contagem no dashboard): ${zeroPaid}`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
