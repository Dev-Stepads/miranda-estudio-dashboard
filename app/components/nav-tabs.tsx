'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const tabs = [
  { href: '/dashboard', label: 'Visão Geral' },
  { href: '/dashboard/nuvemshop', label: 'Nuvemshop' },
  { href: '/dashboard/loja-fisica', label: 'Loja Física' },
  { href: '/dashboard/meta-ads', label: 'Meta Ads' },
];

function TabLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  return (
    <nav className="flex gap-1 bg-gray-100 p-1 rounded-lg">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        // Preserve current filters (days, from, to) when switching tabs
        const href = queryString ? `${tab.href}?${queryString}` : tab.href;
        return (
          <Link
            key={tab.href}
            href={href}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
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
