import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const PAGE = 1000;

async function paginate<T>(buildQ: (p: number) => unknown): Promise<T[]> {
  const all: T[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await (buildQ(page) as Promise<{ data: T[] | null; error: { message: string } | null }>);
    if (error) { console.log('ERR:', error.message); return all; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

const BUSINESS = /\b(LTDA|S\.?A\.?|EIRELI|MEI|EPP|COMERCIO|SERVICOS|EMPREENDIMENTOS|PRODUCOES|INDUSTRIA|DISTRIBUIDORA|HOTELEIRA|MATERIAIS|INSTITUTO)\b/i;

function classify(name: string, source: string, srcId?: string): 'pessoa' | 'empresa' {
  if (source === 'conta_azul' && srcId) {
    const digits = srcId.replace(/\D/g, '');
    if (digits.length >= 12) return 'empresa';
    return 'pessoa';
  }
  if (BUSINESS.test(name)) return 'empresa';
  return 'pessoa';
}

async function main() {
  let issues = 0;
  const ok = (m: string) => console.log('  ✅ ' + m);
  const fail = (m: string) => { issues++; console.log('  ❌ ' + m); };

  console.log('==============================================');
  console.log('VALIDACAO DAS ALTERACOES RECENTES');
  console.log('==============================================');

  // 1. Customer contact data
  console.log('\n--- 1. CLIENTES: EMAIL E TELEFONE ---');
  const { count: total } = await sb.from('customers').select('*', { count: 'exact', head: true });
  const { count: withEmail } = await sb.from('customers').select('*', { count: 'exact', head: true }).not('email', 'is', null);
  const { count: withPhone } = await sb.from('customers').select('*', { count: 'exact', head: true }).not('phone', 'is', null);
  console.log(`  Total: ${total} | Com email: ${withEmail} | Com telefone: ${withPhone}`);
  if ((withEmail ?? 0) > 4000) ok('Emails populados'); else fail('Poucos emails: ' + withEmail);
  if ((withPhone ?? 0) > 3000) ok('Telefones populados'); else fail('Poucos telefones: ' + withPhone);

  // 2. PF/PJ classification
  console.log('\n--- 2. CLASSIFICACAO PF/PJ ---');
  type CustRow = { name: string; source: string; source_customer_id: string };
  const allCust = await paginate<CustRow>(p =>
    sb.from('customers').select('name, source, source_customer_id').range(p * PAGE, (p + 1) * PAGE - 1)
  );
  let pf = 0, pj = 0;
  const pjSamples: string[] = [];
  for (const c of allCust) {
    if (classify(c.name, c.source, c.source_customer_id) === 'empresa') {
      pj++;
      if (pjSamples.length < 3) pjSamples.push(`${c.name} (${c.source})`);
    } else pf++;
  }
  console.log(`  Pessoas: ${pf} | Empresas: ${pj}`);
  if (pj > 0) ok('Empresas detectadas: ' + pjSamples.join(', ')); else fail('Nenhuma empresa detectada');

  // 3. Top customers with contact
  console.log('\n--- 3. TOP CUSTOMERS (30d) ---');
  const sinceStr = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]! + 'T03:00:00Z'; })();
  type SaleRow = { customer_id: number; source: string; gross_revenue: number; customers: { name: string; email: string | null; phone: string | null; source_customer_id: string } };
  const custRows = await paginate<SaleRow>(p =>
    sb.from('sales')
      .select('customer_id, source, gross_revenue, customers!inner(name, source_customer_id, email, phone)')
      .eq('status', 'paid').not('customer_id', 'is', null).gte('sale_date', sinceStr)
      .range(p * PAGE, (p + 1) * PAGE - 1) as unknown as Promise<{ data: SaleRow[] | null; error: { message: string } | null }>
  );

  const byCust = new Map<number, { name: string; email: string | null; phone: string | null; source: string; srcId: string; rev: number; orders: number }>();
  for (const r of custRows) {
    const c = Array.isArray(r.customers) ? (r.customers as SaleRow['customers'][])[0] : r.customers;
    if (!c) continue;
    const ex = byCust.get(r.customer_id) ?? { name: c.name, email: c.email, phone: c.phone, source: r.source, srcId: c.source_customer_id, rev: 0, orders: 0 };
    ex.rev += +r.gross_revenue;
    ex.orders++;
    byCust.set(r.customer_id, ex);
  }

  const pessoas = [...byCust.values()].filter(c => classify(c.name, c.source, c.srcId) === 'pessoa').sort((a, b) => b.rev - a.rev);
  const empresas = [...byCust.values()].filter(c => classify(c.name, c.source, c.srcId) === 'empresa').sort((a, b) => b.rev - a.rev);

  console.log(`  Pessoas: ${pessoas.length} | Empresas: ${empresas.length}`);
  console.log('  Top 3 Pessoas:');
  for (const c of pessoas.slice(0, 3)) console.log(`    ${c.name} | ${c.email ?? '—'} | ${c.phone ?? '—'} | R$${c.rev.toFixed(2)}`);
  console.log('  Top 3 Empresas:');
  for (const c of empresas.slice(0, 3)) console.log(`    ${c.name} | ${c.email ?? '—'} | ${c.phone ?? '—'} | R$${c.rev.toFixed(2)}`);

  const pessoasWithEmail = pessoas.filter(c => c.email).length;
  const pessoasWithPhone = pessoas.filter(c => c.phone).length;
  console.log(`  Pessoas com email: ${pessoasWithEmail}/${pessoas.length} | com telefone: ${pessoasWithPhone}/${pessoas.length}`);

  // 4. Recent orders spot check
  console.log('\n--- 4. PEDIDOS RECENTES ---');
  const { data: recentDB } = await sb.from('sales')
    .select('source_sale_id, source, gross_revenue, sale_date, status, customers(name)')
    .order('sale_date', { ascending: false }).limit(5);

  const nsHeaders = {
    Authentication: `bearer ${process.env.NUVEMSHOP_ACCESS_TOKEN}`,
    'User-Agent': process.env.NUVEMSHOP_USER_AGENT!,
  };

  for (const o of recentDB ?? []) {
    const custObj = Array.isArray(o.customers) ? (o.customers as Array<{ name: string }>)[0] : (o.customers as { name: string } | null);
    const custName = custObj?.name ?? '—';
    const dateStr = (o.sale_date as string).slice(0, 10);

    if (o.source === 'nuvemshop') {
      const res = await fetch(`https://api.nuvemshop.com.br/v1/${process.env.NUVEMSHOP_STORE_ID}/orders/${o.source_sale_id}`, { headers: nsHeaders });
      if (res.ok) {
        const apiO = await res.json() as { total?: number };
        const match = Math.abs(+(apiO.total ?? 0) - +(o.gross_revenue as number)) < 0.01;
        if (match) ok(`${dateStr} #${o.source_sale_id} ${custName} R$${(+(o.gross_revenue as number)).toFixed(2)} API MATCH`);
        else fail(`${dateStr} #${o.source_sale_id} API=${apiO.total} DB=${o.gross_revenue}`);
      }
      await new Promise(r => setTimeout(r, 300));
    } else {
      ok(`${dateStr} #${o.source_sale_id} ${custName} R$${(+(o.gross_revenue as number)).toFixed(2)} (${o.source})`);
    }
  }

  // 5. Abandoned with contact
  console.log('\n--- 5. ABANDONADOS ---');
  const { count: abandTotal } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true });
  const { count: abandWithContact } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true }).not('contact_name', 'is', null);
  const { count: abandWithProducts } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true }).not('products', 'is', null);
  console.log(`  Total: ${abandTotal} | Com contato: ${abandWithContact} | Com produtos: ${abandWithProducts}`);
  if ((abandWithContact ?? 0) > 30) ok('Contatos populados'); else fail('Poucos contatos');

  // 6. Revenue consistency
  console.log('\n--- 6. REVENUE TODOS OS PERIODOS ---');
  for (const [label, days] of [['7d', 7], ['30d', 30], ['90d', 90], ['1ano', 365]] as const) {
    const s = new Date();
    s.setDate(s.getDate() - days);
    const sStr = s.toISOString().split('T')[0]!;
    const spTs = `${sStr}T03:00:00Z`;

    type VGRow = { source: string; gross_revenue: number };
    const viewRows = await paginate<VGRow>(p =>
      sb.from('v_visao_geral_daily').select('source, gross_revenue').gte('day', sStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    const salesRows = await paginate<VGRow>(p =>
      sb.from('sales').select('source, gross_revenue').eq('status', 'paid').gte('sale_date', spTs).range(p * PAGE, (p + 1) * PAGE - 1)
    );

    let vNS = 0, vCA = 0, sNS = 0, sCA = 0;
    for (const r of viewRows) { if (r.source === 'nuvemshop') vNS += +r.gross_revenue; if (r.source === 'conta_azul') vCA += +r.gross_revenue; }
    for (const r of salesRows) { if (r.source === 'nuvemshop') sNS += +r.gross_revenue; if (r.source === 'conta_azul') sCA += +r.gross_revenue; }

    const nsOk = Math.abs(vNS - sNS) < 1;
    const caOk = Math.abs(vCA - sCA) < 1;
    if (nsOk && caOk) ok(`${label}: NS e CA MATCH`);
    else fail(`${label}: NS ${nsOk ? 'OK' : 'DIFF R$' + (vNS - sNS).toFixed(0)} | CA ${caOk ? 'OK' : 'DIFF R$' + (vCA - sCA).toFixed(0)}`);
  }

  // 7. Meta Ads
  console.log('\n--- 7. META ADS ---');
  const metaRes = await fetch(`https://graph.facebook.com/v25.0/${process.env.META_AD_ACCOUNT_ID}/insights?fields=spend,actions&time_range={"since":"2026-04-01","until":"2026-04-10"}&access_token=${process.env.META_SYSTEM_USER_TOKEN}`);
  const metaData = await metaRes.json() as { data?: Array<Record<string, unknown>> };
  const metaRow = metaData.data?.[0];
  const apiSpend = +(metaRow?.spend as string ?? '0');
  const actions = (metaRow?.actions ?? []) as Array<{ action_type: string; value: string }>;
  const apiPurch = +(actions.find(a => a.action_type === 'purchase')?.value ?? '0');

  type MetaRow = { spend: number; purchases: number };
  const dbMeta = await paginate<MetaRow>(p =>
    sb.from('v_meta_account_daily').select('spend, purchases').gte('date', '2026-04-01').lte('date', '2026-04-10').range(p * PAGE, (p + 1) * PAGE - 1)
  );
  let dbMS = 0, dbMP = 0;
  for (const r of dbMeta) { dbMS += +r.spend; dbMP += +r.purchases; }

  if (Math.abs(apiSpend - dbMS) < 2 && apiPurch === dbMP) ok(`Meta Apr 1-10: spend=R$${dbMS.toFixed(2)} purch=${dbMP} MATCH`);
  else fail(`Meta: API spend=${apiSpend} purch=${apiPurch} vs DB spend=${dbMS.toFixed(2)} purch=${dbMP}`);

  // Summary
  console.log('\n==============================================');
  console.log(`RESULTADO: ${issues === 0 ? 'TUDO OK' : issues + ' PROBLEMA(S)'}`);
  console.log('==============================================');
}

main().catch(e => { console.error(e); process.exit(1); });
