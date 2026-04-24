'use client';

import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

/**
 * Shared hook for client-side table sorting.
 *
 * Usage:
 * ```ts
 * const { sortedRows, sortConfig, requestSort, getSortIndicator } =
 *   useSortableTable(rows, { key: 'revenue', direction: 'desc' });
 * ```
 *
 * - Clicking the active column toggles asc/desc.
 * - Clicking a different column switches to that column with desc.
 * - Comparison: numbers compared numerically, strings via localeCompare('pt-BR').
 */
export function useSortableTable<T>(
  rows: T[],
  defaultSort: SortConfig,
): {
  sortedRows: T[];
  sortConfig: SortConfig;
  requestSort: (key: string) => void;
  getSortIndicator: (key: string) => string;
} {
  const [sortConfig, setSortConfig] = useState<SortConfig>(defaultSort);

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortConfig.key];
      const bVal = (b as Record<string, unknown>)[sortConfig.key];

      // Nulls always go last regardless of direction
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp: number;
      const aNum = typeof aVal === 'number' ? aVal : Number(aVal);
      const bNum = typeof bVal === 'number' ? bVal : Number(bVal);

      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        cmp = aNum - bNum;
      } else {
        cmp = String(aVal).localeCompare(String(bVal), 'pt-BR');
      }

      return sortConfig.direction === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortConfig]);

  function requestSort(key: string) {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'desc' ? 'asc' : 'desc' };
      }
      return { key, direction: 'desc' };
    });
  }

  function getSortIndicator(key: string): string {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  }

  return { sortedRows, sortConfig, requestSort, getSortIndicator };
}
