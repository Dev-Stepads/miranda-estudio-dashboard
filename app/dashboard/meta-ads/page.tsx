export const dynamic = 'force-dynamic';

import {
  fetchMetaDaily,
  fetchMetaCampaignRanking,
  fetchMetaAdRanking,
  parsePeriod,
  classifyCampaign,
} from '../../lib/queries';
import { KpiCard, formatBRL, formatNumber } from '../../components/kpi-cards';
import { SimpleTable } from '../../components/simple-table';
import { CreativeRankingTable } from '../../components/creative-ranking-table';
import { SpendChart } from '../../components/spend-chart';

export default async function MetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params);

  const [daily, campaignRanking, adRanking] = await Promise.all([
    fetchMetaDaily(period.days, params.from, params.to),
    fetchMetaCampaignRanking(period.days, params.from, params.to, 30),
    fetchMetaAdRanking(period.days, params.from, params.to, 30),
  ]);

  // Empty-state: ETL ainda não rodou
  if (daily.length === 0 && campaignRanking.length === 0) {
    return <EmptyState />;
  }

  // Separate campaigns by type
  const vendasCampaigns = campaignRanking.filter(c => c.campaign_type === 'vendas');
  const lojaCampaigns = campaignRanking.filter(c => c.campaign_type === 'loja');

  // Separate ads by campaign type
  const vendasAdIds = new Set(vendasCampaigns.map(c => c.campaign_id));
  const vendasAds = adRanking.filter(a => {
    const campId = campaignRanking.find(c => c.campaign_name === a.campaign_name)?.campaign_id;
    return campId ? vendasAdIds.has(campId) : classifyCampaign(a.campaign_name) === 'vendas';
  });
  const lojaAds = adRanking.filter(a => !vendasAds.includes(a));

  // ---- KPIs Vendas ----
  const vendasSpend = vendasCampaigns.reduce((s, c) => s + c.total_spend, 0);
  const vendasPurchases = vendasCampaigns.reduce((s, c) => s + c.total_purchases, 0);
  const vendasPurchaseValue = vendasCampaigns.reduce((s, c) => s + c.total_purchase_value, 0);
  const vendasClicks = vendasCampaigns.reduce((s, c) => s + c.total_clicks, 0);
  const vendasImpressions = vendasCampaigns.reduce((s, c) => s + c.total_impressions, 0);
  const vendasRoas = vendasSpend > 0 ? vendasPurchaseValue / vendasSpend : 0;
  const vendasCpa = vendasPurchases > 0 ? vendasSpend / vendasPurchases : 0;
  const vendasCtr = vendasImpressions > 0 ? (vendasClicks / vendasImpressions) * 100 : 0;
  const vendasCpc = vendasClicks > 0 ? vendasSpend / vendasClicks : 0;

  // ---- KPIs Loja ----
  const lojaSpend = lojaCampaigns.reduce((s, c) => s + c.total_spend, 0);
  const lojaImpressions = lojaCampaigns.reduce((s, c) => s + c.total_impressions, 0);
  const lojaClicks = lojaCampaigns.reduce((s, c) => s + c.total_clicks, 0);
  const lojaCtr = lojaImpressions > 0 ? (lojaClicks / lojaImpressions) * 100 : 0;
  const lojaCpc = lojaClicks > 0 ? lojaSpend / lojaClicks : 0;
  const lojaCpm = lojaImpressions > 0 ? (lojaSpend / lojaImpressions) * 1000 : 0;

  // ---- KPIs Totais ----
  const totalSpend = daily.reduce((s, r) => s + r.spend, 0);
  const totalPurchases = daily.reduce((s, r) => s + r.purchases, 0);
  const totalPurchaseValue = daily.reduce((s, r) => s + r.purchase_value, 0);
  const totalRoas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

  return (
    <div className="space-y-4 sm:space-y-8">
      {/* Disclaimer */}
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
        <strong>Nota:</strong> metricas de trafego pago sao atribuicao de midia,
        nao vendas. O valor de compras do Meta <em>nao</em> e somado ao faturamento
        da aba Visao Geral.
      </div>

      {/* KPIs Gerais */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Investimento Total"
          value={formatBRL(totalSpend)}
          subtitle={period.label}
        />
        <KpiCard
          title="Compras Atribuidas"
          value={formatNumber(totalPurchases)}
          subtitle={`${formatBRL(totalPurchaseValue)} em valor`}
        />
        <KpiCard
          title="ROAS Geral"
          value={`${totalRoas.toFixed(2)}x`}
          subtitle={totalRoas > 1 ? 'retorno positivo' : 'retorno abaixo do investido'}
        />
        <KpiCard
          title="Split Investimento"
          value={`${vendasSpend > 0 && totalSpend > 0 ? ((vendasSpend / totalSpend) * 100).toFixed(0) : 0}% vendas`}
          subtitle={`${lojaSpend > 0 && totalSpend > 0 ? ((lojaSpend / totalSpend) * 100).toFixed(0) : 0}% loja/branding`}
        />
      </section>

      {/* Grafico */}
      <SpendChart data={daily} />

      {/* ============================================ */}
      {/* BLOCO 1: CAMPANHAS DE VENDAS */}
      {/* ============================================ */}
      <div className="border-t-2 border-indigo-200 dark:border-indigo-800 pt-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
          Campanhas de Vendas
        </h2>

        {vendasCampaigns.length > 0 ? (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <KpiCard title="Investimento" value={formatBRL(vendasSpend)} subtitle="campanhas de vendas" />
              <KpiCard title="Compras" value={formatNumber(vendasPurchases)} subtitle={`${formatBRL(vendasPurchaseValue)} em valor`} />
              <KpiCard title="ROAS" value={`${vendasRoas.toFixed(2)}x`} subtitle={vendasRoas > 1 ? 'retorno positivo' : 'abaixo do investido'} />
              <KpiCard title="CPA" value={formatBRL(vendasCpa)} subtitle={`CTR ${vendasCtr.toFixed(2)}% | CPC ${formatBRL(vendasCpc)}`} />
            </section>

            <SimpleTable
              title="Ranking — Vendas"
              subtitle="Campanhas com objetivo de conversao"
              columns={[
                { key: 'display_name', label: 'Campanha' },
                { key: 'total_spend', label: 'Investimento', align: 'right', format: 'currency', sortable: true },
                { key: 'total_purchases', label: 'Compras', align: 'right', format: 'number', sortable: true },
                { key: 'total_purchase_value', label: 'Faturamento', align: 'right', format: 'currency', sortable: true },
                { key: 'roas_str', label: 'ROAS', align: 'right', sortable: true, sortValue: 'roas' },
                { key: 'cpa_str', label: 'CPA', align: 'right', sortable: true, sortValue: 'cpa' },
                { key: 'ctr_str', label: 'CTR', align: 'right', sortable: true, sortValue: 'ctr' },
                { key: 'cpc_str', label: 'CPC', align: 'right', sortable: true, sortValue: 'cpc' },
              ]}
              rows={vendasCampaigns.map(c => ({
                ...c,
                roas_str: c.roas > 0 ? `${c.roas.toFixed(2)}x` : '—',
                cpa: c.total_purchases > 0 ? c.total_spend / c.total_purchases : 0,
                cpa_str: c.total_purchases > 0 ? formatBRL(c.total_spend / c.total_purchases) : '—',
                ctr_str: `${c.ctr.toFixed(2)}%`,
                cpc_str: formatBRL(c.cpc),
              }))}
              defaultSort={{ key: 'total_spend', direction: 'desc' }}
            />

            {vendasAds.length > 0 && (
              <div className="mt-4">
                <CreativeRankingTable
                  title="Criativos — Vendas"
                  subtitle="Anuncios das campanhas de conversao"
                  rows={vendasAds.map(a => ({
                    ad_id: a.ad_id,
                    ad_name: a.ad_name,
                    campaign_name: a.campaign_name,
                    thumbnail_url: a.thumbnail_url,
                    total_spend: a.total_spend,
                    total_impressions: a.total_impressions,
                    total_clicks: a.total_clicks,
                    total_purchases: a.total_purchases,
                    total_purchase_value: a.total_purchase_value,
                    roas: a.roas,
                  }))}
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400 py-4">Nenhuma campanha de vendas no periodo</p>
        )}
      </div>

      {/* ============================================ */}
      {/* BLOCO 2: CAMPANHAS DE LOJA / BRANDING */}
      {/* ============================================ */}
      <div className="border-t-2 border-emerald-200 dark:border-emerald-800 pt-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
          Campanhas de Loja / Branding
        </h2>

        {lojaCampaigns.length > 0 ? (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <KpiCard title="Investimento" value={formatBRL(lojaSpend)} subtitle="campanhas de loja" />
              <KpiCard title="Impressoes" value={formatNumber(lojaImpressions)} subtitle={`CPM ${formatBRL(lojaCpm)}`} />
              <KpiCard title="Cliques" value={formatNumber(lojaClicks)} subtitle={`CTR ${lojaCtr.toFixed(2)}%`} />
              <KpiCard title="CPC" value={formatBRL(lojaCpc)} subtitle="custo por clique" />
            </section>

            <SimpleTable
              title="Ranking — Loja / Branding"
              subtitle="Campanhas de engajamento, alcance e mensagens"
              columns={[
                { key: 'display_name', label: 'Campanha' },
                { key: 'total_spend', label: 'Investimento', align: 'right', format: 'currency', sortable: true },
                { key: 'total_impressions', label: 'Impressoes', align: 'right', format: 'number', sortable: true },
                { key: 'total_clicks', label: 'Cliques', align: 'right', format: 'number', sortable: true },
                { key: 'ctr_str', label: 'CTR', align: 'right', sortable: true, sortValue: 'ctr' },
                { key: 'cpc_str', label: 'CPC', align: 'right', sortable: true, sortValue: 'cpc' },
                { key: 'cpm_str', label: 'CPM', align: 'right', sortable: true, sortValue: 'cpm' },
              ]}
              rows={lojaCampaigns.map(c => ({
                ...c,
                ctr_str: `${c.ctr.toFixed(2)}%`,
                cpc_str: c.cpc > 0 ? formatBRL(c.cpc) : '—',
                cpm: c.total_impressions > 0 ? (c.total_spend / c.total_impressions) * 1000 : 0,
                cpm_str: c.total_impressions > 0 ? formatBRL((c.total_spend / c.total_impressions) * 1000) : '—',
              }))}
              defaultSort={{ key: 'total_spend', direction: 'desc' }}
            />

            {lojaAds.length > 0 && (
              <div className="mt-4">
                <CreativeRankingTable
                  title="Criativos — Loja / Branding"
                  subtitle="Anuncios das campanhas de engajamento"
                  showPurchases={false}
                  rows={lojaAds.map(a => ({
                    ad_id: a.ad_id,
                    ad_name: a.ad_name,
                    campaign_name: a.campaign_name,
                    thumbnail_url: a.thumbnail_url,
                    total_spend: a.total_spend,
                    total_impressions: a.total_impressions,
                    total_clicks: a.total_clicks,
                    total_purchases: a.total_purchases,
                    total_purchase_value: a.total_purchase_value,
                    roas: a.roas,
                  }))}
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400 py-4">Nenhuma campanha de loja/branding no periodo</p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Empty state
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
              trazer os ultimos 90 dias, ou espere o cron de 30 min rodar sozinho.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
