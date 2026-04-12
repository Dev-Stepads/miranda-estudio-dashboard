import { NavTabs } from '../components/nav-tabs';
import { PeriodFilter } from '../components/period-filter';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-7xl mx-auto">
          {/* Top row: logo + date */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm sm:text-lg shrink-0">
                M
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900">Miranda Studio</h1>
                <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">Dashboard de Vendas</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 hidden md:block">
              {new Date().toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>
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

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 py-6 text-center text-sm text-gray-400">
        Miranda Studio Dashboard — Stepads &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
