'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface ChannelDonutProps {
  nuvemshop: number;
  contaAzul: number;
}

const COLORS = ['#6366f1', '#f59e0b'];

export function ChannelDonut({ nuvemshop, contaAzul }: ChannelDonutProps) {
  const total = nuvemshop + contaAzul;
  if (total === 0) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700" role="img" aria-label="Gráfico de distribuição por canal de venda">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">
          Split por Canal
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">Sem dados para o periodo</p>
      </div>
    );
  }

  const data = [
    { name: 'E-commerce', value: nuvemshop },
    { name: 'Loja Física', value: contaAzul },
  ];

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700" role="img" aria-label="Gráfico de distribuição por canal de venda">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">
        Split por Canal
      </h3>

      <div className="h-48 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
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
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
              labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
              itemStyle={{ color: '#d1d5db' }}
              formatter={(value) => [
                new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legenda abaixo do gráfico */}
      <div className="flex justify-center gap-8 mt-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />
            <span className="text-xs text-gray-600 dark:text-gray-300">
              E-commerce {((nuvemshop / total) * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(nuvemshop)}
          </p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
            <span className="text-xs text-gray-600 dark:text-gray-300">
              Loja Física {((contaAzul / total) * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(contaAzul)}
          </p>
        </div>
      </div>
    </div>
  );
}
