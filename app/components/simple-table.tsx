'use client';

import { useState } from 'react';
import { formatBRL, formatNumber } from './kpi-cards';
import { useSortableTable, type SortConfig } from './use-sortable-table';

export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: 'currency' | 'number' | 'text';
  /** Enable click-to-sort on this column. */
  sortable?: boolean;
  /** Alternate key for sort comparison (e.g., raw date ISO string). */
  sortValue?: string;
}

interface SimpleTableProps {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: object[];
  /** Default sort column and direction. If omitted, rows keep original order. */
  defaultSort?: SortConfig;
  /** When set, show this many rows initially with a "Ver todos" toggle. */
  pageSize?: number;
}

export function SimpleTable({ title, subtitle, columns, rows, defaultSort, pageSize }: SimpleTableProps) {
  const [expanded, setExpanded] = useState(false);

  // Prepare rows with sortValue aliases so the hook sorts by the right key
  const preparedRows = rows.map((row) => {
    const r = row as Record<string, unknown>;
    const copy = { ...r };
    for (const col of columns) {
      if (col.sortable && col.sortValue && col.sortValue !== col.key) {
        // Create a shadow key: when sorting by col.key, actually use col.sortValue's value
        // We rename the sortValue data into the col.key for sort purposes
        // But we need the original col.key for display — so we use a __sort_ prefix
        copy[`__sort_${col.key}`] = r[col.sortValue];
      }
    }
    return copy;
  });

  // Build the sort default config — use __sort_ prefix if sortValue is set
  const effectiveDefault = defaultSort ?? { key: '_none_', direction: 'desc' as const };
  const { sortedRows, requestSort: rawRequestSort, getSortIndicator: rawGetSortIndicator } =
    useSortableTable(preparedRows, effectiveDefault);

  // Wrap requestSort to handle sortValue redirection
  function requestSort(key: string) {
    const col = columns.find((c) => c.key === key);
    if (col?.sortValue) {
      rawRequestSort(`__sort_${key}`);
    } else {
      rawRequestSort(key);
    }
  }

  function getSortIndicator(key: string): string {
    const col = columns.find((c) => c.key === key);
    if (col?.sortValue) {
      return rawGetSortIndicator(`__sort_${key}`);
    }
    return rawGetSortIndicator(key);
  }

  // Pagination
  const hasPagination = pageSize !== undefined && sortedRows.length > pageSize;
  const visibleRows = hasPagination && !expanded ? sortedRows.slice(0, pageSize) : sortedRows;

  function formatCell(value: unknown, format?: string): string {
    if (value === null || value === undefined) return '—';
    if (format === 'currency') return formatBRL(Number(value));
    if (format === 'number') return formatNumber(Number(value));
    return String(value);
  }

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-6 pb-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {subtitle && <p className="text-xs sm:text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {columns.map((col) => {
                const indicator = col.sortable && defaultSort ? getSortIndicator(col.key) : '';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`px-3 sm:px-6 py-2 sm:py-3 font-medium text-gray-500 dark:text-gray-400 ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${col.sortable && defaultSort ? 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200' : ''}`}
                    onClick={col.sortable && defaultSort ? () => requestSort(col.key) : undefined}
                  >
                    {col.label}
                    {indicator && <span className="ml-1 text-[10px] opacity-60">{indicator}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={i} className="border-t border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 sm:px-6 py-2 sm:py-3 ${
                      col.align === 'right' ? 'text-right font-mono' : ''
                    } ${col.format === 'currency' ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}
                  >
                    {formatCell((row as Record<string, unknown>)[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 sm:px-6 py-8 text-center text-gray-400">
                  Sem dados disponíveis
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasPagination && (
        <div className="px-4 sm:px-6 py-3 border-t border-gray-100 dark:border-gray-700 text-center">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium cursor-pointer"
          >
            {expanded ? 'Ver menos' : `Ver todos (${sortedRows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
