'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useDarkMode } from './use-dark-mode';

interface GeoChartProps {
  data: Array<{ state: string; revenue: number; orders_count: number }>;
}

export function GeographyChart({ data }: GeoChartProps) {
  const dark = useDarkMode();
  const gridColor = dark ? '#374151' : '#e5e7eb';
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 sm:mb-4">
        Faturamento por Estado
      </h3>
      <div className="h-56 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              type="number"
              tickFormatter={(v) => `R$${(Number(v) / 1000).toFixed(0)}k`}
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
            />
            <YAxis
              type="category"
              dataKey="state"
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
              width={30}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
              labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
              itemStyle={{ color: '#d1d5db' }}
              formatter={(value) => [
                new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)),
                'Faturamento',
              ]}
            />
            <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
