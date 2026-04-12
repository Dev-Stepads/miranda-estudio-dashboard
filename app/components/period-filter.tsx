'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Suspense } from 'react';

const periods = [
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
  const current = searchParams.get('days') ?? '30';

  function setDays(days: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('days', days);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
      {periods.map((p) => (
        <button
          key={p.value}
          onClick={() => setDays(p.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
            current === p.value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodFilter() {
  return (
    <Suspense fallback={<div className="h-9 w-64 bg-gray-100 rounded-lg animate-pulse" />}>
      <PeriodButtons />
    </Suspense>
  );
}
