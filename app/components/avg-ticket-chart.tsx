'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface AvgTicketChartProps {
  data: Array<{
    day: string;
    avg_ticket: number;
    avg_ticket_nuvemshop?: number;
    avg_ticket_conta_azul?: number;
  }>;
}

function formatDay(day: string) {
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function AvgTicketChart({ data }: AvgTicketChartProps) {
  const hasSplit = data.some(d => d.avg_ticket_nuvemshop !== undefined || d.avg_ticket_conta_azul !== undefined);

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 sm:mb-4">
        Ticket Médio por Dia
      </h3>
      <div className="h-56 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
            />
            <YAxis
              tickFormatter={(v) => `R$${Number(v).toFixed(0)}`}
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
              width={60}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(Number(value)),
                String(name) === 'avg_ticket_nuvemshop' ? 'E-commerce'
                  : String(name) === 'avg_ticket_conta_azul' ? 'Loja Física'
                  : 'Ticket Médio',
              ]}
              labelFormatter={(label) => {
                const d = new Date(String(label) + 'T12:00:00');
                return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
              }}
            />
            {hasSplit && (
              <Legend
                formatter={(value: string) =>
                  value === 'avg_ticket_nuvemshop' ? 'E-commerce (Nuvemshop)'
                    : value === 'avg_ticket_conta_azul' ? 'Loja Física (Conta Azul)'
                    : 'Ticket Médio'
                }
              />
            )}
            {hasSplit ? (
              <>
                <Line
                  type="monotone"
                  dataKey="avg_ticket_nuvemshop"
                  stroke="#6366F1"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#6366F1' }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="avg_ticket_conta_azul"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#f59e0b' }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              </>
            ) : (
              <Line
                type="monotone"
                dataKey="avg_ticket"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3, fill: '#10b981' }}
                activeDot={{ r: 5 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
