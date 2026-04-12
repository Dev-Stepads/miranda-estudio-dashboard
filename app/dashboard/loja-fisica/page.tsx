export const dynamic = 'force-dynamic';

import { fetchDailyRevenue, fetchTopProducts } from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber } from '../../components/kpi-cards';
import { RevenueChart } from '../../components/revenue-chart';
import { SimpleTable } from '../../components/simple-table';

export default async function LojaFisicaPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = Math.max(1, Number(params.days ?? '30') || 30);

  const [dailyRevenue, topProducts] = await Promise.all([
    fetchDailyRevenue(days),
    fetchTopProducts(20),
  ]);

  // Filter Conta Azul only
  const caDaily = dailyRevenue.filter(r => r.source === 'conta_azul');

  const totalRevenue = caDaily.reduce((sum, r) => sum + r.gross_revenue, 0);
  const totalOrders = caDaily.reduce((sum, r) => sum + r.orders_count, 0);
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

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
      quantity: p.quantity_loja_fisica,
      revenue: p.revenue_loja_fisica,
    }));

  return (
    <div className="space-y-8">
      {/* Info banner */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        <strong>Nota:</strong> Os dados da Loja Física atualmente são do seed de desenvolvimento.
        O ETL real do Conta Azul (T7/T8) ainda não foi implementado — depende da descoberta do
        endpoint de detalhe de NF-e (task T45). Gênero e faixa etária não estão disponíveis
        nesta aba (o Conta Azul não coleta esses dados).
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          title="Faturamento Loja Física"
          value={formatBRL(totalRevenue)}
          subtitle={`Conta Azul — últimos ${days} dias`}
        />
        <KpiCard
          title="Pedidos"
          value={formatNumber(totalOrders)}
          subtitle={`Ticket médio ${formatBRL(avgTicket)}`}
        />
        <KpiCard
          title="Status"
          value={totalOrders > 0 ? 'Ativo' : 'Sem dados'}
          subtitle={totalOrders > 0 ? 'Dados do seed (dev)' : 'ETL Conta Azul pendente'}
        />
      </section>

      {/* Revenue Chart */}
      {chartData.length > 0 && <RevenueChart data={chartData} />}

      {/* Top Products */}
      <SimpleTable
        title="Top Produtos Loja Física"
        subtitle="Ranking por faturamento (Conta Azul)"
        columns={[
          { key: 'product_name', label: 'Produto' },
          { key: 'quantity', label: 'Qtd', align: 'right', format: 'number' },
          { key: 'revenue', label: 'Faturamento', align: 'right', format: 'currency' },
        ]}
        rows={caProducts as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}
