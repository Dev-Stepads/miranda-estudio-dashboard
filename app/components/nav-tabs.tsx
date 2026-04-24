'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const tabs = [
  { href: '/dashboard', label: 'Visão Geral' },
  { href: '/dashboard/nuvemshop', label: 'Nuvemshop' },
  { href: '/dashboard/loja-fisica', label: 'Loja Física' },
  { href: '/dashboard/meta-ads', label: 'Meta Ads' },
  { href: '/dashboard/comportamento', label: 'Comportamento' },
];

function TabLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  return (
    <nav className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-max min-w-full sm:w-auto">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        const href = queryString ? `${tab.href}?${queryString}` : tab.href;
        return (
          <Link
            key={tab.href}
            href={href}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavTabs() {
  return (
    <Suspense fallback={<div className="h-10 w-96 bg-gray-100 rounded-lg animate-pulse" />}>
      <TabLinks />
    </Suspense>
  );
}
