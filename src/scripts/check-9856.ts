import { createSupabaseAdmin } from '../lib/supabase.ts';
const sb = createSupabaseAdmin({ url: process.env.SUPABASE_URL!, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY! });

async function main() {
  // O ETL usa o UUID da venda como source_sale_id, não o numero.
  // O log dizia "Sale upsert #9856" — 9856 é o numero da venda, não o ID.
  // Procurar no raw payload
  const { data } = await sb
    .from('raw_contaazul_sales')
    .select('source_id, payload')
    .like('payload->>numero', '%9856%')
    .limit(5);

  if (data && data.length > 0) {
    console.log('Venda #9856 encontrada no raw:', data[0]!.source_id);
  } else {
    // O numero não é pesquisável assim. Vamos checar se o cron já rodou e recuperou.
    // O cron roda a cada 30 min. Se rodou depois do chunk 2, pode ter pego.
    const { data: lastSync } = await sb
      .from('etl_config')
      .select('value, updated_at')
      .eq('key', 'conta_azul_refresh_token')
      .limit(1);

    console.log('Último refresh token atualizado:', lastSync?.[0]?.updated_at ?? 'N/A');
    console.log('(Se o cron rodou após o chunk 2, a venda #9856 pode ter sido recuperada)');

    // Contar sales de 2025-H1
    const { count } = await sb
      .from('sales')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'conta_azul')
      .eq('status', 'paid')
      .gte('sale_date', '2025-01-01T03:00:00Z')
      .lt('sale_date', '2025-07-01T03:00:00Z');

    console.log('Sales CA paid em 2025-H1:', count);
    console.log('(Chunk 2 processou 1948 de 1949 — se count >= 1949, foi recuperada)');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
