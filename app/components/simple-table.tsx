import { formatBRL, formatNumber } from './kpi-cards';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: 'currency' | 'number' | 'text';
}

interface SimpleTableProps {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: object[];
}

export function SimpleTable({ title, subtitle, columns, rows }: SimpleTableProps) {
  function formatCell(value: unknown, format?: string): string {
    if (value === null || value === undefined) return '—';
    if (format === 'currency') return formatBRL(Number(value));
    if (format === 'number') return formatNumber(Number(value));
    return String(value);
  }

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {subtitle && <p className="text-xs sm:text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 sm:px-6 py-2 sm:py-3 font-medium text-gray-500 dark:text-gray-400 ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 sm:px-6 py-2 sm:py-3 ${
                      col.align === 'right' ? 'text-right font-mono' : ''
                    } ${col.format === 'currency' ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}
                  >
                    {formatCell((row as Record<string, unknown>)[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 sm:px-6 py-8 text-center text-gray-400">
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
