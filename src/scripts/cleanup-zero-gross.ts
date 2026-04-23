/**
 * Limpar sales com gross_revenue=0 e status='paid' do Supabase.
 * Essas vendas têm total=0 na API CA (confirmado) e inflam a contagem
 * de pedidos sem contribuir para o faturamento.
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/cleanup-zero-gross.ts
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

  // 1. Encontrar sales com gross=0 e status=paid
  const { data: zeroSales, count } = await sb
    .from('sales')
    .select('sale_id', { count: 'exact' })
    .eq('gross_revenue', 0)
    .eq('status', 'paid')
    .limit(1000);

  const saleIds = (zeroSales ?? []).map(s => s.sale_id as number);
  console.log(`Encontrados: ${count} sales com gross=0 e status=paid`);

  if (saleIds.length === 0) {
    console.log('Nada a limpar.');
    return;
  }

  // 2. Deletar sale_items associados (em batches de 100)
  let itemsDeleted = 0;
  for (let i = 0; i < saleIds.length; i += 100) {
    const batch = saleIds.slice(i, i + 100);
    const { count: deleted } = await sb
      .from('sale_items')
      .delete({ count: 'exact' })
      .in('sale_id', batch);
    itemsDeleted += deleted ?? 0;
  }
  console.log(`Deletados: ${itemsDeleted} sale_items associados`);

  // 3. Deletar as sales
  let salesDeleted = 0;
  for (let i = 0; i < saleIds.length; i += 100) {
    const batch = saleIds.slice(i, i + 100);
    const { count: deleted } = await sb
      .from('sales')
      .delete({ count: 'exact' })
      .in('sale_id', batch);
    salesDeleted += deleted ?? 0;
  }
  console.log(`Deletados: ${salesDeleted} sales`);

  // 4. Verificar
  const { count: remaining } = await sb
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('gross_revenue', 0)
    .eq('status', 'paid');

  console.log(`\nVerificação: ${remaining} sales com gross=0 restantes`);
  console.log(remaining === 0 ? '✅ Limpeza completa' : '⚠ Ainda restam registros');
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
