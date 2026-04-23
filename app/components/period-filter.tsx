'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Suspense, useState } from 'react';

const presets = [
  { label: '7d', value: '7' },
  { label: '15d', value: '15' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: '1 ano', value: '365' },
];

function PeriodButtons() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const currentDays = searchParams.get('days') ?? '30';
  const currentFrom = searchParams.get('from');
  const currentTo = searchParams.get('to');
  const isCustom = currentFrom !== null && currentTo !== null;

  const [fromDate, setFromDate] = useState(currentFrom ?? '');
  const [toDate, setToDate] = useState(currentTo ?? formatDate(new Date()));

  function setDays(days: string) {
    const params = new URLSearchParams();
    params.set('days', days);
    router.push(`${pathname}?${params.toString()}`);
  }

  const isValidRange = fromDate !== '' && toDate !== '' && fromDate <= toDate;

  function applyCustomRange() {
    if (!isValidRange) return;
    const params = new URLSearchParams();
    params.set('from', fromDate);
    params.set('to', toDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearCustom() {
    const params = new URLSearchParams();
    params.set('days', '30');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => setDays(p.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              !isCustom && currentDays === p.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}

        {/* Custom active label */}
        {isCustom && (
          <span className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-gray-900 shadow-sm">
            {currentFrom} → {currentTo}
            <button
              onClick={clearCustom}
              className="ml-1 text-gray-400 hover:text-red-500 cursor-pointer text-sm leading-none"
              title="Limpar filtro"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {/* Date picker — always visible */}
      <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 shadow-sm">
        <span className="text-gray-500 dark:text-gray-400 text-sm" title="Selecione um intervalo personalizado">
          &#128197;
        </span>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          aria-label="Data de início"
          className="text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1"
        />
        <span className="text-xs text-gray-400">→</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          aria-label="Data de fim"
          className="text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1"
        />
        <button
          onClick={applyCustomRange}
          disabled={!isValidRange}
          className="px-3 py-1 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

export function PeriodFilter() {
  return (
    <Suspense fallback={<div className="h-9 w-64 bg-gray-100 rounded-lg animate-pulse" />}>
      <PeriodButtons />
    </Suspense>
  );
}
