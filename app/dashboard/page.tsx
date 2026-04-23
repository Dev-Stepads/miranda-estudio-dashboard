export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts, fetchGeographyConsolidated, fetchTopCustomers, fetchRecentOrders, fetchCustomerRecurrence, fetchMonthlyComparison, parsePeriod, getPreviousPeriod } from '../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../components/kpi-cards';
import { RevenueChart } from '../components/revenue-chart';
import { TopProductsTable } from '../components/top-products-table';
import { SimpleTable } from '../components/simple-table';
import { RecurrenceCard } from '../components/recurrence-card';
import { MonthlyComparison } from '../components/monthly-comparison';
import { AvgTicketChart } from '../components/avg-ticket-chart';
import { ChannelDonut } from '../components/channel-donut';
import { BrazilMap } from '../components/brazil-map';

/**
 * Build chart data. For Loja Física we use the subtraction formula:
 *   loja_dia = CA_dia − NS_dia
 * because sum(CA) in Supabase = totais.aprovado from the CA sales screen
 * (which includes NS-tagged vendas). See DECISOES 2026-04-15b.
 */
function buildChartData(rows: { day: string; source: string; gross_revenue: number }[]) {
  const byDay = new Map<string, { nuvemshop: number; ca_total: number }>();

  for (const row of rows) {
    const existing = byDay.get(row.day) ?? { nuvemshop: 0, ca_total: 0 };
    if (row.source === 'nuvemshop') existing.nuvemshop += row.gross_revenue;
    else if (row.source === 'conta_azul') existing.ca_total += row.gross_revenue;
    byDay.set(row.day, existing);
  }

  return Array.from(byDay.entries())
    .map(([day, values]) => ({
      day,
      nuvemshop: values.nuvemshop,
      // Loja Física real = CA total − NS (clamped to 0 on edge days)
      conta_azul: Math.max(0, values.ca_total - values.nuvemshop),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export default async function VisaoGeralPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  // Fetch current period + previous period (for % change comparison).
  // Previous period = window of the same length immediately before [since, until].
  // Computed explicitly so custom date ranges (e.g. "March 2026") and long
  // periods (e.g. "1 ano") compare fairly instead of getting truncated.
  const { prevSince, prevUntil } = getPreviousPeriod(period.since, period.until);
  const [currentRevenue, prevPeriodRevenue, topProducts, geoConsolidated, topCustomers, recentOrders, recurrence, monthly] = await Promise.all([
    fetchDailyRevenue(period.days, params.from, params.to),
    fetchDailyRevenue(period.days, prevSince, prevUntil),
    fetchTopProducts(15, period.days, params.from, params.to),
    fetchGeographyConsolidated(10, period.days, params.from, params.to),
    fetchTopCustomers(30, undefined, period.days, params.from, params.to),
    fetchRecentOrders(10, period.days, params.from, params.to),
    fetchCustomerRecurrence(period.days, params.from, params.to),
    fetchMonthlyComparison(36),
  ]);

  // Current period KPIs
  // Identity: sum(CA) = totais.aprovado (includes NS-tagged vendas).
  // So: Total = sum(CA). E-commerce = sum(NS). Loja Física = CA − NS.
  // Summing CA + NS would double-count NS orders. See DECISOES 2026-04-15b.
  const caRows = currentRevenue.filter((r) => r.source === 'conta_azul');
  const nsRows = currentRevenue.filter((r) => r.source === 'nuvemshop');

  const caRevenue = caRows.reduce((sum, r) => sum + r.gross_revenue, 0);
  const nuvemshopRevenue = nsRows.reduce((sum, r) => sum + r.gross_revenue, 0);
  const contaAzulRevenue = Math.max(0, caRevenue - nuvemshopRevenue);
  const totalRevenue = caRevenue; // = loja física + e-commerce

  // count(CA) = count(loja) + count(NS-tagged) ≈ count(loja) + count(NS),
  // so total orders = count(CA).
  const totalOrders = caRows.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Previous period KPIs — same pattern
  const prevCaRows = prevPeriodRevenue.filter((r) => r.source === 'conta_azul');
  const prevNsRows = prevPeriodRevenue.filter((r) => r.source === 'nuvemshop');
  const prevTotalRevenue = prevCaRows.reduce((sum, r) => sum + r.gross_revenue, 0);
  const prevTotalOrders = prevCaRows.reduce((sum, r) => sum + r.orders_count, 0);
  // Keep prevNsRows referenced (used only if we later want split prev KPIs)
  void prevNsRows;

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

      {/* Avg Ticket Chart — split por fonte.
          Orders identity: count(CA) = count(loja) + count(NS-tagged),
          so count(loja) = count(CA) − count(NS). Total orders = count(CA). */}
      <AvgTicketChart
        data={chartData.map(d => {
          const dayRows = currentRevenue.filter(r => r.day === d.day);
          const dayNsOrders = dayRows.filter(r => r.source === 'nuvemshop').reduce((s, r) => s + r.orders_count, 0);
          const dayCaOrders = dayRows.filter(r => r.source === 'conta_azul').reduce((s, r) => s + r.orders_count, 0);
          const dayLojaOrders = Math.max(0, dayCaOrders - dayNsOrders);
          const dayTotalOrders = dayCaOrders; // = loja + NS
          const dayTotalRevenue = d.nuvemshop + d.conta_azul; // already = loja + NS
          return {
            day: d.day,
            avg_ticket: dayTotalOrders > 0 ? dayTotalRevenue / dayTotalOrders : 0,
            avg_ticket_nuvemshop: dayNsOrders > 0 ? d.nuvemshop / dayNsOrders : undefined,
            avg_ticket_conta_azul: dayLojaOrders > 0 ? d.conta_azul / dayLojaOrders : undefined,
          };
        })}
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
      {/* Top Clientes */}
      <SimpleTable
          title="Top Clientes — Pessoas"
          subtitle="Ranking por faturamento (pessoa física)"
          columns={[
            { key: 'name', label: 'Cliente' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Telefone' },
            { key: 'state', label: 'UF' },
            { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
            { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency' },
            { key: 'avg_ticket', label: 'Ticket Médio', align: 'right', format: 'currency' },
          ]}
          rows={topCustomers.filter(c => c.customer_type === 'pessoa').slice(0, 10).map(c => ({ ...c, email: c.email ?? '—', phone: c.phone ?? '—' }))}
        />
        <SimpleTable
          title="Top Clientes — Empresas"
          subtitle="Ranking por faturamento (pessoa jurídica)"
          columns={[
            { key: 'name', label: 'Empresa' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Telefone' },
            { key: 'state', label: 'UF' },
            { key: 'orders_count', label: 'Pedidos', align: 'right', format: 'number' },
            { key: 'total_revenue', label: 'Faturamento', align: 'right', format: 'currency' },
            { key: 'avg_ticket', label: 'Ticket Médio', align: 'right', format: 'currency' },
          ]}
          rows={topCustomers.filter(c => c.customer_type === 'empresa').slice(0, 10).map(c => ({ ...c, email: c.email ?? '—', phone: c.phone ?? '—' }))}
        />

      {/* Pedidos Recentes abaixo */}
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
        }))}
      />
    </div>
  );
}
