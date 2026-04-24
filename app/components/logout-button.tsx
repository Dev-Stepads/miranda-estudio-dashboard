'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Network failure — redirect to login anyway; cookie may persist
      // but middleware will reject the expired/invalid session on next visit
    }
    router.push('/login');
  }

  return (
    <button
      onClick={handleLogout}
      className="text-xs text-gray-400 hover:text-red-500 transition cursor-pointer"
      title="Sair"
    >
      Sair
    </button>
  );
}
