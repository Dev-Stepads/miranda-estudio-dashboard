'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface SpendChartRow {
  date: string;
  spend: number;
  purchase_value: number;
}

interface SpendChartProps {
  data: SpendChartRow[];
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return `R$${(value / 1000).toFixed(1)}k`;
  return `R$${value.toFixed(0)}`;
}

function formatDay(date: string) {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function SpendChart({ data }: SpendChartProps) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        Investimento vs Valor Atribuído
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 sm:mb-4">
        Barra = spend, linha = valor de compras atribuídas (atribuição 7d click + 1d view)
      </p>
      <div className="h-56 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
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
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
              labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
              itemStyle={{ color: '#d1d5db' }}
              formatter={(value, name) => [
                new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                }).format(Number(value)),
                String(name) === 'spend' ? 'Investimento' : 'Valor atribuído',
              ]}
              labelFormatter={(label) => {
                const d = new Date(String(label) + 'T12:00:00');
                return d.toLocaleDateString('pt-BR', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                });
              }}
            />
            <Legend
              formatter={(value: string) =>
                value === 'spend' ? 'Investimento' : 'Valor atribuído (purchase_value)'
              }
            />
            <Bar dataKey="spend" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            <Line
              type="monotone"
              dataKey="purchase_value"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
