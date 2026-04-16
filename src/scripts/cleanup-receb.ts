import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const supabase = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // Find all sales CA with source_sale_id starting with 'receb-'
  const all: Array<{ sale_id: number }> = [];
  const PAGE = 1000;
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('sales')
      .select('sale_id')
      .eq('source', 'conta_azul')
      .ilike('source_sale_id', 'receb-%')
      .order('sale_id', { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as Array<{ sale_id: number }>));
    if (data.length < PAGE) break;
    page++;
  }

  console.log(`Found ${all.length} receb-* sales to delete`);

  if (all.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const ids = all.map((r) => r.sale_id);

  // Delete sale_items first (FK)
  let itemsDeleted = 0;
  let salesDeleted = 0;
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { count: ic } = await supabase.from('sale_items').delete({ count: 'exact' }).in('sale_id', batch);
    const { count: sc } = await supabase.from('sales').delete({ count: 'exact' }).in('sale_id', batch);
    itemsDeleted += ic ?? 0;
    salesDeleted += sc ?? 0;
    console.log(`  batch ${i}/${ids.length}: deleted ${sc} sales + ${ic} items`);
  }

  console.log(`\n✅ Total: ${salesDeleted} sales + ${itemsDeleted} items deleted`);
}

main().catch(console.error);
