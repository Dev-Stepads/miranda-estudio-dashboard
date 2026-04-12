import type { MonthlyData } from '../lib/queries';

interface MonthlyComparisonProps {
  data: MonthlyData[];
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const idx = Number(m) - 1;
  return `${months[idx] ?? m}/${year?.slice(2)}`;
}

export function MonthlyComparison({ data }: MonthlyComparisonProps) {
  // Find max revenue for bar width
  const maxRevenue = Math.max(...data.map(d => d.revenue), 1);

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
          Comparativo Mensal
        </h3>
        <p className="text-xs sm:text-sm text-gray-400 mt-1">Evolução mês a mês (todas as fontes)</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th className="px-4 sm:px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Mês</th>
              <th className="px-4 sm:px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Faturamento</th>
              <th className="px-4 sm:px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Pedidos</th>
              <th className="px-4 sm:px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Ticket</th>
              <th className="px-4 sm:px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">vs anterior</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.month}
                className={`border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  i === 0 ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''
                }`}
              >
                <td className="px-4 sm:px-6 py-2.5 font-medium text-gray-800 dark:text-gray-200 text-xs sm:text-sm">
                  {formatMonth(row.month)}
                </td>
                <td className="px-4 sm:px-6 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-xs sm:text-sm whitespace-nowrap">
                      {formatBRL(row.revenue)}
                    </span>
                    <div className="hidden sm:block flex-1 max-w-24">
                      <div
                        className="h-2 rounded-full bg-indigo-400/60"
                        style={{ width: `${(row.revenue / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 sm:px-6 py-2.5 text-right text-gray-700 dark:text-gray-300 font-mono text-xs sm:text-sm">
                  {row.orders.toLocaleString('pt-BR')}
                </td>
                <td className="px-4 sm:px-6 py-2.5 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">
                  {formatBRL(row.avgTicket)}
                </td>
                <td className="px-4 sm:px-6 py-2.5 text-right text-xs">
                  {row.changePercent !== null ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ${
                      row.changePercent >= 0
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {row.changePercent >= 0 ? '↑' : '↓'} {Math.abs(row.changePercent).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
