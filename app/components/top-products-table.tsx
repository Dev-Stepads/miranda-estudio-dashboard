import type { TopProduct } from '../lib/queries';
import { formatBRL, formatNumber } from './kpi-cards';

interface TopProductsTableProps {
  products: TopProduct[];
}

export function TopProductsTable({ products }: TopProductsTableProps) {
  return (
    <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 pb-3">
        <h3 className="text-lg font-semibold text-gray-900">Top Produtos</h3>
        <p className="text-sm text-gray-400 mt-1">Ranking por faturamento consolidado</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 bg-gray-50">
              <th className="px-6 py-3 text-left font-medium text-gray-500">#</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Produto</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Qtd</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={`${p.product_name}-${p.sku ?? i}`} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 text-gray-400 font-mono">{i + 1}</td>
                <td className="px-6 py-3">
                  <span className="font-medium text-gray-900">{p.product_name}</span>
                  {p.sku && (
                    <span className="ml-2 text-xs text-gray-400 font-mono">{p.sku}</span>
                  )}
                </td>
                <td className="px-6 py-3 text-right text-gray-700 font-mono">
                  {formatNumber(p.quantity_total)}
                </td>
                <td className="px-6 py-3 text-right font-semibold text-gray-900">
                  {formatBRL(p.revenue_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
