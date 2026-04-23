export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Carregando dados...
        </p>
      </div>
    </div>
  );
}
