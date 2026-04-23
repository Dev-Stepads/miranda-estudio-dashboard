/**
 * Corrigir total_price dos sale_items para refletir desconto proporcional.
 *
 * Problema: sale_items.total_price armazena o valor pré-desconto (price * qty).
 * O ranking de produtos soma esses valores, inflando a receita de produtos
 * vendidos com desconto. O correto é que sum(items.total_price) = sale.gross_revenue.
 *
 * Fix: para cada sale onde sum(items) != gross, redistribuir proporcionalmente.
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/fix-item-prices.ts
 */

import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}


async function main(): Promise<void> {
  const sb = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  console.log('========================================');
  console.log('FIX ITEM PRICES — distribuir descontos');
  console.log('========================================\n');

  // Pegar todas as sales paid com seus items
  const PAGE = 1000;
  let page = 0;
  let totalSalesChecked = 0;
  let totalSalesFixed = 0;
  let totalItemsFixed = 0;

  while (true) {
    const { data: sales } = await sb
      .from('sales')
      .select('sale_id, gross_revenue')
      .eq('status', 'paid')
      .gt('gross_revenue', 0)
      .order('sale_id', { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (!sales || sales.length === 0) break;

    for (const sale of sales) {
      totalSalesChecked++;
      const saleId = sale.sale_id as number;
      const gross = Number(sale.gross_revenue);

      // Pegar items desta sale
      const { data: items } = await sb
        .from('sale_items')
        .select('sale_item_id, total_price')
        .eq('sale_id', saleId);

      if (!items || items.length === 0) continue;

      const itemsSum = items.reduce((s, i) => s + Number(i.total_price), 0);

      // Se já bate, pular
      if (Math.abs(itemsSum - gross) < 0.01) continue;

      // Redistribuir proporcionalmente
      if (itemsSum <= 0) continue; // edge case: items todos com valor 0

      for (const item of items) {
        const oldPrice = Number(item.total_price);
        const newPrice = Math.round((oldPrice / itemsSum) * gross * 100) / 100;

        if (Math.abs(oldPrice - newPrice) < 0.01) continue;

        await sb
          .from('sale_items')
          .update({ total_price: newPrice })
          .eq('sale_item_id', item.sale_item_id);

        totalItemsFixed++;
      }

      totalSalesFixed++;
    }

    if (sales.length < PAGE) break;
    page++;

    if (page % 5 === 0) {
      console.log(`  Progresso: ${totalSalesChecked} sales checadas, ${totalSalesFixed} corrigidas, ${totalItemsFixed} items ajustados`);
    }
  }

  console.log(`\n✅ Concluído:`);
  console.log(`  Sales checadas: ${totalSalesChecked}`);
  console.log(`  Sales corrigidas: ${totalSalesFixed}`);
  console.log(`  Items ajustados: ${totalItemsFixed}`);

  // Verificar resultado
  console.log('\nVerificando amostra pós-fix...');
  const { data: sampleSales } = await sb
    .from('sales')
    .select('sale_id, gross_revenue')
    .eq('status', 'paid')
    .gt('gross_revenue', 0)
    .order('sale_date', { ascending: false })
    .limit(200);

  let stillMismatched = 0;
  for (const sale of sampleSales ?? []) {
    const { data: items } = await sb
      .from('sale_items')
      .select('total_price')
      .eq('sale_id', sale.sale_id);

    if (!items || items.length === 0) continue;

    const itemsSum = items.reduce((s, i) => s + Number(i.total_price), 0);
    const gross = Number(sale.gross_revenue);

    if (itemsSum > gross + 0.01) stillMismatched++;
  }

  console.log(`  Amostra 200 recentes: ${stillMismatched} ainda com items > gross`);
  console.log(stillMismatched === 0 ? '  ✅ Todos corrigidos' : `  ⚠ ${stillMismatched} restantes (arredondamento)`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
