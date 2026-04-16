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

  // Fetch all CA sales, identify those with UTC hour != 03:00
  const all: Array<{ sale_id: number; sale_date: string }> = [];
  const PAGE = 1000;
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('sales')
      .select('sale_id, sale_date')
      .eq('source', 'conta_azul')
      .order('sale_id', { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as Array<{ sale_id: number; sale_date: string }>));
    if (data.length < PAGE) break;
    page++;
  }

  const contaminated = all.filter((r) => {
    const d = new Date(r.sale_date);
    return d.getUTCHours() !== 3 || d.getUTCMinutes() !== 0;
  });

  console.log(`Found ${contaminated.length} contaminated sales (cron antigo, T≠03:00Z)`);

  if (contaminated.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const ids = contaminated.map((r) => r.sale_id);

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
