export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts, fetchGeographyConsolidated, fetchTopCustomers, fetchRecentOrders, fetchCustomerRecurrence, fetchMonthlyComparison, parsePeriod } from '../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../components/kpi-cards';
import { RevenueChart } from '../components/revenue-chart';
import { TopProductsTable } from '../components/top-products-table';
import { SimpleTable } from '../components/simple-table';
import { RecurrenceCard } from '../components/recurrence-card';
import { MonthlyComparison } from '../components/monthly-comparison';
import { AvgTicketChart } from '../components/avg-ticket-chart';
import { ChannelDonut } from '../components/channel-donut';
import { BrazilMap } from '../components/brazil-map';

function buildChartData(rows: { day: string; source: string; gross_revenue: number }[]) {
  const byDay = new Map<string, { nuvemshop: number; conta_azul: number }>();

  for (const row of rows) {
    const existing = byDay.get(row.day) ?? { nuvemshop: 0, conta_azul: 0 };
    if (row.source === 'nuvemshop') existing.nuvemshop += row.gross_revenue;
    else if (row.source === 'conta_azul') existing.conta_azul += row.gross_revenue;
    byDay.set(row.day, existing);
  }

  return Array.from(byDay.entries())
    .map(([day, values]) => ({ day, ...values }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export default async function VisaoGeralPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  // Fetch current period + previous period (for % change comparison)
  const [currentRevenue, previousRevenue, topProducts, geoConsolidated, topCustomers, recentOrders, recurrence, monthly] = await Promise.all([
    fetchDailyRevenue(period.days, params.from, params.to),
    fetchDailyRevenue(period.days * 2),
    fetchTopProducts(15),
    fetchGeographyConsolidated(10),
    fetchTopCustomers(10),
    fetchRecentOrders(10),
    fetchCustomerRecurrence(),
    fetchMonthlyComparison(36),
  ]);

  // Split previous period data using date strings (YYYY-MM-DD) to avoid
  // timezone issues. period.since is in São Paulo timezone from parsePeriod().
  const prevPeriodRevenue = previousRevenue.filter((r) => r.day < period.since);

  // Current period KPIs
  const totalRevenue = currentRevenue.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = currentRevenue.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const nuvemshopRevenue = currentRevenue
    .filter(r => r.source === 'nuvemshop')
    .reduce((sum, r) => sum + r.gross_revenue, 0);
  const contaAzulRevenue = currentRevenue
    .filter(r => r.source === 'conta_azul')
    .reduce((sum, r) => sum + r.gross_revenue, 0);

  // Previous period KPIs (for % change)
  const prevTotalRevenue = prevPeriodRevenue.reduce((sum, r) => sum + r.gross_revenue, 0);
  const prevTotalOrders = prevPeriodRevenue.reduce((sum, r) => sum + r.orders_count, 0);

  const chartData = buildChartData(currentRevenue);

  // Geography data (already aggregated by state from consolidated view)
  const geoData = geoConsolidated.map(g => ({
    state: g.state,
    revenue: g.revenue,
    orders_count: g.orders_count,
  }));

  return (
    <div className="space-y-4 sm:space-y-8">
      {/* Executive Summary */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 p-4 sm:p-6 text-white shadow-lg">
        <p className="text-sm sm:text-base font-medium opacity-90">{period.label}</p>
        <p className="text-2xl sm:text-4xl font-bold mt-1">
          {formatBRL(totalRevenue)}
        </p>
        <p className="text-sm mt-2 opacity-80">
          {formatNumber(totalOrders)} pedidos
          {' · '}ticket médio {formatBRL(avgTicket)}
          {(() => {
            const pct = percentChange(totalRevenue, prevTotalRevenue);
            if (pct === null || !Number.isFinite(pct)) return null;
            return (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
                pct >= 0 ? 'bg-white/20' : 'bg-red-400/30'
              }`}>
                {pct >= 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% vs período anterior
              </span>
            );
          })()}
        </p>
      </div>

      {/* KPI Cards with % change */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Faturamento Total"
          value={formatBRL(totalRevenue)}
          subtitle={period.label}
          change={percentChange(totalRevenue, prevTotalRevenue)}
        />
        <KpiCard
          title="Pedidos"
          value={formatNumber(totalOrders)}
          subtitle={`Ticket médio ${formatBRL(avgTicket)}`}
          change={percentChange(totalOrders, prevTotalOrders)}
        />
        <KpiCard
          title="E-commerce"
          value={formatBRL(nuvemshopRevenue)}
          subtitle={`${totalRevenue > 0 ? ((nuvemshopRevenue / totalRevenue) * 100).toFixed(1) : '0'}% do total`}
        />
        <KpiCard
          title="Loja Física"
          value={formatBRL(contaAzulRevenue)}
          subtitle={`${totalRevenue > 0 ? ((contaAzulRevenue / totalRevenue) * 100).toFixed(1) : '0'}% do total`}
        />
      </section>

      {/* Chart + Donut side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
        <div className="lg:col-span-2">
          <RevenueChart data={chartData} />
        </div>
        <ChannelDonut nuvemshop={nuvemshopRevenue} contaAzul={contaAzulRevenue} />
      </div>

      {/* Avg Ticket Chart */}
      <AvgTicketChart
        data={chartData.map(d => ({
          day: d.day,
          avg_ticket: (d.nuvemshop + d.conta_azul) /
            (currentRevenue.filter(r => r.day === d.day).reduce((s, r) => s + r.orders_count, 0) || 1),
        }))}
      />

      {/* Recurrence */}
      {(() => {
        const totalFirst = recurrence.reduce((s, r) => s + r.first_time_buyers, 0);
        const totalRepeat = recurrence.reduce((s, r) => s + r.repeat_buyers, 0);
        const totalCust = totalFirst + totalRepeat;
        const rate = totalCust > 0 ? Number(((totalRepeat / totalCust) * 100).toFixed(1)) : 0;

        const ns = recurrence.find(r => r.source === 'nuvemshop');
        const ca = recurrence.find(r => r.source === 'conta_azul');

        return (
          <RecurrenceCard
            totalFirstTime={totalFirst}
            totalRepeat={totalRepeat}
            totalRepeatRate={rate}
            sources={[
              {
                label: 'E-commerce (Nuvemshop)',
                firstTime: ns?.first_time_buyers ?? 0,
                repeat: ns?.repeat_buyers ?? 0,
                repeatRate: Number(ns?.repeat_rate ?? 0),
                color: '#6366f1',
              },
              {
                label: 'Loja Física (Conta Azul)',
                firstTime: ca?.first_time_buyers ?? 0,
                repeat: ca?.repeat_buyers ?? 0,
                repeatRate: Number(ca?.repeat_rate ?? 0),
                color: '#f59e0b',
              },
            ]}
          />
        );
      })()}

      {/* Geography + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
        <BrazilMap data={geoData} />
        <div className="lg:col-span-2">
          <TopProductsTable products={topProducts} />
        </div>
      </div>

      {/* Monthly Comparison */}
      <MonthlyComparison data={monthly} />

      {/* Recent Orders + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <SimpleTable
          title="Pedidos Recentes"
          subtitle="Últimos 10 pedidos (todas as fontes)"
          columns={[
            { key: 'sale_date_fmt', label: 'Data' },
            { key: 'customer_name', label: 'Cliente' },
            { key: 'source_label', label: 'Canal' },
            { key: 'gross_revenue', label: 'Valor', align: 'right', format: 'currency' },
          ]}
          rows={recentOrders.map(o => ({
            ...o,
            sale_date_fmt: new Date(o.sale_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            source_label: o.source === 'nuvemshop' ? 'E-commerce' : 'Loja',
            customer_name: o.customer_name ?? '—',
          })) as unknown as Record<string, unknown>[]}
        />

      <SimpleTable
        title="Top Clientes"
        subtitle="Ranking por faturamento total (todas as fontes)"
        columns={[
          { key: 'name', label: 'Cliente' },
          { key: 'state', label: 'UF' },
          { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
          { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency' },
          { key: 'avg_ticket', label: 'Ticket Médio', align: 'right', format: 'currency' },
        ]}
        rows={topCustomers as unknown as Record<string, unknown>[]}
      />
      </div>
    </div>
  );
}
