'use client';

import { useState } from 'react';
import { formatBRL, formatNumber } from './kpi-cards';

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
}

export function CreativeRankingTable({ title, subtitle, rows }: Props) {
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
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                Investimento
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                Impressões
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                Cliques
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                Compras
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                Receita
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                ROAS
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                  {row.total_purchases > 0 ? formatNumber(row.total_purchases) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900 dark:text-gray-100">
                  {row.total_purchase_value > 0 ? formatBRL(row.total_purchase_value) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                  {row.roas > 0 ? `${row.roas.toFixed(2)}x` : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
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

  if (!url || failed) {
    return (
      <div className="w-10 h-10 rounded-md bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
        —
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt={alt}
      width={40}
      height={40}
      className="w-10 h-10 rounded-md object-cover bg-gray-100 dark:bg-gray-900"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
