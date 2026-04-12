export default function MetaAdsPage() {
  return (
    <div className="space-y-8">
      {/* Placeholder banner */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-6">
        <h2 className="text-lg font-semibold text-blue-900 mb-2">
          Meta Ads — Integração Pendente
        </h2>
        <p className="text-sm text-blue-700 mb-4">
          A integração com o Meta Ads depende de informações que a Miranda
          ainda não forneceu. Esta aba será ativada assim que tivermos acesso.
        </p>

        <div className="bg-white rounded-lg p-4 border border-blue-100">
          <h3 className="font-medium text-gray-900 mb-3">Informações pendentes:</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">●</span>
              <span><strong>Business Manager ID</strong> — número de 15-16 dígitos do BM da Miranda</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">●</span>
              <span><strong>Ad Account ID</strong> — formato act_XXXXXXXXX da conta de anúncios ativa</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">●</span>
              <span><strong>Acesso ao Business Manager</strong> — pra criar System User com token permanente</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-yellow-500 mt-0.5">●</span>
              <span><strong>Janela de atribuição</strong> — confirmar se usam 7d clique + 1d visualização (padrão)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-yellow-500 mt-0.5">●</span>
              <span><strong>Tipo de criativos</strong> — usam vídeo (Reels/Stories) ou só estáticos?</span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-blue-500 mt-4">
          Além disso, a conta dev@stepads.com.br no developers.facebook.com
          está em período de validação. Quando ambos os bloqueios forem
          resolvidos, esta aba mostrará: investimento, alcance, impressões,
          cliques, CTR, CPC, CPM, compras atribuídas, ROAS e ranking de
          campanhas/criativos.
        </p>
      </div>

      {/* Preview of what the tab will show */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 opacity-40">
        {['Investimento', 'ROAS', 'Alcance', 'CPC'].map((label) => (
          <div key={label} className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
            <p className="text-sm font-medium text-gray-500">{label}</p>
            <p className="mt-2 text-3xl font-bold text-gray-300">—</p>
            <p className="mt-1 text-sm text-gray-300">Aguardando integração</p>
          </div>
        ))}
      </div>
    </div>
  );
}
