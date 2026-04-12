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
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Split por Canal</h3>
      <div className="flex justify-center gap-4 text-xs mb-4">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">E-commerce {total > 0 ? `${((nuvemshop / total) * 100).toFixed(1)}%` : ''}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
          <span className="text-gray-600 dark:text-gray-300">Loja Física {total > 0 ? `${((contaAzul / total) * 100).toFixed(1)}%` : ''}</span>
        </span>
      </div>
      <div className="h-44 sm:h-56">
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
              label={false}
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
