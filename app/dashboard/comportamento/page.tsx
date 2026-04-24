export const dynamic = 'force-dynamic';

import {
  fetchFunnelData,
  fetchMostAbandonedProducts,
  fetchAbandonedDetails,
  parsePeriod,
} from '../../lib/queries';
import { KpiCard, formatNumber } from '../../components/kpi-cards';
import { SimpleTable } from '../../components/simple-table';

export default async function ComportamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  const [funnel, abandonedProducts, abandonedDetails] = await Promise.all([
    fetchFunnelData(period.days, params.from, params.to),
    fetchMostAbandonedProducts(period.days, params.from, params.to, 20),
    fetchAbandonedDetails(period.days, params.from, params.to, 200),
  ]);

  // Funnel percentages
  const cartRate = funnel.visitors > 0 ? (funnel.addedToCart / funnel.visitors) * 100 : 0;
  const checkoutRate = funnel.addedToCart > 0 ? (funnel.reachedCheckout / funnel.addedToCart) * 100 : 0;
  const purchaseRate = funnel.reachedCheckout > 0 ? (funnel.purchased / funnel.reachedCheckout) * 100 : 0;
  const overallRate = funnel.visitors > 0 ? (funnel.purchased / funnel.visitors) * 100 : 0;

  // Abandonment stage analysis
  const droppedBeforeProducts = funnel.visitors - funnel.addedToCart;
  const droppedBeforeContact = funnel.addedToCart - funnel.reachedCheckout;
  const droppedBeforePurchase = funnel.reachedCheckout - funnel.purchased;

  // Abandoned checkouts without contact info
  const withoutContact = abandonedDetails.filter(
    c => (!c.contact_name || c.contact_name.trim() === '') && (!c.contact_email || c.contact_email.trim() === '')
  ).length;
  const withContact = abandonedDetails.length - withoutContact;

  return (
    <div className="space-y-4 sm:space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
          Comportamento do Cliente
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Funil de conversao e analise de abandono — {period.label}
        </p>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Taxa de Conversao"
          value={`${overallRate.toFixed(1)}%`}
          subtitle={`${formatNumber(funnel.purchased)} compras de ${formatNumber(funnel.visitors)} sessoes`}
        />
        <KpiCard
          title="Carrinhos Abandonados"
          value={formatNumber(funnel.visitors - funnel.purchased)}
          subtitle={`${(100 - overallRate).toFixed(1)}% de abandono`}
        />
        <KpiCard
          title="Com Contato"
          value={formatNumber(withContact)}
          subtitle="Recuperaveis (tem nome ou email)"
        />
        <KpiCard
          title="Sem Contato"
          value={formatNumber(withoutContact)}
          subtitle="Sem dados para recuperacao"
        />
      </section>

      {/* Funil de Conversao */}
      <section className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Funil de Conversao
        </h3>
        <div className="space-y-3">
          <FunnelStep
            label="Sessoes com intencao"
            count={funnel.visitors}
            percentage={100}
            color="bg-blue-500"
          />
          <FunnelStep
            label="Adicionaram produtos"
            count={funnel.addedToCart}
            percentage={cartRate}
            color="bg-indigo-500"
            dropLabel={droppedBeforeProducts > 0 ? `${droppedBeforeProducts} sairam sem adicionar produtos` : undefined}
          />
          <FunnelStep
            label="Preencheram contato"
            count={funnel.reachedCheckout}
            percentage={checkoutRate}
            color="bg-violet-500"
            dropLabel={droppedBeforeContact > 0 ? `${droppedBeforeContact} abandonaram antes do contato` : undefined}
          />
          <FunnelStep
            label="Compraram"
            count={funnel.purchased}
            percentage={purchaseRate}
            color="bg-emerald-500"
            dropLabel={droppedBeforePurchase > 0 ? `${droppedBeforePurchase} abandonaram no checkout` : undefined}
          />
        </div>
      </section>

      {/* Etapa de Abandono */}
      <section className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Onde os clientes abandonam
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <AbandonmentCard
            stage="Antes de adicionar produtos"
            count={droppedBeforeProducts}
            total={funnel.visitors}
            color="text-red-600 dark:text-red-400"
            bgColor="bg-red-50 dark:bg-red-900/20"
          />
          <AbandonmentCard
            stage="Antes de preencher contato"
            count={droppedBeforeContact}
            total={funnel.visitors}
            color="text-amber-600 dark:text-amber-400"
            bgColor="bg-amber-50 dark:bg-amber-900/20"
          />
          <AbandonmentCard
            stage="No checkout (com contato)"
            count={droppedBeforePurchase}
            total={funnel.visitors}
            color="text-orange-600 dark:text-orange-400"
            bgColor="bg-orange-50 dark:bg-orange-900/20"
          />
        </div>
      </section>

      {/* Produtos mais abandonados */}
      <SimpleTable
        title="Produtos Mais Abandonados"
        subtitle="Ranking de produtos deixados no carrinho"
        columns={[
          { key: 'name', label: 'Produto' },
          { key: 'abandonedCount', label: 'Qtd abandonada', align: 'right', format: 'number', sortable: true },
          { key: 'totalValue', label: 'Valor perdido', align: 'right', format: 'currency', sortable: true },
        ]}
        rows={abandonedProducts}
        defaultSort={{ key: 'abandonedCount', direction: 'desc' }}
        pageSize={10}
      />

      {/* Nota de rodape */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Dados baseados nos carrinhos abandonados da Nuvemshop (retencao de 30 dias).
        Sessoes com intencao = carrinhos abandonados + pedidos pagos no periodo.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------

function FunnelStep({
  label,
  count,
  percentage,
  color,
  dropLabel,
}: {
  label: string;
  count: number;
  percentage: number;
  color: string;
  dropLabel?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {formatNumber(count)} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-4">
        <div
          className={`${color} h-4 rounded-full transition-all duration-500`}
          style={{ width: `${Math.max(percentage, 2)}%` }}
        />
      </div>
      {dropLabel && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 pl-1">
          ↘ {dropLabel}
        </p>
      )}
    </div>
  );
}

function AbandonmentCard({
  stage,
  count,
  total,
  color,
  bgColor,
}: {
  stage: string;
  count: number;
  total: number;
  color: string;
  bgColor: string;
}) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
  return (
    <div className={`rounded-lg ${bgColor} p-4`}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{stage}</p>
      <p className={`text-2xl font-bold ${color}`}>{formatNumber(count)}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{pct}% do total</p>
    </div>
  );
}
