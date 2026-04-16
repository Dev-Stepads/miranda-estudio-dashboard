/**
 * Compara totais.aprovado da API CA vs sum(CA) do Supabase por mês.
 * Se algum mês tiver drift, indica que o sync falhou naquele mês.
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

const BASE = 'https://api-v2.contaazul.com/v1';
const UA = 'Miranda Dashboard Compare (dev@stepads.com.br)';

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const supabase = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const { data: cfg } = await supabase.from('etl_config').select('value').eq('key', 'conta_azul_refresh_token').limit(1);
  const refreshToken = (cfg?.[0]?.value as string) || env('CONTA_AZUL_REFRESH_TOKEN');

  const tm = new ContaAzulTokenManager({
    clientId: env('CONTA_AZUL_CLIENT_ID'),
    clientSecret: env('CONTA_AZUL_CLIENT_SECRET'),
    refreshToken,
    onRefresh: async (tokens) => {
      await supabase.from('etl_config').upsert(
        { key: 'conta_azul_refresh_token', value: tokens.newRefreshToken, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    },
  });
  const token = await tm.getAccessToken();

  const months = [
    { label: '2025-11', from: '2025-11-01', to: '2025-11-30' },
    { label: '2025-12', from: '2025-12-01', to: '2025-12-31' },
    { label: '2026-01', from: '2026-01-01', to: '2026-01-31' },
    { label: '2026-02', from: '2026-02-01', to: '2026-02-28' },
    { label: '2026-03', from: '2026-03-01', to: '2026-03-31' },
    { label: '2026-04', from: '2026-04-01', to: '2026-04-30' },
  ];

  console.log('========================================');
  console.log('API vs SUPABASE — Comparison by Month');
  console.log('========================================\n');
  console.log('month   | API aprovado  | Supa CA all   | diff          | API items | Supa count');
  console.log('--------|---------------|---------------|---------------|-----------|-----------');

  for (const m of months) {
    await sleep(500);
    const resp = await fetch(
      `${BASE}/venda/busca?data_inicio=${m.from}&data_fim=${m.to}&tamanho_pagina=200&pagina=1`,
      {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      },
    );

    if (!resp.ok) {
      console.log(`  ${m.label}: HTTP ${resp.status}`);
      continue;
    }

    const json = (await resp.json()) as {
      totais: { aprovado: number; esperando_aprovacao: number; total: number };
      quantidades: { total: number };
      total_itens: number;
    };

    const apiAprovado = json.totais.aprovado;
    const apiCount = json.quantidades.total;

    // Supa: paginated
    const supa: Array<{ gross_revenue: number }> = [];
    const PAGE = 1000;
    let p = 0;
    while (true) {
      const { data } = await supabase
        .from('sales')
        .select('gross_revenue')
        .eq('source', 'conta_azul')
        .gte('sale_date', `${m.from}T03:00:00Z`)
        .lt('sale_date', p === 0 ? `${m.to}T23:59:59Z` : `${m.to}T23:59:59Z`)
        .order('sale_id', { ascending: true })
        .range(p * PAGE, (p + 1) * PAGE - 1);
      if (!data || data.length === 0) break;
      supa.push(...(data as Array<{ gross_revenue: number }>));
      if (data.length < PAGE) break;
      p++;
    }

    const supaSum = supa.reduce((s, r) => s + Number(r.gross_revenue), 0);
    const diff = supaSum - apiAprovado;
    const marker = Math.abs(diff) < 1 ? '🎯' : Math.abs(diff) < 100 ? '🔥' : '⚠️';

    console.log(
      `${m.label} | R$ ${fmt(apiAprovado).padStart(10)} | R$ ${fmt(supaSum).padStart(10)} | ${fmt(diff).padStart(10)} | ${String(apiCount).padStart(9)} | ${String(supa.length).padStart(9)} ${marker}`,
    );
  }
}

main().catch(console.error);
