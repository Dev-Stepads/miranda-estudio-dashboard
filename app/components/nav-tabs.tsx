'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/dashboard', label: 'Visão Geral' },
  { href: '/dashboard/nuvemshop', label: 'Nuvemshop' },
  { href: '/dashboard/loja-fisica', label: 'Loja Física' },
  { href: '/dashboard/meta-ads', label: 'Meta Ads' },
];

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 bg-gray-100 p-1 rounded-lg">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
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
