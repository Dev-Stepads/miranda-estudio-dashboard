'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface ChannelDonutProps {
  nuvemshop: number;
  contaAzul: number;
}

const COLORS = ['#6366f1', '#f59e0b'];

export function ChannelDonut({ nuvemshop, contaAzul }: ChannelDonutProps) {
  const total = nuvemshop + contaAzul;
  if (total === 0) return null;

  const data = [
    { name: 'E-commerce (Nuvemshop)', value: nuvemshop },
    { name: 'Loja Física (Conta Azul)', value: contaAzul },
  ];

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Split por Canal</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              label={({ name, percent }) =>
                `${String(name ?? '').split('(')[0]?.trim()} ${((percent ?? 0) * 100).toFixed(1)}%`
              }
              labelLine={false}
            >
              {data.map((_entry, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [
                new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)),
              ]}
            />
            <Legend
              formatter={(value: string) => (
                <span className="text-sm text-gray-600">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
