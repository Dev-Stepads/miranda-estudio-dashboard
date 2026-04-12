import type { TopProduct } from '../lib/queries';
import { formatBRL, formatNumber } from './kpi-cards';

interface TopProductsTableProps {
  products: TopProduct[];
}

export function TopProductsTable({ products }: TopProductsTableProps) {
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue_total, 0);

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Top Produtos</h3>
        <p className="text-xs sm:text-sm text-gray-400 mt-1">Ranking por faturamento consolidado</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">#</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Produto</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Qtd</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Faturamento</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">%</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const pct = totalRevenue > 0 ? ((p.revenue_total / totalRevenue) * 100) : 0;
              return (
                <tr key={`${p.product_name}-${p.sku ?? i}`} className="border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-3 sm:px-6 py-2 sm:py-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                  <td className="px-3 sm:px-6 py-2 sm:py-3">
                    <span className="font-medium text-gray-900 dark:text-gray-100 text-xs sm:text-sm">{p.product_name}</span>
                  </td>
                  <td className="px-3 sm:px-6 py-2 sm:py-3 text-right text-gray-700 dark:text-gray-300 font-mono text-xs sm:text-sm">
                    {formatNumber(p.quantity_total)}
                  </td>
                  <td className="px-3 sm:px-6 py-2 sm:py-3 text-right font-semibold text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                    {formatBRL(p.revenue_total)}
                  </td>
                  <td className="px-3 sm:px-6 py-2 sm:py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                    {pct.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
