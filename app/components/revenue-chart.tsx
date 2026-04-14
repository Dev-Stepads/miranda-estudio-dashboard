'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ChartData {
  day: string;
  nuvemshop: number;
  conta_azul: number;
}

interface RevenueChartProps {
  data: ChartData[];
  /** Which sources to show. Default: both. */
  sources?: Array<'nuvemshop' | 'conta_azul'>;
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return `R$${(value / 1000).toFixed(1)}k`;
  return `R$${value.toFixed(0)}`;
}

function formatDay(day: string) {
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const SOURCE_LABELS: Record<string, string> = {
  nuvemshop: 'E-commerce (Nuvemshop)',
  conta_azul: 'Loja Física (Conta Azul)',
};

const SOURCE_COLORS: Record<string, string> = {
  nuvemshop: '#6366f1',
  conta_azul: '#f59e0b',
};

export function RevenueChart({ data, sources }: RevenueChartProps) {
  const activeSources = sources ?? ['nuvemshop', 'conta_azul'];
  const showLegend = activeSources.length > 1;

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 sm:mb-4">
        Faturamento Diário
      </h3>
      <div className="h-56 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
            />
            <YAxis
              tickFormatter={formatCurrency}
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
              width={70}
            />
            <Tooltip
              formatter={(value, name) => [
                new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)),
                String(name) === 'nuvemshop' ? 'E-commerce' : 'Loja Física',
              ]}
              labelFormatter={(label) => {
                const d = new Date(String(label) + 'T12:00:00');
                return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
              }}
            />
            {showLegend && (
              <Legend
                formatter={(value: string) => SOURCE_LABELS[value] ?? value}
              />
            )}
            {activeSources.includes('nuvemshop') && (
              <Bar dataKey="nuvemshop" fill={SOURCE_COLORS.nuvemshop} radius={[4, 4, 0, 0]} />
            )}
            {activeSources.includes('conta_azul') && (
              <Bar dataKey="conta_azul" fill={SOURCE_COLORS.conta_azul} radius={[4, 4, 0, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
