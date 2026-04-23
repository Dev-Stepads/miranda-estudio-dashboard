import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const sb = createSupabaseAdmin({ url: env('SUPABASE_URL'), serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY') });

  // 1. View para Nov 2025
  const { data: viewNov } = await sb
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .eq('source', 'conta_azul')
    .gte('day', '2025-11-01')
    .lte('day', '2025-11-30')
    .order('day')
    .limit(100);

  const viewTotal = (viewNov ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
  const viewOrders = (viewNov ?? []).reduce((s, r) => s + Number(r.orders_count), 0);
  console.log(`View Nov 2025 CA: ${(viewNov ?? []).length} dias, ${viewOrders} orders, R$ ${viewTotal.toFixed(2)}`);

  // 2. Sales direto
  const { data: salesNov, count: salesCount } = await sb
    .from('sales')
    .select('sale_id, gross_revenue', { count: 'exact' })
    .eq('source', 'conta_azul')
    .eq('status', 'paid')
    .gte('sale_date', '2025-11-01T03:00:00Z')
    .lt('sale_date', '2025-12-01T03:00:00Z')
    .limit(10000);

  const salesTotal = (salesNov ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
  console.log(`Sales direto Nov CA: ${salesCount} rows, R$ ${salesTotal.toFixed(2)}`);

  console.log(`\nDiff: R$ ${(salesTotal - viewTotal).toFixed(2)}`);

  if (Math.abs(salesTotal - viewTotal) > 1) {
    console.log('\n⚠ A view retorna menos que a tabela sales.');
    console.log('Possível causa: sales com sale_date fora da janela SP timezone.');

    // Verificar sales que caem em Nov na query UTC mas não no timezone SP
    const { data: borderSales } = await sb
      .from('sales')
      .select('sale_id, sale_date, gross_revenue')
      .eq('source', 'conta_azul')
      .eq('status', 'paid')
      .gte('sale_date', '2025-11-01T00:00:00Z')
      .lt('sale_date', '2025-11-01T03:00:00Z')
      .limit(100);

    console.log(`\nSales entre 00:00-03:00 UTC de 01/Nov (seriam Oct em SP): ${(borderSales ?? []).length}`);

    const { data: borderEnd } = await sb
      .from('sales')
      .select('sale_id, sale_date, gross_revenue')
      .eq('source', 'conta_azul')
      .eq('status', 'paid')
      .gte('sale_date', '2025-12-01T00:00:00Z')
      .lt('sale_date', '2025-12-01T03:00:00Z')
      .limit(100);

    console.log(`Sales entre 00:00-03:00 UTC de 01/Dez (seriam Nov em SP): ${(borderEnd ?? []).length}`);
  }

  // 3. Contar por status em Nov
  const { data: allNov } = await sb
    .from('sales')
    .select('status')
    .eq('source', 'conta_azul')
    .gte('sale_date', '2025-11-01T03:00:00Z')
    .lt('sale_date', '2025-12-01T03:00:00Z')
    .limit(10000);

  const byStatus = new Map<string, number>();
  for (const r of allNov ?? []) {
    byStatus.set(r.status as string, (byStatus.get(r.status as string) ?? 0) + 1);
  }
  console.log('\nTodos os sales CA em Nov por status:');
  for (const [s, c] of byStatus) console.log(`  ${s}: ${c}`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
