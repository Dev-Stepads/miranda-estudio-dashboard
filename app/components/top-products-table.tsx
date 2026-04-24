'use client';

import { useState, useMemo } from 'react';
import type { TopProduct } from '../lib/queries';
import { formatBRL, formatNumber } from './kpi-cards';
import { useSortableTable } from './use-sortable-table';

interface TopProductsTableProps {
  products: TopProduct[];
  pageSize?: number;
}

const CATEGORY_BADGE: Record<string, string> = {
  CASA: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  CORPO: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  PAPELARIA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
};

export function TopProductsTable({ products, pageSize }: TopProductsTableProps) {
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue_total, 0);

  // Enrich rows with computed pct field so it's sortable
  const enriched = useMemo(
    () =>
      products.map((p) => ({
        ...p,
        pct: totalRevenue > 0 ? (p.revenue_total / totalRevenue) * 100 : 0,
      })),
    [products, totalRevenue],
  );

  const { sortedRows, requestSort, getSortIndicator } =
    useSortableTable(enriched, { key: 'revenue_total', direction: 'desc' });

  const [showAll, setShowAll] = useState(false);
  const visibleRows =
    pageSize && !showAll ? sortedRows.slice(0, pageSize) : sortedRows;

  const sortableThClass =
    'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200';

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Vendas de Produtos</h3>
        <p className="text-xs sm:text-sm text-gray-400 mt-1">Produtos vendidos no periodo</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th scope="col" className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">#</th>
              <th scope="col" className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Produto</th>
              <th scope="col" className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Categoria</th>
              <th
                scope="col"
                className={`px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${sortableThClass}`}
                onClick={() => requestSort('quantity_total')}
              >
                Qtd
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('quantity_total')}</span>
              </th>
              <th
                scope="col"
                className={`px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${sortableThClass}`}
                onClick={() => requestSort('revenue_total')}
              >
                Faturamento
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('revenue_total')}</span>
              </th>
              <th
                scope="col"
                className={`px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${sortableThClass}`}
                onClick={() => requestSort('pct')}
              >
                %
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('pct')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((p, i) => (
              <tr key={`${p.product_name}-${p.sku ?? i}`} className="border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <td className="px-3 sm:px-6 py-2 sm:py-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                <td className="px-3 sm:px-6 py-2 sm:py-3">
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-xs sm:text-sm">{p.product_name}</span>
                </td>
                <td className="px-3 sm:px-6 py-2 sm:py-3">
                  {p.category && CATEGORY_BADGE[p.category] ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CATEGORY_BADGE[p.category]}`}>
                      {p.category}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">&mdash;</span>
                  )}
                </td>
                <td className="px-3 sm:px-6 py-2 sm:py-3 text-right text-gray-700 dark:text-gray-300 font-mono text-xs sm:text-sm">
                  {formatNumber(p.quantity_total)}
                </td>
                <td className="px-3 sm:px-6 py-2 sm:py-3 text-right font-semibold text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                  {formatBRL(p.revenue_total)}
                </td>
                <td className="px-3 sm:px-6 py-2 sm:py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                  {p.pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize && sortedRows.length > pageSize && (
        <div className="px-4 sm:px-6 py-3 border-t border-gray-100 dark:border-gray-700 text-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors cursor-pointer"
          >
            {showAll ? 'Ver menos' : `Ver todos (${sortedRows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
