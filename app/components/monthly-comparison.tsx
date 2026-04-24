'use client';

import { useState } from 'react';
import type { MonthlyData } from '../lib/queries';
import { useSortableTable } from './use-sortable-table';

interface MonthlyComparisonProps {
  data: MonthlyData[];
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function formatMonth(month: string): string {
  const parts = month.split('-');
  const m = parts[1] ?? '01';
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const idx = Number(m) - 1;
  return months[idx] ?? m;
}

const SORTABLE_TH =
  'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200';

export function MonthlyComparison({ data }: MonthlyComparisonProps) {
  // Extract available years from data
  const years = [...new Set(data.map(d => d.month.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const [selectedYear, setSelectedYear] = useState(years[0] ?? new Date().getFullYear().toString());

  // Filter by selected year
  const filtered = data.filter(d => d.month.startsWith(selectedYear));

  // Sort the filtered data (only after year filter)
  const { sortedRows, requestSort, getSortIndicator } = useSortableTable(
    filtered,
    { key: 'month', direction: 'desc' },
  );

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="p-4 sm:p-6 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Comparativo Mensal</h3>
              <p className="text-xs sm:text-sm text-gray-400 mt-0.5">Faturamento total (Loja Física + E-commerce)</p>
            </div>
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
              {years.map((year) => (
                <button key={year} onClick={() => setSelectedYear(year)} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${selectedYear === year ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>{year}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-8 text-center text-gray-400">
          Sem dados para {selectedYear}
        </div>
      </div>
    );
  }
  const maxRevenue = Math.max(...filtered.map(d => d.revenue), 1);

  // Totals for the year (unaffected by sort)
  const totalRevenue = filtered.reduce((s, r) => s + r.revenue, 0);
  const totalOrders = filtered.reduce((s, r) => s + r.orders, 0);
  const totalAvgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Determine the most recent month for highlight (based on data, not position)
  const mostRecentMonth = [...filtered].sort((a, b) => b.month.localeCompare(a.month))[0]?.month;

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
              Comparativo Mensal
            </h3>
            <p className="text-xs sm:text-sm text-gray-400 mt-0.5">Faturamento total (Loja Física + E-commerce)</p>
          </div>
          {/* Year filter */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
            {years.map((year) => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  selectedYear === year
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th
                scope="col"
                className={`px-4 sm:px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('month')}
              >
                Mês
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('month')}</span>
              </th>
              <th
                scope="col"
                className={`px-4 sm:px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('revenue')}
              >
                Faturamento
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('revenue')}</span>
              </th>
              <th
                scope="col"
                className={`px-4 sm:px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('orders')}
              >
                Pedidos
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('orders')}</span>
              </th>
              <th
                scope="col"
                className={`px-4 sm:px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400 ${SORTABLE_TH}`}
                onClick={() => requestSort('avgTicket')}
              >
                Ticket
                <span className="ml-1 text-[10px] opacity-60">{getSortIndicator('avgTicket')}</span>
              </th>
              <th scope="col" className="px-4 sm:px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">vs anterior</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.month}
                className={`border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  row.month === mostRecentMonth ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''
                }`}
              >
                <td className="px-4 sm:px-6 py-2.5 font-medium text-gray-800 dark:text-gray-200 text-xs sm:text-sm">
                  {formatMonth(row.month)}
                  {row.partial && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      parcial
                    </span>
                  )}
                </td>
                <td className="px-4 sm:px-6 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-xs sm:text-sm whitespace-nowrap">
                      {formatBRL(row.revenue)}
                    </span>
                    <div className="hidden sm:block flex-1 max-w-24">
                      <div
                        className="h-2 rounded-full bg-indigo-400/60"
                        style={{ width: `${(row.revenue / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 sm:px-6 py-2.5 text-right text-gray-700 dark:text-gray-300 font-mono text-xs sm:text-sm">
                  {row.orders.toLocaleString('pt-BR')}
                </td>
                <td className="px-4 sm:px-6 py-2.5 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">
                  {formatBRL(row.avgTicket)}
                </td>
                <td className="px-4 sm:px-6 py-2.5 text-right text-xs">
                  {row.changePercent !== null ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ${
                      row.changePercent >= 0
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {row.changePercent >= 0 ? '↑' : '↓'} {Math.abs(row.changePercent).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {/* Year total footer — unaffected by sort */}
          <tfoot>
            <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
              <td className="px-4 sm:px-6 py-3 font-bold text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                Total {selectedYear}
              </td>
              <td className="px-4 sm:px-6 py-3 font-bold text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                {formatBRL(totalRevenue)}
              </td>
              <td className="px-4 sm:px-6 py-3 text-right font-bold text-gray-900 dark:text-gray-100 font-mono text-xs sm:text-sm">
                {totalOrders.toLocaleString('pt-BR')}
              </td>
              <td className="px-4 sm:px-6 py-3 text-right font-bold text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                {formatBRL(totalAvgTicket)}
              </td>
              <td className="px-4 sm:px-6 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
      {filtered.some(d => d.partial) && (
        <p className="px-4 sm:px-6 py-2 text-[11px] text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700">
          <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400 mr-1">parcial</span>
          mês em andamento — a % compara o mesmo número de dias do mês anterior (dia a dia) pra não mostrar queda artificial
        </p>
      )}
    </div>
  );
}
