interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  /** Percentage change vs previous period. Positive = green, negative = red. */
  change?: number | null;
}

export function KpiCard({ title, value, subtitle, change }: KpiCardProps) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
        {change !== undefined && change !== null && Number.isFinite(change) && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              change >= 0
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="mt-1 sm:mt-2 text-xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{value}</p>
      {subtitle && (
        <p className="mt-1 text-sm text-gray-400 dark:text-gray-300">{subtitle}</p>
      )}
    </div>
  );
}

/** Calculate % change between current and previous values.
 *
 * Returns null when previous === 0. We used to return 100 when previous=0 and
 * current>0, but that produced a fake "+100%" badge on every card when the
 * previous period had no data (e.g. "1 ano" filter with data only from Nov 2025,
 * or any period where the comparison window falls before our data floor). A
 * null return hides the badge, which is more honest than displaying a
 * mathematically undefined number as a real growth figure.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}
