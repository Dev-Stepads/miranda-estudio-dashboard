export const dynamic = 'force-dynamic';

import {
  fetchNuvemshopDaily,
  fetchTopProducts,
  fetchGeography,
  fetchAbandoned,
  fetchAbandonedDetails,
  fetchTopCustomers,
  parsePeriod,
} from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../../components/kpi-cards';
import { RevenueChart } from '../../components/revenue-chart';
import { AvgTicketChart } from '../../components/avg-ticket-chart';
import { BrazilMap } from '../../components/brazil-map';
import { SimpleTable } from '../../components/simple-table';

export default async function NuvemshopPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  const [daily, prevDaily, topProducts, geography, abandoned, abandonedDetails, topCustomers] = await Promise.all([
    fetchNuvemshopDaily(period.days, params.from, params.to),
    fetchNuvemshopDaily(period.days * 2),
    fetchTopProducts(20, period.days, params.from, params.to),
    fetchGeography(15, period.days, params.from, params.to),
    fetchAbandoned(period.days, params.from, params.to),
    fetchAbandonedDetails(period.days, params.from, params.to, 20),
    fetchTopCustomers(10, 'nuvemshop', period.days, params.from, params.to),
  ]);

  // KPIs
  const totalRevenue = daily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = daily.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Previous period for comparison — use date strings to avoid timezone issues
  const prevRevenue = prevDaily
    .filter(r => r.day < period.since)
    .reduce((sum, r) => sum + r.gross_revenue, 0);
  const prevOrders = prevDaily
    .filter(r => r.day < period.since)
    .reduce((sum, r) => sum + r.orders_count, 0);

  const totalAbandoned = abandoned.reduce((sum, r) => sum + r.abandoned_count, 0);
  const totalAbandonedValue = abandoned.reduce((sum, r) => sum + r.total_amount, 0);

  // Chart data (Nuvemshop only — all goes to nuvemshop key)
  const chartData = daily.map((d) => ({
    day: d.day,
    nuvemshop: d.gross_revenue,
    conta_azul: 0,
  }));

  // Filter products to nuvemshop only (quantity_nuvemshop > 0)
  const nsProducts = topProducts
    .filter(p => p.revenue_nuvemshop > 0)
    .map(p => ({
      product_name: p.product_name,
      quantity: p.quantity_nuvemshop,
      revenue: p.revenue_nuvemshop,
    }));

  // Aggregate geography by state (the view has state+city, sum by state)
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
    <div className="space-y-4 sm:space-y-8">
      {/* KPI Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Faturamento Nuvemshop"
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
        <KpiCard
          title="Carrinhos Abandonados"
          value={formatNumber(totalAbandoned)}
          subtitle={`${formatBRL(totalAbandonedValue)} em valor`}
        />
        <KpiCard
          title="Top Estado"
          value={geoData[0]?.state ?? '—'}
          subtitle={geoData[0] ? `${formatBRL(geoData[0].revenue)} | ${geoData[0].orders_count} pedidos` : ''}
        />
      </section>

      {/* Revenue Chart */}
      <RevenueChart data={chartData} />

      {/* Avg Ticket Chart */}
      <AvgTicketChart data={daily.map(d => ({ day: d.day, avg_ticket: d.avg_ticket }))} />

      {/* Geography by state + by city */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <BrazilMap data={geoData} />

        <SimpleTable
          title="Top Cidades"
          subtitle="Ranking por faturamento (e-commerce)"
          columns={[
            { key: 'city', label: 'Cidade' },
            { key: 'state', label: 'UF' },
            { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
            { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency' },
          ]}
          rows={geography.slice(0, 15) as unknown as Record<string, unknown>[]}
        />
      </div>

      {/* Abandoned — detalhes individuais */}
      <SimpleTable
        title="Carrinhos Abandonados"
        subtitle="Contato e produtos — para recuperação"
        columns={[
          { key: 'date', label: 'Data' },
          { key: 'contact_name', label: 'Nome' },
          { key: 'contact_email', label: 'Email' },
          { key: 'contact_phone', label: 'Telefone' },
          { key: 'total_display', label: 'Valor', align: 'right', format: 'currency' },
          { key: 'products_display', label: 'Produtos' },
        ]}
        rows={abandonedDetails.map((c) => ({
          date: c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—',
          contact_name: c.contact_name ?? '—',
          contact_email: c.contact_email ?? '—',
          contact_phone: c.contact_phone ?? '—',
          total_display: c.total_amount,
          products_display: (c.products ?? []).map((p) => `${p.name} (${p.quantity}x)`).join(', ') || '—',
        })) as unknown as Record<string, unknown>[]}
      />

      {/* Top Products + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <SimpleTable
          title="Top Produtos"
          subtitle="Ranking por faturamento (e-commerce)"
          columns={[
            { key: 'product_name', label: 'Produto' },
            { key: 'quantity', label: 'Qtd', align: 'right', format: 'number' },
            { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency' },
          ]}
          rows={nsProducts.slice(0, 15) as unknown as Record<string, unknown>[]}
        />
        <SimpleTable
          title="Top Clientes"
          subtitle="Ranking por faturamento (e-commerce)"
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
