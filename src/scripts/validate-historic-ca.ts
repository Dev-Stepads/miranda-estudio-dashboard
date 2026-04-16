/**
 * Soma CA sales por mes desde 2023-01 ate 2025-10 apos sync historico.
 * Usa a view v_visao_geral_daily (TZ-safe).
 */
import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main(): Promise<void> {
  const sb = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const expectedByChunk: Record<string, number> = {
    '2023-H1': 422061.03,
    '2023-H2': 634971.71,
    '2024-H1': 630191.22,
    '2024-H2': 693896.63,
    '2025-H1': 734309.39,
    '2025-Jul-Out': 562818.51,
  };

  const chunks = [
    { label: '2023-H1', from: '2023-01-01', to: '2023-06-30' },
    { label: '2023-H2', from: '2023-07-01', to: '2023-12-31' },
    { label: '2024-H1', from: '2024-01-01', to: '2024-06-30' },
    { label: '2024-H2', from: '2024-07-01', to: '2024-12-31' },
    { label: '2025-H1', from: '2025-01-01', to: '2025-06-30' },
    { label: '2025-Jul-Out', from: '2025-07-01', to: '2025-10-31' },
  ];

  console.log('========================================');
  console.log('VALIDAÇÃO HISTÓRICO CA — Chunks vs DB');
  console.log('========================================\n');
  console.log('Chunk        | API (Chunk) | DB v_visao_geral_daily | Diff');
  console.log('-------------|-------------|-----------------------|----------');

  let totalApi = 0;
  let totalDb = 0;
  for (const c of chunks) {
    const { data } = await sb
      .from('v_visao_geral_daily')
      .select('gross_revenue')
      .eq('source', 'conta_azul')
      .gte('day', c.from)
      .lte('day', c.to);
    const sum = (data ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const expected = expectedByChunk[c.label]!;
    const diff = sum - expected;
    totalApi += expected;
    totalDb += sum;
    console.log(
      `${c.label.padEnd(12)} | R$ ${fmt(expected).padStart(10)} | R$ ${fmt(sum).padStart(18)} | ${diff === 0 ? '✅ 0,00' : `❌ R$ ${fmt(diff)}`}`,
    );
  }

  console.log('-------------|-------------|-----------------------|----------');
  console.log(
    `TOTAL        | R$ ${fmt(totalApi).padStart(10)} | R$ ${fmt(totalDb).padStart(18)} | ${Math.abs(totalApi - totalDb) < 0.01 ? '✅' : `❌ R$ ${fmt(totalDb - totalApi)}`}`,
  );

  // Por ano
  console.log('\n--- Resumo por ano (DB) ---');
  for (const year of ['2023', '2024', '2025', '2026']) {
    const { data } = await sb
      .from('v_visao_geral_daily')
      .select('gross_revenue')
      .eq('source', 'conta_azul')
      .gte('day', `${year}-01-01`)
      .lte('day', `${year}-12-31`);
    const sum = (data ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const count = data?.length ?? 0;
    console.log(`${year}: ${count} dias | R$ ${fmt(sum)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
