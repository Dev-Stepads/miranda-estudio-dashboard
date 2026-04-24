'use client';

import { useState, useEffect } from 'react';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 min

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'agora';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}min ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function SyncStatus({ lastSyncISO }: { lastSyncISO: string }) {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const ticker = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(ticker);
  }, []);

  // Last sync in SP timezone
  const lastSync = new Date(lastSyncISO);
  const lastSyncStr = lastSync.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  // How long ago
  const agoMs = now.getTime() - lastSync.getTime();
  const agoMin = Math.floor(agoMs / 60000);
  const agoStr = agoMin < 1 ? 'agora' : `${agoMin}min atrás`;

  // Next cron: runs at :00 and :30 of each hour
  const nowMinutes = now.getMinutes();
  const lastCronMinute = nowMinutes >= 30 ? 30 : 0;
  const lastCron = new Date(now);
  lastCron.setMinutes(lastCronMinute, 0, 0);
  const nextCron = new Date(lastCron.getTime() + SYNC_INTERVAL_MS);
  const msUntilNext = nextCron.getTime() - now.getTime();

  return (
    <p className="text-[10px] sm:text-xs text-gray-400 dark:text-gray-500 mt-1">
      Sync: {lastSyncStr} ({agoStr})
      {' · '}
      Prox: {formatCountdown(msUntilNext)}
    </p>
  );
}
