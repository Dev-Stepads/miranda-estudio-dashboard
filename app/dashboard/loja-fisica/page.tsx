export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts, fetchTopCustomers, fetchGeographyCA, parsePeriod } from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../../components/kpi-cards';
import { RevenueChart } from '../../components/revenue-chart';
import { AvgTicketChart } from '../../components/avg-ticket-chart';
import { GeographyChart } from '../../components/geography-chart';
import { SimpleTable } from '../../components/simple-table';

export default async function LojaFisicaPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  const [dailyRevenue, prevDailyRevenue, topProducts, topCustomers, geography] = await Promise.all([
    fetchDailyRevenue(period.days, params.from, params.to),
    fetchDailyRevenue(period.days * 2),
    fetchTopProducts(20),
    fetchTopCustomers(10, 'conta_azul'),
    fetchGeographyCA(10),
  ]);

  // Filter Conta Azul only
  const caDaily = dailyRevenue.filter(r => r.source === 'conta_azul');
  const totalRevenue = caDaily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = caDaily.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Previous period for comparison
  const now = new Date();
  const cutoff = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
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
    <div className="space-y-4 sm:space-y-8">
      {/* KPI Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <KpiCard
          title="Faturamento Loja Física"
          value={formatBRL(totalRevenue)}
          subtitle={period.label}
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
          subtitle={period.label}
        />
      </section>

      {/* Revenue Chart */}
      {chartData.length > 0 && <RevenueChart data={chartData} />}

      {/* Avg Ticket */}
      {chartData.length > 0 && (
        <AvgTicketChart
          data={caDaily.map(d => ({
            day: d.day,
            avg_ticket: d.orders_count > 0 ? d.gross_revenue / d.orders_count : 0,
          }))}
        />
      )}

      {/* Geography */}
      <GeographyChart
        data={(() => {
          const byState = new Map<string, { revenue: number; orders_count: number }>();
          for (const g of geography) {
            const existing = byState.get(g.state) ?? { revenue: 0, orders_count: 0 };
            existing.revenue += g.revenue;
            existing.orders_count += g.orders_count;
            byState.set(g.state, existing);
          }
          return Array.from(byState.entries())
            .map(([state, vals]) => ({ state, ...vals }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);
        })()}
      />

      {/* Top Products + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <SimpleTable
          title="Top Produtos"
          subtitle="Ranking por faturamento (NF-e)"
          columns={[
            { key: 'product_name', label: 'Produto' },
            { key: 'sku', label: 'SKU' },
            { key: 'quantity', label: 'Qtd', align: 'right', format: 'number' },
            { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency' },
          ]}
          rows={caProducts as unknown as Record<string, unknown>[]}
        />
        <SimpleTable
          title="Top Clientes"
          subtitle="Ranking por faturamento (Loja Física)"
          columns={[
            { key: 'name', label: 'Cliente' },
            { key: 'state', label: 'UF' },
            { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
            { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency' },
          ]}
          rows={topCustomers as unknown as Record<string, unknown>[]}
        />
      </div>
    </div>
  );
}
