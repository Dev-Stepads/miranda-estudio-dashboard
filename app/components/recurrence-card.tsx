'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface SourceRecurrence {
  label: string;
  firstTime: number;
  repeat: number;
  repeatRate: number;
  color: string;
}

interface RecurrenceCardProps {
  sources: SourceRecurrence[];
  totalFirstTime: number;
  totalRepeat: number;
  totalRepeatRate: number;
}

const COLORS_DONUT = ['#94a3b8', '#10b981'];

function MiniDonut({ firstTime, repeat }: { firstTime: number; repeat: number }) {
  const data = [
    { name: 'Primeira compra', value: firstTime },
    { name: 'Recorrentes', value: repeat },
  ];

  return (
    <div className="w-20 h-20 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={22}
            outerRadius={35}
            paddingAngle={2}
            dataKey="value"
            label={false}
          >
            {data.map((_entry, index) => (
              <Cell key={index} fill={COLORS_DONUT[index % COLORS_DONUT.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => [`${Number(value).toLocaleString('pt-BR')} clientes`]} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RecurrenceCard({ sources, totalFirstTime, totalRepeat, totalRepeatRate }: RecurrenceCardProps) {
  const total = totalFirstTime + totalRepeat;
  if (total === 0) return null;

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        Recorrência de Clientes
      </h3>
      <p className="text-xs text-gray-400 mb-5">Clientes que compraram mais de 1 vez</p>

      {/* Consolidado */}
      <div className="flex items-center gap-5 mb-6 pb-6 border-b border-gray-100 dark:border-gray-700">
        <MiniDonut firstTime={totalFirstTime} repeat={totalRepeat} />
        <div>
          <p className="text-3xl sm:text-4xl font-bold text-emerald-600">{totalRepeatRate}%</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">taxa de recompra geral</p>
          <div className="flex gap-3 mt-2 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span className="text-gray-600 dark:text-gray-300">{totalRepeat.toLocaleString('pt-BR')} recorrentes</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
              <span className="text-gray-600 dark:text-gray-300">{totalFirstTime.toLocaleString('pt-BR')} primeira compra</span>
            </span>
          </div>
        </div>
      </div>

      {/* Por fonte */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sources.map((src) => {
          const srcTotal = src.firstTime + src.repeat;
          if (srcTotal === 0) return null;
          return (
            <div key={src.label} className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full inline-block" style={{ background: src.color }} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{src.label}</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{src.repeatRate}%</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">recompra</p>
                </div>
                <div className="text-right text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                  <p><span className="font-semibold text-gray-900 dark:text-gray-100">{src.repeat.toLocaleString('pt-BR')}</span> recorrentes</p>
                  <p><span className="font-semibold text-gray-900 dark:text-gray-100">{src.firstTime.toLocaleString('pt-BR')}</span> primeira compra</p>
                  <p className="text-gray-400">{srcTotal.toLocaleString('pt-BR')} total</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
