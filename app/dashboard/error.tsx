'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-lg w-full text-center">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 mb-2">
          Erro ao carregar dados
        </h2>
        <p className="text-sm text-red-600 dark:text-red-400 mb-4">
          {error.message || 'Ocorreu um erro inesperado ao carregar o dashboard.'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
