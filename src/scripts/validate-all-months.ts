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
  const supabase = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const months = [
    { label: '2025-11', from: '2025-11-01', to: '2025-11-30' },
    { label: '2025-12', from: '2025-12-01', to: '2025-12-31' },
    { label: '2026-01', from: '2026-01-01', to: '2026-01-31' },
    { label: '2026-02', from: '2026-02-01', to: '2026-02-28' },
    { label: '2026-03', from: '2026-03-01', to: '2026-03-31' },
    { label: '2026-04', from: '2026-04-01', to: '2026-04-30' },
  ];

  console.log('========================================');
  console.log('VALIDAÇÃO POR MÊS — Supabase após sync');
  console.log('========================================\n');
  console.log('month   | CA sales | CA all        | loja          | nstag         | NS            | Derivada lojaFis');
  console.log('--------|----------|---------------|---------------|---------------|---------------|------------------');

  async function fetchAllCaSales(from: string, to: string) {
    const all: Array<{ source_sale_id: string; gross_revenue: number }> = [];
    const PAGE = 1000;
    let page = 0;
    while (true) {
      const { data } = await supabase
        .from('sales')
        .select('source_sale_id, gross_revenue')
        .eq('source', 'conta_azul')
        .gte('sale_date', `${from}T03:00:00Z`)
        .lt('sale_date', `${to}T23:59:59Z`)
        .order('sale_id', { ascending: true })
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as Array<{ source_sale_id: string; gross_revenue: number }>));
      if (data.length < PAGE) break;
      page++;
    }
    return all;
  }

  for (const m of months) {
    const ca = await fetchAllCaSales(m.from, m.to);
    const caLoja = ca.filter((r) => !String(r.source_sale_id).startsWith('nstag-'));
    const caNstag = ca.filter((r) => String(r.source_sale_id).startsWith('nstag-'));

    const sumCa = ca.reduce((s, r) => s + Number(r.gross_revenue), 0);
    const sumCaLoja = caLoja.reduce((s, r) => s + Number(r.gross_revenue), 0);
    const sumCaNstag = caNstag.reduce((s, r) => s + Number(r.gross_revenue), 0);

    // Use view v_visao_geral_daily for NS (already SP-aware)
    const { data: nsDaily } = await supabase
      .from('v_visao_geral_daily')
      .select('gross_revenue')
      .eq('source', 'nuvemshop')
      .gte('day', m.from)
      .lte('day', m.to);

    const sumNs = (nsDaily ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const lojaFisica = sumCa - sumNs;

    console.log(
      `${m.label} | ${String(ca.length).padStart(8)} | R$ ${fmt(sumCa).padStart(10)} | R$ ${fmt(sumCaLoja).padStart(10)} | R$ ${fmt(sumCaNstag).padStart(10)} | R$ ${fmt(sumNs).padStart(10)} | R$ ${fmt(lojaFisica).padStart(10)}`,
    );
  }

  console.log('\n🎯 Target Miranda (março 2026):');
  console.log('   Total: R$ 116.544,00 | Loja: R$ 82.944,79 | Site: R$ 33.599,21');
}

main().catch(console.error);
