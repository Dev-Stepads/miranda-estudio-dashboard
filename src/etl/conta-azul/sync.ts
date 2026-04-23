/**
 * Conta Azul → Supabase ETL sync — /venda/busca direto.
 *
 * Architecture (v3, 2026-04-15):
 * ----------------------------------------------------------------
 * Pre-v3 ("receb-*" fallback era) used Contas a Receber as the primary
 * source and tried to resolve each receivable to a venda via a second
 * lookup. That produced numbers ~3.5% off Miranda's closing because
 * totals were sum(pago) (cash basis) vs Miranda's sum(total aprovado)
 * from the CA "Vendas" screen (accrual basis on sale date).
 *
 * v3 flow matches the CA "Vendas" screen that Miranda actually uses to
 * close the month:
 *   1. Fetch /v1/venda/busca?data_inicio&data_fim — this returns
 *      `totais.aprovado` which equals Miranda's "Faturamento Total"
 *      at the cent. Example validated March 2026: R$ 116.544,00.
 *   2. Dedup by `id` — the API returns the same venda multiple times
 *      inside a single response (observed: 4 dups in March's 329 vendas).
 *   3. Filter situacao ∈ {APROVADO, FATURADO} — excludes ORCAMENTO
 *      (31.9K in March that's not real revenue yet).
 *   4. Tag vendas with origem = "Nuvem Shop" by adding a `nstag-` prefix
 *      to source_sale_id. We keep them in `sales` because sum(CA) must
 *      equal `totais.aprovado` to derive Loja Física = CA − NS at the
 *      dashboard layer (Miranda's subtraction formula). Rankings and
 *      detail queries filter `nstag-%` out.
 *   5. For each venda (loja + nstag), fetch /venda/{id} (payment method,
 *      cliente doc) + /venda/{id}/itens and upsert into canonical tables.
 *
 * Why no cross-source dedup against Nuvemshop customers: an earlier
 * version tried matching CA vendas to NS orders by (email, date, total).
 * Debugging showed 0 matches in March 2026 — CA loja customers and NS
 * customers are different email universes. The ~R$ 1.346 gap between
 * NS ETL total and CA NS-tagged total is driven by freight handling
 * differences (NS includes frete in gross, CA records product subtotal),
 * not duplicate sales. The dashboard subtraction pattern handles it.
 *
 * sale_date = `${venda.data}T03:00:00Z` (SP midnight). Writing the bare
 * YYYY-MM-DD string makes Supabase store it as UTC midnight, which the
 * dashboard view then shifts 3h back into the previous day. See DECISOES
 * 2026-04-15.
 *
 * Token auto-refresh: CA access_tokens expire every hour. `fetchAuth()`
 * catches 401, calls `tokenManager.refresh()`, and retries once. Essential
 * for historical syncs longer than 1h.
 *
 * Rate limit: CA spike arrest is 10 req/s. We throttle to ~4 req/s.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ContaAzulTokenManager } from '../../integrations/conta-azul/auth.ts';
import {
  RawContaAzulVendaDetalheSchema,
  VendaItensResponseSchema,
  VendaBuscaResponseSchema,
} from '../../integrations/conta-azul/schemas.ts';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface ContaAzulSyncConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  onRefreshTokenRotated: (newToken: string) => void | Promise<void>;
}

export interface ContaAzulSyncResult {
  vendasFetched: number;
  vendasAfterIdDedup: number;
  vendasAfterSituacaoFilter: number;
  vendasAfterOrigemFilter: number;
  vendasSkippedNsCrossRef: number;
  vendasProcessed: number;
  customersUpserted: number;
  salesUpserted: number;
  saleItemsInserted: number;
  errors: number;
  durationMs: number;
  apiAprovadoTotal: number;
}

interface VendaListItem {
  id: string;
  numero: number;
  data: string;
  total: number;
  origem?: string | null;
  cliente?: { id: string; nome: string; email?: string | null } | null;
  situacao?: { nome: string };
}

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const BASE = 'https://api-v2.contaazul.com/v1';
const THROTTLE_MS = 250;
const PAGE_SIZE = 500;

const PAYMENT_NAMES: Record<string, string> = {
  PIX_PAGAMENTO_INSTANTANEO: 'pix',
  LINK_PAGAMENTO: 'link_pagamento',
  CARTAO_CREDITO: 'credito',
  CARTAO_DEBITO: 'debito',
  CARTEIRA_DIGITAL: 'carteira_digital',
  DINHEIRO: 'dinheiro',
  BOLETO: 'boleto',
  TRANSFERENCIA: 'transferencia',
  SEM_PAGAMENTO: 'sem_pagamento',
};

function mapPaymentForDb(tipo: string | undefined | null): string {
  if (!tipo) return 'outros';
  return PAYMENT_NAMES[tipo] ?? 'outros';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const USER_AGENT = 'Miranda Dashboard ETL (dev@stepads.com.br)';

/**
 * Fetch wrapper that auto-refreshes the access_token on 401.
 *
 * CA access_tokens expire every hour. A full historical sync takes
 * longer than that, so we must retry once with a fresh token when
 * the API rejects us. `tokenManager.refresh()` rotates the
 * refresh_token and persists via the onRefresh callback.
 */
async function fetchAuth(
  url: string,
  tokenManager: ContaAzulTokenManager,
): Promise<Response> {
  const token = await tokenManager.getAccessToken();
  const makeHeaders = (t: string) => ({
    Authorization: `Bearer ${t}`,
    'User-Agent': USER_AGENT,
  });

  const resp = await fetch(url, { headers: makeHeaders(token) });
  if (resp.status !== 401) return resp;

  // Force refresh and retry once.
  await tokenManager.refresh();
  const freshToken = await tokenManager.getAccessToken();
  return fetch(url, { headers: makeHeaders(freshToken) });
}

// ------------------------------------------------------------
// Main sync
// ------------------------------------------------------------

export async function syncContaAzul(
  supabase: SupabaseClient,
  config: ContaAzulSyncConfig,
  dataInicial: string,
  dataFinal: string,
  log: (msg: string) => void,
): Promise<ContaAzulSyncResult> {
  const start = Date.now();
  const result: ContaAzulSyncResult = {
    vendasFetched: 0,
    vendasAfterIdDedup: 0,
    vendasAfterSituacaoFilter: 0,
    vendasAfterOrigemFilter: 0,
    vendasSkippedNsCrossRef: 0,
    vendasProcessed: 0,
    customersUpserted: 0,
    salesUpserted: 0,
    saleItemsInserted: 0,
    errors: 0,
    durationMs: 0,
    apiAprovadoTotal: 0,
  };

  log('🔄 Refreshing Conta Azul access_token...');
  const tokenManager = new ContaAzulTokenManager({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
    onRefresh: async (tokens) => {
      await config.onRefreshTokenRotated(tokens.newRefreshToken);
      log('  ✅ Token refreshed + persisted');
    },
  });

  // Force an initial refresh so we know the token is fresh.
  await tokenManager.getAccessToken();

  // ============================================================
  // PHASE 1: Fetch ALL vendas in window (paginated, dedup by id)
  // ============================================================
  log(`\n🔄 Fetching /venda/busca ${dataInicial} → ${dataFinal}...`);

  const rawFetched: VendaListItem[] = [];
  const seenIds = new Set<string>();
  const uniqueVendas: VendaListItem[] = [];
  let page = 1;

  while (true) {
    await sleep(THROTTLE_MS);
    const url = `${BASE}/venda/busca?data_inicio=${dataInicial}&data_fim=${dataFinal}&tamanho_pagina=${PAGE_SIZE}&pagina=${page}`;
    const resp = await fetchAuth(url, tokenManager);

    if (!resp.ok) {
      log(`  ❌ /venda/busca page ${page}: HTTP ${resp.status}`);
      result.errors++;
      break;
    }

    const json = await resp.json();
    const parsed = VendaBuscaResponseSchema.safeParse(json);
    if (!parsed.success) {
      log(`  ❌ /venda/busca page ${page}: validation — ${parsed.error.issues[0]?.message ?? '?'}`);
      result.errors++;
      break;
    }

    if (page === 1) {
      result.apiAprovadoTotal = parsed.data.totais.aprovado;
      log(
        `  📊 API totals: aprovado R$ ${parsed.data.totais.aprovado.toFixed(2)} | ` +
          `esperando R$ ${parsed.data.totais.esperando_aprovacao.toFixed(2)} | ` +
          `itens ${parsed.data.quantidades.total}`,
      );
    }

    rawFetched.push(...(parsed.data.itens as VendaListItem[]));
    for (const v of parsed.data.itens as VendaListItem[]) {
      if (!seenIds.has(v.id)) {
        seenIds.add(v.id);
        uniqueVendas.push(v);
      }
    }

    const totalItens = parsed.data.quantidades.total;
    log(`  Page ${page}: ${parsed.data.itens.length} raw (${uniqueVendas.length}/${totalItens} unique so far)`);

    if (parsed.data.itens.length === 0) break;
    if (uniqueVendas.length >= totalItens) break;
    page++;
    if (page > 50) break; // safety
  }

  result.vendasFetched = rawFetched.length;
  result.vendasAfterIdDedup = uniqueVendas.length;

  // ============================================================
  // PHASE 2: Filter situacao ∈ {APROVADO, FATURADO} + total > 0
  // ============================================================
  const approvedOrInvoiced = uniqueVendas.filter((v) => {
    const sit = v.situacao?.nome;
    if (sit !== 'APROVADO' && sit !== 'FATURADO') return false;
    // Skip vendas with total=0 — these are exchanges, bonuses, or
    // cancelled sales that CA keeps as "approved" with zero value.
    // They inflate order counts and deflate avg ticket. The API
    // confirms total=0 on the detail endpoint too (validated 2026-04-22).
    if (v.total <= 0) return false;
    return true;
  });
  result.vendasAfterSituacaoFilter = approvedOrInvoiced.length;

  // ============================================================
  // PHASE 3: Tag origem (loja vs Nuvem Shop)
  // ============================================================
  // We store BOTH loja and NS-tagged sales so that sum(CA) in Supabase
  // equals `totais.aprovado` = Miranda's "Faturamento Total". NS-tagged
  // vendas get a `nstag-` prefix in source_sale_id so the dashboard can
  // filter them out of loja-física rankings while still including them
  // in the KPI subtraction:
  //   KPI Loja Física = sum(CA) - sum(NS) = 82.944,79 (March)
  // See DECISOES 2026-04-15b for the reasoning.
  const tagged = approvedOrInvoiced.map((v) => {
    const origem = (v.origem ?? '').toLowerCase();
    const isNsTagged = origem.includes('nuvem');
    return { venda: v, isNsTagged };
  });

  const lojaCount = tagged.filter((t) => !t.isNsTagged).length;
  const nsCount = tagged.filter((t) => t.isNsTagged).length;
  result.vendasAfterOrigemFilter = lojaCount;
  log(`  Loja física (origem != nuvem): ${lojaCount}`);
  log(`  NS-tagged (origem = Nuvem Shop): ${nsCount}`);

  const lojaSum = tagged.filter((t) => !t.isNsTagged).reduce((s, t) => s + t.venda.total, 0);
  const nsSum = tagged.filter((t) => t.isNsTagged).reduce((s, t) => s + t.venda.total, 0);
  log(`  Expected loja sum: R$ ${lojaSum.toFixed(2)}`);
  log(`  Expected NS-tagged sum: R$ ${nsSum.toFixed(2)}`);
  log(`  Total CA expected (should match totais.aprovado): R$ ${(lojaSum + nsSum).toFixed(2)}`);

  // Cross-source dedup vs NS disabled — debugging showed 0 matches
  // because CA loja customers and NS customers are different universes
  // (different email sets). The R$ 1.346 NS↔CA overlap is driven by
  // freight handling differences, not by duplicate sales. The dashboard
  // subtraction pattern handles this.

  // ============================================================
  // PHASE 4: Fetch detail+items and upsert (loja + ns-tagged)
  // ============================================================
  log('\n📥 Processing vendas (detail + items + upsert)...');
  const BATCH_LOG_INTERVAL = 25;

  for (let i = 0; i < tagged.length; i++) {
    const t = tagged[i]!;
    try {
      await processVenda(t.venda, t.isNsTagged, supabase, tokenManager, log, result);
    } catch (err) {
      log(`  ❌ Venda #${t.venda.numero}: ${err instanceof Error ? err.message : String(err)}`);
      result.errors++;
    }

    if ((i + 1) % BATCH_LOG_INTERVAL === 0 || i === tagged.length - 1) {
      log(
        `  📦 ${i + 1}/${tagged.length} | ${result.salesUpserted} sales, ${result.saleItemsInserted} items, ${result.errors} errors`,
      );
    }
  }

  result.durationMs = Date.now() - start;
  log(
    `\n✅ Conta Azul sync complete: ${result.salesUpserted} sales, ${result.saleItemsInserted} items, ` +
      `${result.customersUpserted} customers, ${result.errors} errors, ${(result.durationMs / 1000).toFixed(1)}s`,
  );

  return result;
}

// ------------------------------------------------------------
// Process a single venda: fetch detail + items, upsert
// ------------------------------------------------------------

async function processVenda(
  v: VendaListItem,
  isNsTagged: boolean,
  supabase: SupabaseClient,
  tokenManager: ContaAzulTokenManager,
  log: (msg: string) => void,
  result: ContaAzulSyncResult,
): Promise<void> {
  // Detail
  await sleep(THROTTLE_MS);
  const detailResp = await fetchAuth(`${BASE}/venda/${v.id}`, tokenManager);
  if (!detailResp.ok) {
    log(`  ❌ Detail #${v.numero}: HTTP ${detailResp.status}`);
    result.errors++;
    return;
  }

  const detailJson = await detailResp.json();
  const detailParsed = RawContaAzulVendaDetalheSchema.safeParse(detailJson);
  if (!detailParsed.success) {
    log(
      `  ❌ Detail #${v.numero}: validation — ${detailParsed.error.issues[0]?.message ?? '?'} at ${detailParsed.error.issues[0]?.path?.join('.') ?? '?'}`,
    );
    result.errors++;
    return;
  }
  const detail = detailParsed.data;

  // Items
  await sleep(THROTTLE_MS);
  const itemsResp = await fetchAuth(`${BASE}/venda/${v.id}/itens`, tokenManager);
  let vendaItems: Array<{ nome: string; quantidade: number; valor: number; id_item?: string }> = [];
  if (itemsResp.ok) {
    const itemsJson = await itemsResp.json();
    const itemsParsed = VendaItensResponseSchema.safeParse(itemsJson);
    if (itemsParsed.success) {
      vendaItems = itemsParsed.data.itens;
    }
  }

  // NOTE: use the list item's `total` as the canonical revenue value — it's
  // what the CA "Vendas" screen aggregates into `totais.aprovado` and what
  // Miranda reports. The detail endpoint's `composicao_valor.valor_bruto` is
  // product-subtotal only (no freight), so it's kept as net_revenue.
  const composicao = detail.venda?.composicao_valor;
  const grossRevenue = v.total;
  const netRevenue = composicao?.valor_bruto ?? grossRevenue;
  const paymentType = detail.venda?.condicao_pagamento?.tipo_pagamento;
  const customerDoc = detail.cliente?.documento ?? null;
  const customerName = detail.cliente?.nome ?? v.cliente?.nome ?? null;
  // SP midnight — see DECISOES 2026-04-15 about TZ bug
  const saleDate = `${v.data.slice(0, 10)}T03:00:00Z`;

  // `nstag-` prefix marks NS-tagged vendas so dashboard queries can
  // filter them out of loja-física rankings while still including them
  // in the sum(CA) total.
  const sourceSaleId = isNsTagged ? `nstag-${v.id}` : v.id;

  // Raw payload
  await supabase.from('raw_contaazul_sales').upsert(
    {
      source_id: sourceSaleId,
      payload: { venda_id: v.id, numero: v.numero, list_item: v, detail: detailJson, is_ns_tagged: isNsTagged },
    },
    { onConflict: 'source_id' },
  );

  // Customer upsert
  const customerSourceId = customerDoc || detail.cliente?.uuid || v.cliente?.id;
  let customerId: number | null = null;
  if (customerSourceId && customerName) {
    const { error: custErr } = await supabase.from('customers').upsert(
      {
        source: 'conta_azul',
        source_customer_id: customerSourceId,
        name: customerName,
        gender: 'unknown',
        age_range: 'unknown',
        state: null,
        city: null,
        email: v.cliente?.email ?? null,
        phone: null,
      },
      { onConflict: 'source,source_customer_id' },
    );
    if (custErr === null) result.customersUpserted++;

    const { data: custData } = await supabase
      .from('customers')
      .select('customer_id')
      .eq('source', 'conta_azul')
      .eq('source_customer_id', customerSourceId)
      .limit(1);
    customerId = (custData?.[0]?.customer_id as number | null) ?? null;
  }

  // Sale upsert
  const { data: saleData, error: saleErr } = await supabase
    .from('sales')
    .upsert(
      {
        source: 'conta_azul',
        source_sale_id: sourceSaleId,
        sale_date: saleDate,
        gross_revenue: grossRevenue,
        net_revenue: netRevenue,
        status: 'paid',
        customer_id: customerId,
        payment_method: mapPaymentForDb(paymentType),
      },
      { onConflict: 'source,source_sale_id' },
    )
    .select('sale_id');

  if (saleErr !== null) {
    log(`  ❌ Sale upsert #${v.numero}: ${saleErr.message}`);
    result.errors++;
    return;
  }

  const saleId = saleData?.[0]?.sale_id as number | undefined;
  if (saleId === undefined) return;

  result.salesUpserted++;

  if (vendaItems.length > 0) {
    const rawItems = vendaItems
      .filter((item) => item.quantidade > 0)
      .map((item) => ({
        sale_id: saleId,
        product_name: item.nome,
        sku: item.id_item || null,
        quantity: item.quantidade,
        unit_price: item.valor,
        total_price: item.valor * item.quantidade,
      }));

    // Distribute order-level discounts proportionally across items so that
    // sum(item.total_price) = grossRevenue. Without this, product rankings
    // show pre-discount revenue (inflated). See audit 2026-04-22.
    const itemsRawSum = rawItems.reduce((s, i) => s + i.total_price, 0);
    const items = itemsRawSum > 0 && Math.abs(itemsRawSum - grossRevenue) > 0.01
      ? rawItems.map((item) => ({
          ...item,
          total_price: Math.round((item.total_price / itemsRawSum) * grossRevenue * 100) / 100,
        }))
      : rawItems;

    await supabase.from('sale_items').delete().eq('sale_id', saleId);
    const { error: itemErr } = await supabase.from('sale_items').insert(items);
    if (itemErr === null) {
      result.saleItemsInserted += items.length;
    } else {
      log(`  ❌ Items #${v.numero}: ${itemErr.message}`);
    }
  }

  result.vendasProcessed++;
}

// ------------------------------------------------------------
// Cleanup helper (kept for --migrate flag)
// ------------------------------------------------------------

export async function cleanupOldRecords(
  supabase: SupabaseClient,
  log: (msg: string) => void,
): Promise<{ salesDeleted: number; itemsDeleted: number }> {
  log('🧹 Cleaning up old Conta Azul records...');

  // Paginate through all CA sales (the default PostgREST limit is 1000).
  const allIds: number[] = [];
  const PAGE = 1000;
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('sales')
      .select('sale_id')
      .eq('source', 'conta_azul')
      .order('sale_id', { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(`cleanupOldRecords: ${error.message}`);
    if (!data || data.length === 0) break;
    allIds.push(...(data.map((s) => s.sale_id as number)));
    if (data.length < PAGE) break;
    page++;
  }

  if (allIds.length === 0) {
    log('  No old records found.');
    return { salesDeleted: 0, itemsDeleted: 0 };
  }

  // Delete in batches to avoid URL length limits on IN clauses.
  let itemsDeleted = 0;
  let salesDeleted = 0;
  const BATCH = 200;
  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH);
    const { count: ic } = await supabase.from('sale_items').delete({ count: 'exact' }).in('sale_id', batch);
    const { count: sc } = await supabase.from('sales').delete({ count: 'exact' }).in('sale_id', batch);
    itemsDeleted += ic ?? 0;
    salesDeleted += sc ?? 0;
  }

  log(`  ✅ Deleted ${salesDeleted} sales + ${itemsDeleted} items`);
  return { salesDeleted, itemsDeleted };
}
