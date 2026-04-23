import { NavTabs } from '../components/nav-tabs';
import { PeriodFilter } from '../components/period-filter';
import { ThemeToggle } from '../components/theme-toggle';
import { AutoRefresh } from '../components/auto-refresh';
import { LogoutButton } from '../components/logout-button';
import { SyncStatus } from '../components/sync-status';
import { getSupabase } from '../lib/supabase-server';

export const dynamic = 'force-dynamic';

async function getLastSyncTime(): Promise<string> {
  try {
    const supabase = getSupabase();
    // raw_meta_insights_campaign receives rows EVERY cron run (append-only),
    // so its most recent ingested_at reflects the actual last sync time.
    const { data } = await supabase
      .from('raw_meta_insights_campaign')
      .select('ingested_at')
      .order('ingested_at', { ascending: false })
      .limit(1);
    return (data?.[0]?.ingested_at as string) ?? new Date().toISOString();
  } catch {
    // If the query fails (e.g. table doesn't exist yet), degrade gracefully
    // instead of crashing the entire dashboard layout.
    return new Date().toISOString();
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lastSyncISO = await getLastSyncTime();
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-7xl mx-auto">
          {/* Top row: logo + date */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <img
                src="/logo-miranda.jpg"
                alt="Miranda Studio"
                className="h-8 sm:h-10 w-auto shrink-0"
              />
              <div>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Dashboard de Vendas</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <LogoutButton />
            </div>
            <div className="hidden md:block text-right">
              <p className="text-xs text-gray-400">
                {new Date().toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <SyncStatus lastSyncISO={lastSyncISO} />
            </div>
          </div>
          {/* Period filter */}
          <div className="mb-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <PeriodFilter />
          </div>
          {/* Tabs */}
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <NavTabs />
          </div>
        </div>
      </header>

      <AutoRefresh />

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 mt-12 py-6 text-center text-sm text-gray-400">
        Miranda Studio Dashboard — Stepads &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
