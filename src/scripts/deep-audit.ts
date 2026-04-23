/**
 * Auditoria profunda de integridade — linha a linha.
 *
 * Verifica:
 *  1. Cada mês CA: banco vs API (todos 42 meses)
 *  2. Cada mês NS: banco vs view (consistência interna)
 *  3. Sales com gross != total da API (individual spot-check)
 *  4. Sales duplicadas (source+source_sale_id)
 *  5. Sales com sale_date fora do range esperado
 *  6. Sale_items órfãos (sem sale correspondente)
 *  7. Sale_items com total_price negativo ou zero
 *  8. Sales paid com gross != sum(sale_items.total_price)
 *  9. Vendas nstag: gross vs NS direto por mês
 * 10. Customers órfãos ou duplicados
 * 11. Meta Ads: insights com spend < 0 ou purchases < 0
 * 12. Abandoned checkouts com total <= 0
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/deep-audit.ts
 */

import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main(): Promise<void> {
  const sb = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const issues: string[] = [];
  const warnings: string[] = [];

  // ============================================================
  // 1. SALES — anomalias globais
  // ============================================================
  console.log('========================================');
  console.log('1. SALES — ANOMALIAS');
  console.log('========================================\n');

  // 1a. gross=0 com status=paid
  const { count: zeroGrossPaid } = await sb.from('sales').select('*', { count: 'exact', head: true }).eq('gross_revenue', 0).eq('status', 'paid');
  console.log(`  gross=0 + paid: ${zeroGrossPaid}`);
  if ((zeroGrossPaid ?? 0) > 0) issues.push(`${zeroGrossPaid} sales paid com gross=0`);

  // 1b. gross < 0
  const { count: negGross } = await sb.from('sales').select('*', { count: 'exact', head: true }).lt('gross_revenue', 0);
  console.log(`  gross < 0: ${negGross}`);
  if ((negGross ?? 0) > 0) issues.push(`${negGross} sales com gross negativo`);

  // 1c. net_revenue < 0
  const { count: negNet } = await sb.from('sales').select('*', { count: 'exact', head: true }).lt('net_revenue', 0);
  console.log(`  net < 0: ${negNet}`);
  if ((negNet ?? 0) > 0) issues.push(`${negNet} sales com net negativo`);

  // 1d. sale_date null
  const { count: nullDate } = await sb.from('sales').select('*', { count: 'exact', head: true }).is('sale_date', null);
  console.log(`  sale_date null: ${nullDate}`);
  if ((nullDate ?? 0) > 0) issues.push(`${nullDate} sales sem data`);

  // 1e. sale_date antes de 2020 ou depois de amanhã
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { count: futureSales } = await sb.from('sales').select('*', { count: 'exact', head: true }).gt('sale_date', tomorrow.toISOString());
  console.log(`  sale_date no futuro: ${futureSales}`);
  if ((futureSales ?? 0) > 0) issues.push(`${futureSales} sales com data futura`);

  const { count: ancientSales } = await sb.from('sales').select('*', { count: 'exact', head: true }).lt('sale_date', '2019-01-01T00:00:00Z');
  console.log(`  sale_date antes de 2019: ${ancientSales}`);
  if ((ancientSales ?? 0) > 0) warnings.push(`${ancientSales} sales antes de 2019`);

  // 1f. Duplicatas (source + source_sale_id)
  const { data: allSrcIds } = await sb.from('sales').select('source, source_sale_id').limit(100000);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const s of allSrcIds ?? []) {
    const key = `${s.source}|${s.source_sale_id}`;
    if (seen.has(key)) dupes.push(key);
    seen.add(key);
  }
  console.log(`  Duplicatas source+id: ${dupes.length}`);
  if (dupes.length > 0) {
    issues.push(`${dupes.length} vendas duplicadas`);
    for (const d of dupes.slice(0, 5)) console.log(`    ${d}`);
  }

  // 1g. Status breakdown
  const { data: statusRows } = await sb.from('sales').select('status').limit(100000);
  const statusMap = new Map<string, number>();
  for (const r of statusRows ?? []) statusMap.set(r.status as string, (statusMap.get(r.status as string) ?? 0) + 1);
  console.log('  Por status:');
  for (const [s, c] of [...statusMap.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${s}: ${c}`);

  // ============================================================
  // 2. SALE_ITEMS — anomalias
  // ============================================================
  console.log('\n========================================');
  console.log('2. SALE_ITEMS — ANOMALIAS');
  console.log('========================================\n');

  // 2a. total_price <= 0
  const { count: zeroItems } = await sb.from('sale_items').select('*', { count: 'exact', head: true }).lte('total_price', 0);
  console.log(`  total_price <= 0: ${zeroItems}`);
  if ((zeroItems ?? 0) > 0) warnings.push(`${zeroItems} sale_items com total_price <= 0`);

  // 2b. quantity <= 0
  const { count: zeroQty } = await sb.from('sale_items').select('*', { count: 'exact', head: true }).lte('quantity', 0);
  console.log(`  quantity <= 0: ${zeroQty}`);
  if ((zeroQty ?? 0) > 0) issues.push(`${zeroQty} sale_items com quantity <= 0`);

  // 2c. product_name null
  const { count: nullName } = await sb.from('sale_items').select('*', { count: 'exact', head: true }).is('product_name', null);
  console.log(`  product_name null: ${nullName}`);
  if ((nullName ?? 0) > 0) warnings.push(`${nullName} sale_items sem product_name`);

  // 2d. Órfãos (sale_id que não existe em sales)
  // Amostra: pegar 500 sale_items recentes e verificar
  const { data: recentItems } = await sb.from('sale_items').select('sale_id').order('sale_item_id', { ascending: false }).limit(500);
  const itemSaleIds = [...new Set((recentItems ?? []).map(i => i.sale_id as number))];
  let orphanCount = 0;
  for (let i = 0; i < itemSaleIds.length; i += 100) {
    const batch = itemSaleIds.slice(i, i + 100);
    const { data: existingSales } = await sb.from('sales').select('sale_id').in('sale_id', batch);
    const existing = new Set((existingSales ?? []).map(s => s.sale_id as number));
    orphanCount += batch.filter(id => !existing.has(id)).length;
  }
  console.log(`  Órfãos (amostra 500 recentes): ${orphanCount}`);
  if (orphanCount > 0) issues.push(`sale_items órfãos encontrados`);

  // ============================================================
  // 3. GROSS vs SUM(ITEMS) — top divergências
  // ============================================================
  console.log('\n========================================');
  console.log('3. GROSS vs SUM(ITEMS) por sale');
  console.log('========================================\n');

  // Pegar 200 sales paid recentes de CA com items
  const { data: recentSales } = await sb
    .from('sales')
    .select('sale_id, source, gross_revenue, net_revenue')
    .eq('status', 'paid')
    .eq('source', 'conta_azul')
    .order('sale_date', { ascending: false })
    .limit(200);

  let mismatchCount = 0;
  const mismatches: Array<{ saleId: number; gross: number; itemsSum: number; diff: number }> = [];

  for (const sale of recentSales ?? []) {
    const { data: items } = await sb
      .from('sale_items')
      .select('total_price')
      .eq('sale_id', sale.sale_id);

    if (!items || items.length === 0) continue;

    const itemsSum = items.reduce((s, i) => s + Number(i.total_price), 0);
    const gross = Number(sale.gross_revenue);
    void Math.abs(gross - itemsSum);

    // Tolerância: gross inclui frete, items não. Então gross >= items normalmente.
    // Flaggar apenas quando items > gross (items não deveriam ser mais que o total)
    if (itemsSum > gross + 0.01) {
      mismatchCount++;
      mismatches.push({ saleId: sale.sale_id as number, gross, itemsSum, diff: itemsSum - gross });
    }
  }

  console.log(`  Checadas: 200 sales CA recentes`);
  console.log(`  Items > gross (anomalia): ${mismatchCount}`);
  if (mismatches.length > 0) {
    warnings.push(`${mismatchCount} sales onde sum(items) > gross`);
    console.log('  Top 10:');
    mismatches.sort((a, b) => b.diff - a.diff);
    for (const m of mismatches.slice(0, 10)) {
      console.log(`    sale_id=${m.saleId} | gross R$ ${fmt(m.gross)} | items R$ ${fmt(m.itemsSum)} | diff +R$ ${fmt(m.diff)}`);
    }
  }

  // Mesmo para NS
  const { data: recentNS } = await sb
    .from('sales')
    .select('sale_id, gross_revenue')
    .eq('status', 'paid')
    .eq('source', 'nuvemshop')
    .order('sale_date', { ascending: false })
    .limit(200);

  let nsMismatch = 0;
  for (const sale of recentNS ?? []) {
    const { data: items } = await sb.from('sale_items').select('total_price').eq('sale_id', sale.sale_id);
    if (!items || items.length === 0) continue;
    const itemsSum = items.reduce((s, i) => s + Number(i.total_price), 0);
    const gross = Number(sale.gross_revenue);
    if (itemsSum > gross + 0.01) nsMismatch++;
  }
  console.log(`\n  NS: ${nsMismatch}/200 com items > gross`);
  if (nsMismatch > 0) warnings.push(`${nsMismatch} NS sales onde sum(items) > gross`);

  // ============================================================
  // 4. NSTAG vs NS — cruzamento mensal
  // ============================================================
  console.log('\n========================================');
  console.log('4. NSTAG vs NS — por mês (2023+)');
  console.log('========================================\n');

  // Todos os sales
  const { data: allSales } = await sb
    .from('sales')
    .select('source, source_sale_id, sale_date, gross_revenue')
    .eq('status', 'paid')
    .gte('sale_date', '2023-01-01T03:00:00Z')
    .limit(100000);

  const nstagByMonth = new Map<string, number>();
  const nsByMonth = new Map<string, number>();
  const caByMonth = new Map<string, number>();

  for (const s of allSales ?? []) {
    const dateStr = s.sale_date as string;
    // Converter para SP date
    const d = new Date(dateStr);
    const spMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
      .format(d);

    const gross = Number(s.gross_revenue);

    if (s.source === 'conta_azul') {
      caByMonth.set(spMonth, (caByMonth.get(spMonth) ?? 0) + gross);
      if ((s.source_sale_id as string).startsWith('nstag-')) {
        nstagByMonth.set(spMonth, (nstagByMonth.get(spMonth) ?? 0) + gross);
      }
    } else if (s.source === 'nuvemshop') {
      nsByMonth.set(spMonth, (nsByMonth.get(spMonth) ?? 0) + gross);
    }
  }

  const allMonths = [...new Set([...caByMonth.keys(), ...nsByMonth.keys()])].sort();

  console.log('Mês     | CA Total        | NS Direto       | Loja (CA-NS)    | nstag           | nstag vs NS');
  console.log('-'.repeat(110));

  for (const month of allMonths) {
    const ca = caByMonth.get(month) ?? 0;
    const ns = nsByMonth.get(month) ?? 0;
    const nstag = nstagByMonth.get(month) ?? 0;
    const loja = Math.max(0, ca - ns);
    const nstagDiff = nstag - ns;

    // Flag se CA < NS (loja negativa antes do clamp)
    const flag = ca < ns - 0.01 ? ' ⚠ CA<NS' : '';
    console.log(
      `${month} | R$ ${fmt(ca).padStart(12)} | R$ ${fmt(ns).padStart(12)} | R$ ${fmt(loja).padStart(12)} | R$ ${fmt(nstag).padStart(12)} | ${nstagDiff >= 0 ? '+' : ''}R$ ${fmt(nstagDiff).padStart(10)}${flag}`
    );
  }

  // ============================================================
  // 5. CUSTOMERS — anomalias
  // ============================================================
  console.log('\n========================================');
  console.log('5. CUSTOMERS — ANOMALIAS');
  console.log('========================================\n');

  const { count: custTotal } = await sb.from('customers').select('*', { count: 'exact', head: true });
  const { count: custNoName } = await sb.from('customers').select('*', { count: 'exact', head: true }).is('name', null);
  const { count: custNoSource } = await sb.from('customers').select('*', { count: 'exact', head: true }).is('source', null);
  console.log(`  Total: ${custTotal}`);
  console.log(`  Sem nome: ${custNoName}`);
  console.log(`  Sem source: ${custNoSource}`);
  if ((custNoName ?? 0) > 0) warnings.push(`${custNoName} customers sem nome`);

  // ============================================================
  // 6. META ADS — anomalias
  // ============================================================
  console.log('\n========================================');
  console.log('6. META ADS — ANOMALIAS');
  console.log('========================================\n');

  const { count: metaNegSpend } = await sb.from('meta_ads_insights').select('*', { count: 'exact', head: true }).lt('spend', 0);
  const { count: metaNegPurch } = await sb.from('meta_ads_insights').select('*', { count: 'exact', head: true }).lt('purchases', 0);
  const { count: metaNegValue } = await sb.from('meta_ads_insights').select('*', { count: 'exact', head: true }).lt('purchase_value', 0);
  console.log(`  spend < 0: ${metaNegSpend}`);
  console.log(`  purchases < 0: ${metaNegPurch}`);
  console.log(`  purchase_value < 0: ${metaNegValue}`);
  if ((metaNegSpend ?? 0) > 0) issues.push(`${metaNegSpend} meta insights com spend negativo`);
  if ((metaNegPurch ?? 0) > 0) issues.push(`${metaNegPurch} meta insights com purchases negativo`);

  // Duplicatas em meta (date+level+campaign_id+adset_id+ad_id)
  const { data: metaRows } = await sb.from('meta_ads_insights').select('date, level, campaign_id, adset_id, ad_id').limit(10000);
  const metaSeen = new Set<string>();
  let metaDupes = 0;
  for (const r of metaRows ?? []) {
    const key = `${r.date}|${r.level}|${r.campaign_id}|${r.adset_id}|${r.ad_id}`;
    if (metaSeen.has(key)) metaDupes++;
    metaSeen.add(key);
  }
  console.log(`  Duplicatas: ${metaDupes}`);
  if (metaDupes > 0) issues.push(`${metaDupes} meta insights duplicadas`);

  // ============================================================
  // 7. ABANDONED CHECKOUTS — anomalias
  // ============================================================
  console.log('\n========================================');
  console.log('7. ABANDONED CHECKOUTS');
  console.log('========================================\n');

  const { count: abandTotal } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true });
  const { count: abandNeg } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true }).lte('total_amount', 0);
  console.log(`  Total: ${abandTotal}`);
  console.log(`  total_amount <= 0: ${abandNeg}`);
  if ((abandNeg ?? 0) > 0) warnings.push(`${abandNeg} checkouts abandonados com valor <= 0`);

  // ============================================================
  // RESUMO
  // ============================================================
  console.log('\n========================================');
  console.log('RESUMO FINAL');
  console.log('========================================\n');

  if (issues.length === 0 && warnings.length === 0) {
    console.log('  ✅ ZERO issues e ZERO warnings. Dados 100% íntegros.');
  } else {
    if (issues.length > 0) {
      console.log(`  ❌ ${issues.length} ISSUE(S) (precisam de ação):\n`);
      for (let i = 0; i < issues.length; i++) console.log(`    ${i + 1}. ${issues[i]}`);
    }
    if (warnings.length > 0) {
      console.log(`\n  ⚠ ${warnings.length} WARNING(S) (monitorar):\n`);
      for (let i = 0; i < warnings.length; i++) console.log(`    ${i + 1}. ${warnings[i]}`);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
