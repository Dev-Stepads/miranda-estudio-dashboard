/**
 * Check what centers are included in the current data and compare to Miranda target.
 * Uses the raw recebiveis API to understand what's being included/excluded.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSupabaseAdmin } from '../lib/supabase.ts';
import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';

const sb = createSupabaseAdmin({
  url: process.env.SUPABASE_URL!,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
});

function tryUpdateEnvFile(t: string) {
  try {
    const p = path.resolve('.env.local');
    let c = fs.readFileSync(p, 'utf-8');
    c = c.replace(/^CONTA_AZUL_REFRESH_TOKEN=.+$/m, `CONTA_AZUL_REFRESH_TOKEN=${t}`);
    fs.writeFileSync(p, c, 'utf-8');
  } catch {}
}

const BASE = 'https://api-v2.contaazul.com/v1';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface RecebItem {
  total: number; pago: number; descricao: string;
  centros_de_custo?: Array<{ nome: string }>;
}

async function main() {
  // DB numbers
  const { data: marchCA } = await sb.from('sales').select('gross_revenue').eq('source', 'conta_azul').gte('sale_date', '2026-03-01').lte('sale_date', '2026-03-31').limit(10000);
  const caTotal = (marchCA ?? []).reduce((s: number, r: any) => s + r.gross_revenue, 0);
  console.log(`DB Loja Física março: ${marchCA?.length} vendas, R$ ${caTotal.toFixed(2)}`);
  console.log(`Miranda target: R$ 82.944,79`);
  console.log(`Excesso: R$ ${(caTotal - 82944.79).toFixed(2)}\n`);

  // Fetch recebiveis to understand centers
  const { data: configData } = await sb.from('etl_config').select('value').eq('key', 'conta_azul_refresh_token').limit(1);
  const refreshToken = (configData?.[0]?.value as string) ?? process.env.CONTA_AZUL_REFRESH_TOKEN!;
  const tm = new ContaAzulTokenManager({
    clientId: process.env.CONTA_AZUL_CLIENT_ID!, clientSecret: process.env.CONTA_AZUL_CLIENT_SECRET!, refreshToken,
    onRefresh: async (t) => {
      await sb.from('etl_config').upsert({ key: 'conta_azul_refresh_token', value: t.newRefreshToken, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      tryUpdateEnvFile(t.newRefreshToken);
    },
  });
  const token = await tm.getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'probe' };

  const all: RecebItem[] = [];
  let page = 1;
  while (true) {
    await sleep(250);
    const r = await fetch(`${BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?data_vencimento_de=2026-03-01&data_vencimento_ate=2026-03-31&tamanho_pagina=200&pagina=${page}`, { headers });
    if (!r.ok) break;
    const j = await r.json() as { itens_totais: number; itens: RecebItem[] };
    if (j.itens.length === 0) break;
    all.push(...j.itens);
    if (all.length >= j.itens_totais) break;
    page++;
  }

  // Group by center
  const byCentro = new Map<string, { count: number; total: number; pago: number }>();
  for (const item of all) {
    const centro = item.centros_de_custo?.[0]?.nome ?? '(sem centro)';
    const e = byCentro.get(centro) ?? { count: 0, total: 0, pago: 0 };
    e.count++; e.total += item.total; e.pago += item.pago;
    byCentro.set(centro, e);
  }

  console.log('RECEBIVEIS MARÇO — por centro de custo:');
  for (const [c, s] of [...byCentro.entries()].sort((a, b) => b[1].pago - a[1].pago)) {
    console.log(`  ${c}: ${s.count} itens, pago=R$ ${s.pago.toFixed(2)}, total=R$ ${s.total.toFixed(2)}`);
  }

  // Test: sem centro only
  const semCentro = all.filter(r => !r.centros_de_custo || r.centros_de_custo.length === 0);
  const semCentroPago = semCentro.reduce((s, r) => s + r.pago, 0);
  console.log(`\nAPENAS "sem centro": R$ ${semCentroPago.toFixed(2)} (diff: ${(semCentroPago - 82944.79).toFixed(2)})`);

  // Test: sem centro + VENDAS LOJA
  const vendasLoja = all.filter(r => r.centros_de_custo?.some(c => c.nome === 'VENDAS LOJA'));
  const vlPago = vendasLoja.reduce((s, r) => s + r.pago, 0);
  console.log(`sem centro + VENDAS LOJA: R$ ${(semCentroPago + vlPago).toFixed(2)} (diff: ${(semCentroPago + vlPago - 82944.79).toFixed(2)})`);

  // What is currently included (excl VENDAS SITE + ADMIN)
  const included = all.filter(r => {
    const centros = r.centros_de_custo ?? [];
    if (centros.length === 0) return true;
    return !centros.some(c => ['VENDAS SITE', 'ADMINISTRATIVO'].includes(c.nome));
  });
  const includedPago = included.reduce((s, r) => s + r.pago, 0);
  console.log(`Excl SITE+ADMIN (current filter): R$ ${includedPago.toFixed(2)} (diff: ${(includedPago - 82944.79).toFixed(2)})`);

  // Only vendas in included
  const includedVendas = included.filter(r => /Venda \d+/.test(r.descricao));
  const includedVendasPago = includedVendas.reduce((s, r) => s + r.pago, 0);
  console.log(`Excl SITE+ADMIN vendas only: R$ ${includedVendasPago.toFixed(2)} (diff: ${(includedVendasPago - 82944.79).toFixed(2)})`);
}
main();
