'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface RecurrenceCardProps {
  firstTime: number;
  repeat: number;
  repeatRate: number;
  label: string;
}

const COLORS = ['#94a3b8', '#10b981'];

export function RecurrenceCard({ firstTime, repeat, repeatRate, label }: RecurrenceCardProps) {
  const total = firstTime + repeat;
  if (total === 0) return null;

  const data = [
    { name: 'Primeira compra', value: firstTime },
    { name: 'Recorrentes', value: repeat },
  ];

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        Recorrência de Clientes
      </h3>
      <p className="text-xs text-gray-400 mb-4">{label}</p>

      <div className="flex items-center gap-6">
        {/* Mini donut */}
        <div className="w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={45}
                paddingAngle={2}
                dataKey="value"
                label={false}
              >
                {data.map((_entry, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [
                  `${Number(value).toLocaleString('pt-BR')} clientes`,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stats */}
        <div className="space-y-3">
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-emerald-600">{repeatRate}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">taxa de recompra</p>
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span className="text-gray-600 dark:text-gray-300">Recorrentes</span>
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{repeat.toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
                <span className="text-gray-600 dark:text-gray-300">Primeira compra</span>
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{firstTime.toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
