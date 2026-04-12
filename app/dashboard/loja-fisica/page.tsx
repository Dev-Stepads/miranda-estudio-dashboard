export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts } from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../../components/kpi-cards';
import { RevenueChart } from '../../components/revenue-chart';
import { SimpleTable } from '../../components/simple-table';

export default async function LojaFisicaPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = Math.max(1, Number(params.days ?? '30') || 30);

  const [dailyRevenue, prevDailyRevenue, topProducts] = await Promise.all([
    fetchDailyRevenue(days),
    fetchDailyRevenue(days * 2),
    fetchTopProducts(20),
  ]);

  // Filter Conta Azul only
  const caDaily = dailyRevenue.filter(r => r.source === 'conta_azul');
  const totalRevenue = caDaily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = caDaily.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Previous period for comparison
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevCaDaily = prevDailyRevenue
    .filter(r => r.source === 'conta_azul' && new Date(r.day) < cutoff);
  const prevRevenue = prevCaDaily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const prevOrders = prevCaDaily.reduce((sum, r) => sum + r.orders_count, 0);

  // Chart data
  const chartData = caDaily.map((d) => ({
    day: d.day,
    nuvemshop: 0,
    conta_azul: d.gross_revenue,
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
    <div className="space-y-8">
      {/* KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          title="Faturamento Loja Física"
          value={formatBRL(totalRevenue)}
          subtitle={`Últimos ${days} dias`}
          change={percentChange(totalRevenue, prevRevenue)}
        />
        <KpiCard
          title="Pedidos (NF-e)"
          value={formatNumber(totalOrders)}
          subtitle={`Ticket médio ${formatBRL(avgTicket)}`}
          change={percentChange(totalOrders, prevOrders)}
        />
        <KpiCard
          title="NF-e Emitidas"
          value={formatNumber(totalOrders)}
          subtitle={`Últimos ${days} dias`}
        />
      </section>

      {/* Revenue Chart */}
      {chartData.length > 0 && <RevenueChart data={chartData} />}

      {/* Top Products */}
      <SimpleTable
        title="Top Produtos Loja Física"
        subtitle="Ranking por faturamento (NF-e Conta Azul)"
        columns={[
          { key: 'product_name', label: 'Produto' },
          { key: 'sku', label: 'SKU' },
          { key: 'quantity', label: 'Qtd', align: 'right', format: 'number' },
          { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency' },
        ]}
        rows={caProducts as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}
