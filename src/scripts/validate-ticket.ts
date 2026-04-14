import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().split('T')[0]!;

  const { data: daily } = await sb
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .gte('day', sinceStr)
    .order('day')
    .limit(10000);

  console.log('=== TICKET MEDIO POR DIA (ultimos 30d) ===\n');
  console.log('Dia         NS pedidos  NS revenue  NS ticket   CA pedidos  CA revenue  CA ticket');
  console.log('-'.repeat(90));

  const byDay = new Map<string, { nsRev: number; nsOrd: number; caRev: number; caOrd: number }>();
  for (const r of daily ?? []) {
    const d = byDay.get(r.day as string) ?? { nsRev: 0, nsOrd: 0, caRev: 0, caOrd: 0 };
    if (r.source === 'nuvemshop') {
      d.nsRev += +(r.gross_revenue as number);
      d.nsOrd += +(r.orders_count as number);
    }
    if (r.source === 'conta_azul') {
      d.caRev += +(r.gross_revenue as number);
      d.caOrd += +(r.orders_count as number);
    }
    byDay.set(r.day as string, d);
  }

  let totalNsRev = 0, totalNsOrd = 0, totalCaRev = 0, totalCaOrd = 0;
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [day, d] of days.slice(-10)) {
    const nsTicket = d.nsOrd > 0 ? `R$${(d.nsRev / d.nsOrd).toFixed(2)}` : '   —';
    const caTicket = d.caOrd > 0 ? `R$${(d.caRev / d.caOrd).toFixed(2)}` : '   —';
    console.log(
      `${day}  ${String(d.nsOrd).padStart(8)}  R$${d.nsRev.toFixed(0).padStart(8)}  ${nsTicket.padStart(9)}  ` +
      `${String(d.caOrd).padStart(8)}  R$${d.caRev.toFixed(0).padStart(8)}  ${caTicket.padStart(9)}`
    );
    totalNsRev += d.nsRev;
    totalNsOrd += d.nsOrd;
    totalCaRev += d.caRev;
    totalCaOrd += d.caOrd;
  }

  console.log('-'.repeat(90));
  console.log('\nRESUMO 30d:');
  console.log(`  Nuvemshop: ${totalNsOrd} pedidos, R$${totalNsRev.toFixed(2)}, ticket medio R$${totalNsOrd > 0 ? (totalNsRev / totalNsOrd).toFixed(2) : '0'}`);
  console.log(`  Conta Azul: ${totalCaOrd} pedidos, R$${totalCaRev.toFixed(2)}, ticket medio R$${totalCaOrd > 0 ? (totalCaRev / totalCaOrd).toFixed(2) : '0'}`);
  console.log(`  Combinado: ${totalNsOrd + totalCaOrd} pedidos, R$${(totalNsRev + totalCaRev).toFixed(2)}, ticket medio R$${(totalNsOrd + totalCaOrd) > 0 ? ((totalNsRev + totalCaRev) / (totalNsOrd + totalCaOrd)).toFixed(2) : '0'}`);

  // Verify: days without sales for each source
  let nsZero = 0, caZero = 0;
  for (const [, d] of days) {
    if (d.nsOrd === 0) nsZero++;
    if (d.caOrd === 0) caZero++;
  }
  console.log(`\nDias sem vendas NS: ${nsZero} (grafico nao mostra ponto — correto)`);
  console.log(`Dias sem vendas CA: ${caZero} (grafico nao mostra ponto — correto)`);

  // Spot check: verify a specific day manually
  const spotDay = days[days.length - 1];
  if (spotDay) {
    const [day, d] = spotDay;
    console.log(`\nSPOT CHECK (${day}):`);

    const { data: nsSales } = await sb.from('sales')
      .select('gross_revenue')
      .eq('source', 'nuvemshop')
      .eq('status', 'paid')
      .gte('sale_date', day + 'T00:00:00')
      .lt('sale_date', (() => { const n = new Date(day); n.setDate(n.getDate() + 1); return n.toISOString().split('T')[0]! + 'T00:00:00'; })());

    const directNsRev = (nsSales ?? []).reduce((s, r) => s + +(r.gross_revenue as number), 0);
    const directNsOrd = (nsSales ?? []).length;

    const { data: caSales } = await sb.from('sales')
      .select('gross_revenue')
      .eq('source', 'conta_azul')
      .eq('status', 'paid')
      .gte('sale_date', day + 'T00:00:00')
      .lt('sale_date', (() => { const n = new Date(day); n.setDate(n.getDate() + 1); return n.toISOString().split('T')[0]! + 'T00:00:00'; })());

    const directCaRev = (caSales ?? []).reduce((s, r) => s + +(r.gross_revenue as number), 0);
    const directCaOrd = (caSales ?? []).length;

    console.log(`  View:   NS ${d.nsOrd} pedidos R$${d.nsRev.toFixed(2)} ticket R$${d.nsOrd > 0 ? (d.nsRev / d.nsOrd).toFixed(2) : '0'}`);
    console.log(`  Direct: NS ${directNsOrd} pedidos R$${directNsRev.toFixed(2)} ticket R$${directNsOrd > 0 ? (directNsRev / directNsOrd).toFixed(2) : '0'}`);
    console.log(`  Match NS? ${Math.abs(d.nsRev - directNsRev) < 1 ? 'SIM' : 'DIFF'}`);

    console.log(`  View:   CA ${d.caOrd} pedidos R$${d.caRev.toFixed(2)} ticket R$${d.caOrd > 0 ? (d.caRev / d.caOrd).toFixed(2) : '0'}`);
    console.log(`  Direct: CA ${directCaOrd} pedidos R$${directCaRev.toFixed(2)} ticket R$${directCaOrd > 0 ? (directCaRev / directCaOrd).toFixed(2) : '0'}`);
    console.log(`  Match CA? ${Math.abs(d.caRev - directCaRev) < 1 ? 'SIM' : 'DIFF'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
