export const dynamic = 'force-dynamic';

import {
  fetchMetaDaily,
  fetchMetaCampaignRanking,
  fetchMetaAdRanking,
  parsePeriod,
} from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber, percentChange } from '../../components/kpi-cards';
import { SimpleTable } from '../../components/simple-table';
import { SpendChart } from '../../components/spend-chart';

export default async function MetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  const [daily, prevDaily, campaignRanking, adRanking] = await Promise.all([
    fetchMetaDaily(period.days, params.from, params.to),
    fetchMetaDaily(period.days * 2),
    fetchMetaCampaignRanking(period.days, params.from, params.to, 15),
    fetchMetaAdRanking(period.days, params.from, params.to, 15),
  ]);

  // Empty-state: ETL ainda não rodou nenhuma vez com o token novo
  if (daily.length === 0 && campaignRanking.length === 0) {
    return <EmptyState />;
  }

  // ---- KPIs atual ----
  const totalSpend = daily.reduce((s, r) => s + r.spend, 0);
  const totalImpressions = daily.reduce((s, r) => s + r.impressions, 0);
  const totalReach = daily.reduce((s, r) => s + r.reach, 0);
  const totalClicks = daily.reduce((s, r) => s + r.clicks, 0);
  const totalPurchases = daily.reduce((s, r) => s + r.purchases, 0);
  const totalPurchaseValue = daily.reduce((s, r) => s + r.purchase_value, 0);

  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const cpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
  const roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

  // ---- Periodo anterior p/ comparação ----
  // Compare date strings directly (YYYY-MM-DD) to avoid timezone issues.
  // period.since is already in São Paulo timezone from parsePeriod().
  const prev = prevDaily.filter((r) => r.date < period.since);
  const prevSpend = prev.reduce((s, r) => s + r.spend, 0);
  const prevPurchases = prev.reduce((s, r) => s + r.purchases, 0);
  const prevPurchaseValue = prev.reduce((s, r) => s + r.purchase_value, 0);
  const prevRoas = prevSpend > 0 ? prevPurchaseValue / prevSpend : 0;

  return (
    <div className="space-y-4 sm:space-y-8">
      {/* Disclaimer: Meta Ads não soma no faturamento da Visão Geral */}
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
        <strong>Nota:</strong> métricas de tráfego pago são atribuição de mídia,
        não vendas. O valor de compras do Meta <em>não</em> é somado ao faturamento
        da aba Visão Geral — ele vive aqui, isolado. Venda real vem da Loja Física
        (Conta Azul) + Nuvemshop.
      </div>

      {/* KPI row 1 — investimento + conversão */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Investimento"
          value={formatBRL(totalSpend)}
          subtitle={period.label}
          change={percentChange(totalSpend, prevSpend)}
        />
        <KpiCard
          title="Compras atribuídas"
          value={formatNumber(totalPurchases)}
          subtitle={`${formatBRL(totalPurchaseValue)} em valor`}
          change={percentChange(totalPurchases, prevPurchases)}
        />
        <KpiCard
          title="ROAS"
          value={`${roas.toFixed(2)}x`}
          subtitle={roas > 1 ? 'retorno positivo' : 'retorno abaixo do investido'}
          change={percentChange(roas, prevRoas)}
        />
        <KpiCard
          title="CPA (custo por compra)"
          value={formatBRL(cpa)}
          subtitle={`Ticket médio atribuído ${formatBRL(totalPurchases > 0 ? totalPurchaseValue / totalPurchases : 0)}`}
        />
      </section>

      {/* KPI row 2 — entrega */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Impressões"
          value={formatNumber(totalImpressions)}
          subtitle={period.label}
        />
        <KpiCard
          title="Cliques"
          value={formatNumber(totalClicks)}
          subtitle={`CTR ${ctr.toFixed(2)}%`}
        />
        <KpiCard
          title="CPC (custo por clique)"
          value={formatBRL(cpc)}
          subtitle="clique de link"
        />
        <KpiCard
          title="Alcance"
          value={formatNumber(totalReach)}
          subtitle={`${formatNumber(totalImpressions)} impressões`}
        />
      </section>

      {/* Gráfico spend vs purchase_value — usa SpendChart custom */}
      <SpendChart data={daily} />

      {/* Ranking de campanhas */}
      <SimpleTable
        title="Ranking de Campanhas"
        subtitle="Ordenado por investimento no período"
        columns={[
          { key: 'campaign_name', label: 'Campanha' },
          { key: 'total_spend', label: 'Investimento', align: 'right', format: 'currency' },
          { key: 'total_impressions', label: 'Impressões', align: 'right', format: 'number' },
          { key: 'total_clicks', label: 'Cliques', align: 'right', format: 'number' },
          { key: 'total_purchases', label: 'Compras', align: 'right', format: 'number' },
          { key: 'total_purchase_value', label: 'Valor compras', align: 'right', format: 'currency' },
          { key: 'roas_str', label: 'ROAS', align: 'right' },
        ]}
        rows={campaignRanking.map((c) => {
          // Append short ID suffix when multiple campaigns share the same name
          const sameNameCount = campaignRanking.filter(
            (o) => o.campaign_name === c.campaign_name,
          ).length;
          const displayName =
            sameNameCount > 1
              ? `${c.campaign_name ?? '(sem nome)'} (#…${c.campaign_id.slice(-4)})`
              : (c.campaign_name ?? '(sem nome)');
          return {
            ...c,
            campaign_name: displayName,
            roas_str: `${c.roas.toFixed(2)}x`,
          };
        }) as unknown as Record<string, unknown>[]}
      />

      {/* Ranking de criativos */}
      <SimpleTable
        title="Ranking de Criativos"
        subtitle="Anúncios (nível ad) — ordenado por investimento"
        columns={[
          { key: 'ad_name', label: 'Anúncio' },
          { key: 'campaign_name', label: 'Campanha' },
          { key: 'total_spend', label: 'Investimento', align: 'right', format: 'currency' },
          { key: 'total_clicks', label: 'Cliques', align: 'right', format: 'number' },
          { key: 'total_purchases', label: 'Compras', align: 'right', format: 'number' },
          { key: 'roas_str', label: 'ROAS', align: 'right' },
        ]}
        rows={adRanking.map((a) => ({
          ...a,
          ad_name: a.ad_name ?? '(sem nome)',
          campaign_name: a.campaign_name ?? '(sem nome)',
          roas_str: `${a.roas.toFixed(2)}x`,
        })) as unknown as Record<string, unknown>[]}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Empty state — shown when ETL hasn't run yet
// ------------------------------------------------------------

function EmptyState() {
  return (
    <div className="space-y-4 sm:space-y-8">
      <div className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 p-6 sm:p-8 text-white shadow-lg">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center text-2xl shrink-0">
            📊
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">Meta Ads</h2>
            <p className="text-sm sm:text-base opacity-90 mt-1">
              Credenciais configuradas — aguardando primeiro sync.
            </p>
            <p className="text-xs opacity-70 mt-3">
              Rode <code className="bg-white/20 px-1 rounded">npm run sync:meta-ads:full</code> pra
              trazer os últimos 90 dias, ou espere o cron de 30 min rodar sozinho.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="text-base sm:text-lg font-semibold mb-4">
          O que vai aparecer aqui depois do primeiro sync
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: '💰', label: 'Investimento', desc: 'Spend total no período' },
            { icon: '📈', label: 'ROAS', desc: 'Retorno sobre investimento' },
            { icon: '🛒', label: 'Compras', desc: 'Conversões atribuídas' },
            { icon: '🎯', label: 'Ranking Campanhas', desc: 'Por spend e ROAS' },
            { icon: '🎨', label: 'Ranking Criativos', desc: 'Por anúncio individual' },
            { icon: '🖱️', label: 'CPC / CTR', desc: 'Custo e taxa de clique' },
            { icon: '👥', label: 'Alcance', desc: 'Impressões + reach' },
            { icon: '📊', label: 'Série diária', desc: 'Spend vs compras' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <span className="text-2xl">{item.icon}</span>
              <p className="text-sm font-medium mt-1">{item.label}</p>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
