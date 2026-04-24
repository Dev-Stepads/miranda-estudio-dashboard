export const dynamic = 'force-dynamic';

import {
  fetchNuvemshopDaily,
  fetchTopProducts,
  fetchGeography,
  fetchAbandoned,
  fetchAbandonedDetails,
  fetchTopCustomers,
  fetchRevenueByCategory,
  parsePeriod,
  getPreviousPeriod,
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

  // Previous period = same-length window immediately before [since, until].
  // Explicit computation avoids the truncation bug that used `days * 2` + filter.
  const { prevSince, prevUntil } = getPreviousPeriod(period.since, period.until);
  const [daily, prevDaily, topProducts, geography, abandoned, abandonedDetails, topCustomers, categoryRevenue] = await Promise.all([
    fetchNuvemshopDaily(period.days, params.from, params.to),
    fetchNuvemshopDaily(period.days, prevSince, prevUntil),
    fetchTopProducts(50, period.days, params.from, params.to),
    fetchGeography(50, period.days, params.from, params.to),
    fetchAbandoned(period.days, params.from, params.to),
    fetchAbandonedDetails(period.days, params.from, params.to, 200),
    fetchTopCustomers(30, 'nuvemshop', period.days, params.from, params.to),
    fetchRevenueByCategory(period.days, params.from, params.to, 'nuvemshop'),
  ]);

  // KPIs
  const totalRevenue = daily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = daily.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Previous period for comparison — date window already enforced by
  // fetchNuvemshopDaily via prevSince/prevUntil.
  const prevRevenue = prevDaily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const prevOrders = prevDaily.reduce((sum, r) => sum + r.orders_count, 0);

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

      {/* Faturamento por Categoria */}
      <section>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">Faturamento por Categoria</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {(['CASA', 'CORPO', 'PAPELARIA'] as const).map((cat) => {
            const data = categoryRevenue.find((c) => c.category === cat);
            return (
              <KpiCard
                key={cat}
                title={cat.charAt(0) + cat.slice(1).toLowerCase()}
                value={formatBRL(data?.revenue ?? 0)}
                subtitle={`${formatNumber(data?.items_count ?? 0)} itens | ${formatNumber(data?.orders_count ?? 0)} pedidos`}
              />
            );
          })}
        </div>
      </section>

      {/* Revenue Chart */}
      <RevenueChart data={chartData} sources={['nuvemshop']} />

      {/* Avg Ticket Chart */}
      <AvgTicketChart data={daily.map(d => ({ day: d.day, avg_ticket: d.avg_ticket }))} color="#6366F1" />

      {/* Geography by state + by city */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <BrazilMap data={geoData} />

        <SimpleTable
          title="Top Cidades"
          subtitle="Ranking por faturamento (e-commerce)"
          columns={[
            { key: 'city', label: 'Cidade' },
            { key: 'state', label: 'UF' },
            { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number', sortable: true },
            { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency', sortable: true },
          ]}
          rows={geography.map(g => ({ ...g, city: g.city || '—' }))}
          defaultSort={{ key: 'revenue', direction: 'desc' }}
          pageSize={15}
        />
      </div>

      {/* Abandoned — detalhes individuais */}
      <SimpleTable
        title="Carrinhos Abandonados"
        subtitle={`${abandonedDetails.length} carrinhos no período — contato e produtos para recuperação`}
        columns={[
          { key: 'date', label: 'Data', sortable: true, sortValue: 'created_at_raw' },
          { key: 'contact_name', label: 'Nome' },
          { key: 'contact_email', label: 'Email' },
          { key: 'contact_phone', label: 'Telefone' },
          { key: 'total_display', label: 'Valor', align: 'right', format: 'currency', sortable: true },
          { key: 'products_display', label: 'Produtos' },
        ]}
        rows={abandonedDetails.map((c) => ({
          created_at_raw: c.created_at ?? '',
          date: c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—',
          contact_name: c.contact_name ?? '—',
          contact_email: c.contact_email ?? '—',
          contact_phone: c.contact_phone ?? '—',
          total_display: c.total_amount,
          products_display: (c.products ?? []).map((p) => `${p.name} (${p.quantity}x)`).join(', ') || '—',
        }))}
        defaultSort={{ key: 'created_at_raw', direction: 'desc' }}
        pageSize={20}
      />

      {/* Vendas de Produtos */}
      <SimpleTable
        title="Vendas de Produtos"
        subtitle="Ranking por faturamento (e-commerce)"
        columns={[
          { key: 'product_name', label: 'Produto' },
          { key: 'quantity', label: 'Qtd', align: 'right', format: 'number', sortable: true },
          { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency', sortable: true },
        ]}
        rows={nsProducts}
        defaultSort={{ key: 'revenue', direction: 'desc' }}
        pageSize={15}
      />

      {/* Top Clientes — Pessoas */}
      <SimpleTable
        title="Top Clientes — Pessoas"
        subtitle="Ranking por faturamento (pessoa física)"
        columns={[
          { key: 'name', label: 'Cliente' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Telefone' },
          { key: 'state', label: 'UF' },
          { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number', sortable: true },
          { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency', sortable: true },
        ]}
        rows={topCustomers.filter(c => c.customer_type === 'pessoa').slice(0, 10).map(c => ({ ...c, name: c.name || '—', email: c.email ?? '—', phone: c.phone ?? '—', state: c.state ?? '—' }))}
        defaultSort={{ key: 'total_revenue', direction: 'desc' }}
      />

    </div>
  );
}
