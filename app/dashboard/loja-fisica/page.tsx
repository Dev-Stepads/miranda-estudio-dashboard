export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts, fetchTopCustomers, parsePeriod } from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../../components/kpi-cards';
import { RevenueChart } from '../../components/revenue-chart';
import { AvgTicketChart } from '../../components/avg-ticket-chart';
import { SimpleTable } from '../../components/simple-table';

export default async function LojaFisicaPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  const [dailyRevenue, prevDailyRevenue, topProducts, topCustomers] = await Promise.all([
    fetchDailyRevenue(period.days, params.from, params.to),
    fetchDailyRevenue(period.days * 2),
    fetchTopProducts(20, period.days, params.from, params.to),
    fetchTopCustomers(30, 'conta_azul', period.days, params.from, params.to),
  ]);

  // Loja Física = total CA aprovado − total NS real.
  // This mirrors Miranda's closing formula: `totais.aprovado` from the CA
  // sales screen minus the Nuvemshop total. Needed because the CA includes
  // NS-tagged vendas in its aprovado total, and we store those with a
  // `nstag-` prefix so sum(CA) = totais.aprovado matches Miranda exactly.
  // See DECISOES 2026-04-15b.
  const caDaily = dailyRevenue.filter(r => r.source === 'conta_azul');
  const nsDailyForSubtraction = dailyRevenue.filter(r => r.source === 'nuvemshop');

  const caSum = caDaily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const nsSum = nsDailyForSubtraction.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalRevenue = caSum - nsSum;
  // Order count: use CA orders minus NS orders to stay consistent with the
  // revenue derivation. The NS-tagged vendas inside CA are counted in caDaily
  // but are not actual loja-física orders.
  const caOrders = caDaily.reduce((sum, r) => sum + r.orders_count, 0);
  const nsOrders = nsDailyForSubtraction.reduce((sum, r) => sum + r.orders_count, 0);
  const totalOrders = Math.max(0, caOrders - nsOrders);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Previous period for comparison — same subtraction pattern
  const prevCa = prevDailyRevenue.filter(r => r.source === 'conta_azul' && r.day < period.since);
  const prevNs = prevDailyRevenue.filter(r => r.source === 'nuvemshop' && r.day < period.since);
  const prevRevenue = prevCa.reduce((sum, r) => sum + r.gross_revenue, 0) - prevNs.reduce((sum, r) => sum + r.gross_revenue, 0);
  const prevOrders = Math.max(0, prevCa.reduce((sum, r) => sum + r.orders_count, 0) - prevNs.reduce((sum, r) => sum + r.orders_count, 0));

  // Chart: per-day loja física = CA(day) − NS(day). Clamp to 0 on days where
  // NS outruns CA (rare edge — usually means CA hasn't synced that day yet).
  const nsByDay = new Map(nsDailyForSubtraction.map(r => [r.day, r.gross_revenue]));
  const chartData = caDaily.map((d) => ({
    day: d.day,
    nuvemshop: 0,
    conta_azul: Math.max(0, d.gross_revenue - (nsByDay.get(d.day) ?? 0)),
  }));

  // Products from Conta Azul
  const caProducts = topProducts
    .filter(p => p.revenue_loja_fisica > 0)
    .map(p => ({
      product_name: p.product_name,
      sku: p.sku,
      quantity: p.quantity_loja_fisica,
      revenue: p.revenue_loja_fisica,
    }));

  return (
    <div className="space-y-4 sm:space-y-8">
      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4">
        <KpiCard
          title="Faturamento Loja Física"
          value={formatBRL(totalRevenue)}
          subtitle={period.label}
          change={percentChange(totalRevenue, prevRevenue)}
        />
        <KpiCard
          title="Pedidos"
          value={formatNumber(totalOrders)}
          subtitle={`Ticket médio ${formatBRL(avgTicket)}`}
          change={percentChange(totalOrders, prevOrders)}
        />
      </section>

      {/* Revenue Chart */}
      {chartData.length > 0 && <RevenueChart data={chartData} sources={['conta_azul']} />}

      {/* Avg Ticket — computed from loja física = CA − NS per day */}
      {chartData.length > 0 && (
        <AvgTicketChart
          data={chartData.map(d => {
            // loja orders(day) = CA orders(day) − NS orders(day). count(CA)
            // already represents loja + nstag ≈ loja + NS orders, so
            // subtracting NS orders isolates loja.
            const caDayRow = caDaily.find(r => r.day === d.day);
            const nsDayRow = nsDailyForSubtraction.find(r => r.day === d.day);
            const lojaOrders = Math.max(0, (caDayRow?.orders_count ?? 0) - (nsDayRow?.orders_count ?? 0));
            return {
              day: d.day,
              avg_ticket: lojaOrders > 0 ? d.conta_azul / lojaOrders : 0,
            };
          })}
          color="#F59E0B"
        />
      )}

      {/* Top Produtos */}
      <SimpleTable
        title="Top Produtos"
        subtitle="Ranking por faturamento"
        columns={[
          { key: 'product_name', label: 'Produto' },
          { key: 'sku', label: 'SKU' },
          { key: 'quantity', label: 'Qtd', align: 'right', format: 'number' },
          { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency' },
        ]}
        rows={caProducts as unknown as Record<string, unknown>[]}
      />

      {/* Top Clientes — Pessoas */}
      <SimpleTable
        title="Top Clientes — Pessoas"
        subtitle="Ranking por faturamento (pessoa física)"
        columns={[
          { key: 'name', label: 'Cliente' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Telefone' },

          { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
          { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency' },
        ]}
        rows={topCustomers.filter(c => c.customer_type === 'pessoa').slice(0, 10).map(c => ({ ...c, email: c.email ?? '—', phone: c.phone ?? '—' })) as unknown as Record<string, unknown>[]}
      />

      {/* Top Clientes — Empresas */}
      <SimpleTable
        title="Top Clientes — Empresas"
        subtitle="Ranking por faturamento (pessoa jurídica)"
        columns={[
          { key: 'name', label: 'Empresa' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Telefone' },

          { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
          { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency' },
        ]}
        rows={topCustomers.filter(c => c.customer_type === 'empresa').slice(0, 10).map(c => ({ ...c, email: c.email ?? '—', phone: c.phone ?? '—' })) as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}
