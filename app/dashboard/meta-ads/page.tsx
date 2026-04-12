export default function MetaAdsPage() {
  return (
    <div className="space-y-4 sm:space-y-8">
      {/* Hero banner */}
      <div className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 p-6 sm:p-8 text-white shadow-lg">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center text-2xl shrink-0">
            📊
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">Meta Ads</h2>
            <p className="text-sm sm:text-base opacity-90 mt-1">
              Integração pendente — aguardando informações da Miranda
            </p>
            <p className="text-xs opacity-70 mt-3">
              Quando ativada, esta aba mostrará métricas de tráfego pago em tempo real.
            </p>
          </div>
        </div>
      </div>

      {/* What this tab will show */}
      <div className="rounded-xl bg-white p-4 sm:p-6 shadow-sm border border-gray-100">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
          O que vai aparecer aqui
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: '💰', label: 'Investimento', desc: 'Total gasto em ads' },
            { icon: '📈', label: 'ROAS', desc: 'Retorno sobre investimento' },
            { icon: '👥', label: 'Alcance', desc: 'Pessoas impactadas' },
            { icon: '🖱️', label: 'CPC / CTR', desc: 'Custo e taxa de clique' },
            { icon: '🛒', label: 'Compras', desc: 'Conversões atribuídas' },
            { icon: '🎯', label: 'Campanhas', desc: 'Ranking de performance' },
            { icon: '🎨', label: 'Criativos', desc: 'Ranking de anúncios' },
            { icon: '📊', label: 'Tendência', desc: 'Evolução diária' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-gray-50 p-3 text-center">
              <span className="text-2xl">{item.icon}</span>
              <p className="text-sm font-medium text-gray-700 mt-1">{item.label}</p>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Checklist */}
      <div className="rounded-xl bg-white p-4 sm:p-6 shadow-sm border border-gray-100">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
          Pendências para ativação
        </h3>
        <div className="space-y-3">
          {[
            { status: 'pending', text: 'Business Manager ID da Miranda', detail: 'Número de 15-16 dígitos em business.facebook.com → Configurações' },
            { status: 'pending', text: 'Ad Account ID (act_XXXXXXXXX)', detail: 'Conta de anúncios ativa no Business Manager' },
            { status: 'pending', text: 'Acesso ao Business Manager', detail: 'Para criar System User com token permanente' },
            { status: 'waiting', text: 'Conta dev@stepads.com.br no Facebook', detail: 'Em período de validação no developers.facebook.com' },
            { status: 'info', text: 'Janela de atribuição', detail: 'Confirmar: 7d clique + 1d visualização (padrão)' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className={`mt-0.5 text-sm ${
                item.status === 'pending' ? 'text-red-500' :
                item.status === 'waiting' ? 'text-yellow-500' : 'text-blue-500'
              }`}>
                {item.status === 'pending' ? '●' : item.status === 'waiting' ? '◐' : 'ℹ'}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-800">{item.text}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
