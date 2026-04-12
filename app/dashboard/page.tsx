export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts, fetchGeography, parsePeriod } from '../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../components/kpi-cards';
import { RevenueChart } from '../components/revenue-chart';
import { TopProductsTable } from '../components/top-products-table';
import { ChannelDonut } from '../components/channel-donut';
import { GeographyChart } from '../components/geography-chart';

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
  const [currentRevenue, previousRevenue, topProducts, geography] = await Promise.all([
    fetchDailyRevenue(period.days, params.from, params.to),
    fetchDailyRevenue(period.days * 2), // fetch 2x and split
    fetchTopProducts(15),
    fetchGeography(10),
  ]);

  // Split previous period data
  const now = new Date();
  const currentCutoff = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
  const previousCutoff = new Date(now.getTime() - period.days * 2 * 24 * 60 * 60 * 1000);

  const prevPeriodRevenue = previousRevenue.filter((r) => {
    const d = new Date(r.day);
    return d >= previousCutoff && d < currentCutoff;
  });

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

  // Aggregate geography by state
  const geoByState = new Map<string, { revenue: number; orders_count: number }>();
  for (const g of geography) {
    const existing = geoByState.get(g.state) ?? { revenue: 0, orders_count: 0 };
    existing.revenue += g.revenue;
    existing.orders_count += g.orders_count;
    geoByState.set(g.state, existing);
  }
  const geoData = Array.from(geoByState.entries())
    .map(([state, vals]) => ({ state, ...vals }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return (
    <div className="space-y-8">
      {/* KPI Cards with % change */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <RevenueChart data={chartData} />
        </div>
        <ChannelDonut nuvemshop={nuvemshopRevenue} contaAzul={contaAzulRevenue} />
      </div>

      {/* Geography + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <GeographyChart data={geoData} />
        <div className="lg:col-span-2">
          <TopProductsTable products={topProducts} />
        </div>
      </div>
    </div>
  );
}
