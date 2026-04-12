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
}

function formatCurrency(value: number) {
  if (value >= 1000) return `R$${(value / 1000).toFixed(1)}k`;
  return `R$${value.toFixed(0)}`;
}

function formatDay(day: string) {
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Faturamento Diário
      </h3>
      <div className="h-80">
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
            <Legend
              formatter={(value: string) =>
                value === 'nuvemshop' ? 'E-commerce (Nuvemshop)' : 'Loja Física (Conta Azul)'
              }
            />
            <Bar dataKey="nuvemshop" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="conta_azul" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
