export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts } from '../lib/queries';
import { KpiCard, formatBRL, formatNumber } from '../components/kpi-cards';
import { RevenueChart } from '../components/revenue-chart';
import { TopProductsTable } from '../components/top-products-table';

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
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = Math.max(1, Number(params.days ?? '30') || 30);

  const [dailyRevenue, topProducts] = await Promise.all([
    fetchDailyRevenue(days),
    fetchTopProducts(15),
  ]);

  const totalRevenue = dailyRevenue.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = dailyRevenue.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const nuvemshopRevenue = dailyRevenue
    .filter(r => r.source === 'nuvemshop')
    .reduce((sum, r) => sum + r.gross_revenue, 0);
  const contaAzulRevenue = dailyRevenue
    .filter(r => r.source === 'conta_azul')
    .reduce((sum, r) => sum + r.gross_revenue, 0);

  const nuvemshopShare = totalRevenue > 0
    ? ((nuvemshopRevenue / totalRevenue) * 100).toFixed(1)
    : '0';

  const chartData = buildChartData(dailyRevenue);

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Faturamento Total"
          value={formatBRL(totalRevenue)}
          subtitle={`Loja Física + E-commerce (${days} dias)`}
        />
        <KpiCard
          title="Pedidos"
          value={formatNumber(totalOrders)}
          subtitle={`Ticket médio ${formatBRL(avgTicket)}`}
        />
        <KpiCard
          title="E-commerce (Nuvemshop)"
          value={formatBRL(nuvemshopRevenue)}
          subtitle={`${nuvemshopShare}% do total`}
        />
        <KpiCard
          title="Loja Física (Conta Azul)"
          value={formatBRL(contaAzulRevenue)}
          subtitle={`${(100 - Number(nuvemshopShare)).toFixed(1)}% do total`}
        />
      </section>

      <RevenueChart data={chartData} />
      <TopProductsTable products={topProducts} />
    </div>
  );
}
