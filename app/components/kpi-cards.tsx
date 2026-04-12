interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  /** Percentage change vs previous period. Positive = green, negative = red. */
  change?: number | null;
}

export function KpiCard({ title, value, subtitle, change }: KpiCardProps) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {change !== undefined && change !== null && Number.isFinite(change) && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              change >= 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value}</p>
      {subtitle && (
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      )}
    </div>
  );
}

/** Calculate % change between current and previous values. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
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
