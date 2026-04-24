'use client';

import { useState } from 'react';
import { formatBRL, formatNumber } from './kpi-cards';
import { useSortableTable } from './use-sortable-table';

/**
 * Ranking de criativos (nivel ad) com thumbnail da imagem do criativo.
 * Formato inspirado no ranking do Ads Manager, referencia visual enviada
 * pela Miranda 2026-04-14.
 *
 * Thumbnail usa <img> puro em vez de next/image porque os dominios da
 * Meta (scontent*.fbcdn.net, scontent-*.xx.fbcdn.net, etc.) variam por
 * datacenter — configurar remotePatterns pra cobrir todos eh mais
 * fragil do que renderizar direto.
 */

export interface CreativeRankingRow {
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  thumbnail_url: string | null;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_purchases: number;
  total_purchase_value: number;
  roas: number;
}

interface Props {
  title: string;
  subtitle?: string;
  rows: CreativeRankingRow[];
  showPurchases?: boolean;
}

const SORTABLE_TH =
  'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200';

export function CreativeRankingTable({ title, subtitle, rows, showPurchases = true }: Props) {
  const { sortedRows, requestSort, getSortIndicator } = useSortableTable(
    rows,
    { key: 'total_spend', direction: 'desc' },
  );

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs sm:text-sm text-gray-400 mt-1">{subtitle}</p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th scope="col" className="w-14 px-3 py-3 text-left font-medium text-gray-500 dark:text-gray-400">

              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                Criativo
              </th>
              <th
                scope="col"
                className={`px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('total_spend')}
              >
                Investimento
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('total_spend')}</span>
              </th>
              <th
                scope="col"
                className={`px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('total_impressions')}
              >
                Impressões
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('total_impressions')}</span>
              </th>
              <th
                scope="col"
                className={`px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('total_clicks')}
              >
                Cliques
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('total_clicks')}</span>
              </th>
              {showPurchases && (
                <th
                  scope="col"
                  className={`px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                  onClick={() => requestSort('total_purchases')}
                >
                  Compras
                  <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('total_purchases')}</span>
                </th>
              )}
              {showPurchases && (
                <th
                  scope="col"
                  className={`px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                  onClick={() => requestSort('total_purchase_value')}
                >
                  Receita
                  <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('total_purchase_value')}</span>
                </th>
              )}
              {showPurchases && (
                <th
                  scope="col"
                  className={`px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                  onClick={() => requestSort('roas')}
                >
                  ROAS
                  <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('roas')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.ad_id}
                className="border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <td className="px-3 py-3">
                  <Thumbnail url={row.thumbnail_url} alt={row.ad_name ?? ''} />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[280px]">
                    {row.ad_name ?? '(sem nome)'}
                  </div>
                  <div className="text-xs text-gray-400 truncate max-w-[280px]">
                    {row.campaign_name ?? '(sem campanha)'}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900 dark:text-gray-100">
                  {formatBRL(row.total_spend)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                  {formatNumber(row.total_impressions)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                  {formatNumber(row.total_clicks)}
                </td>
                {showPurchases && (
                  <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                    {row.total_purchases > 0 ? formatNumber(row.total_purchases) : '—'}
                  </td>
                )}
                {showPurchases && (
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900 dark:text-gray-100">
                    {row.total_purchase_value > 0 ? formatBRL(row.total_purchase_value) : '—'}
                  </td>
                )}
                {showPurchases && (
                  <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                    {row.roas > 0 ? `${row.roas.toFixed(2)}x` : '—'}
                  </td>
                )}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={showPurchases ? 8 : 5} className="px-6 py-8 text-center text-gray-400">
                  Sem dados disponíveis
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  if (!url || failed) {
    return (
      <div className="w-10 h-10 rounded-md bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
        —
      </div>
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        width={40}
        height={40}
        className="w-10 h-10 rounded-md object-cover bg-gray-100 dark:bg-gray-900 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        onClick={() => setZoomed(true)}
      />
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            className="max-w-full max-h-[80vh] rounded-lg shadow-2xl"
            referrerPolicy="no-referrer"
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl font-bold hover:text-gray-300"
            onClick={() => setZoomed(false)}
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
