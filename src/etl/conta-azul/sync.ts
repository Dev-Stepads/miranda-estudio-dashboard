/**
 * Conta Azul → Supabase ETL sync (Hybrid: Recebiveis + Vendas API).
 *
 * Flow:
 * 1. Refresh access_token via ContaAzulTokenManager
 * 2. Fetch Contas a Receber for the date range (data_vencimento)
 *    → This determines which month each sale belongs to (matches Miranda's logic)
 * 3. Filter: keep only recebiveis "sem centro de custo" (loja física)
 *    → Excludes "VENDAS SITE" (Nuvemshop), "ADMINISTRATIVO", etc.
 * 4. Extract unique venda numbers from descriptions ("Venda 15698 / NFC-e:7195")
 * 5. For each venda, search via /v1/venda/busca?termo_busca=NUM to get UUID
 * 6. Fetch detail (/v1/venda/{id}) and items (/v1/venda/{id}/itens)
 * 7. Upsert into canonical tables using data_vencimento as sale_date
 *
 * Why this hybrid approach:
 * Miranda closes monthly revenue by receivable date (data_vencimento),
 * not by sale creation date. A sale created in February with a receivable
 * due in March counts as March revenue for Miranda. Using /v1/venda/busca
 * alone attributed sales to wrong months (R$ 14K vs R$ 83K expected).
 *
 * Rate limit: Conta Azul has spike arrest of 10 req/s.
 * We throttle to ~4 req/s to stay safe.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ContaAzulTokenManager } from '../../integrations/conta-azul/auth.ts';
import {
  RawContaAzulVendaDetalheSchema,
  VendaItensResponseSchema,
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
  recebiveisFetched: number;
  vendasFound: number;
  vendasProcessed: number;
  vendasNotFound: number;
  customersUpserted: number;
  salesUpserted: number;
  saleItemsInserted: number;
  errors: number;
  durationMs: number;
}

// ------------------------------------------------------------
// Throttle helper
// ------------------------------------------------------------

const THROTTLE_MS = 250; // ~4 req/s

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// Payment type map
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// API base
// ------------------------------------------------------------

const BASE = 'https://api-v2.contaazul.com/v1';

// ------------------------------------------------------------
// Receivable item shape (from /financeiro/.../contas-a-receber/buscar)
// ------------------------------------------------------------

interface RecebItem {
  id: string;
  status: string;
  total: number;
  descricao: string;
  data_vencimento: string;
  pago: number;
  nao_pago: number;
  centros_de_custo?: Array<{ id: string; nome: string }>;
  cliente?: { id: string; nome: string };
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
  let recebiveisFetched = 0;
  let vendasFound = 0;
  let vendasProcessed = 0;
  let vendasNotFound = 0;
  let customersUpserted = 0;
  let salesUpserted = 0;
  let saleItemsInserted = 0;
  let errors = 0;

  // 1. Get access token
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

  const accessToken = await tokenManager.getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'Miranda Dashboard ETL (dev@stepads.com.br)',
  };

  // ============================================================
  // PHASE 1: Fetch Contas a Receber (receivables) for the period
  // ============================================================
  log(`\n🔄 Fetching Contas a Receber (data_vencimento ${dataInicial} → ${dataFinal})...`);

  const allRecebiveis: RecebItem[] = [];
  let page = 1;

  while (true) {
    await sleep(THROTTLE_MS);
    const url = `${BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?data_vencimento_de=${dataInicial}&data_vencimento_ate=${dataFinal}&tamanho_pagina=200&pagina=${page}`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      log(`  ❌ Recebiveis page ${page}: HTTP ${resp.status}`);
      break;
    }

    const json = await resp.json() as { itens_totais: number; itens: RecebItem[] };
    if (json.itens.length === 0) break;

    allRecebiveis.push(...json.itens);
    log(`  Page ${page}: ${json.itens.length} recebiveis (total: ${allRecebiveis.length}/${json.itens_totais})`);

    if (allRecebiveis.length >= json.itens_totais) break;
    page++;
  }

  recebiveisFetched = allRecebiveis.length;

  // ============================================================
  // PHASE 2: Filter recebiveis — keep only loja física
  // ============================================================
  // "sem centro de custo" = loja física (PDV, balcão, link de pagamento)
  // Only keep recebiveis with NO center assigned — all named centers are
  // either Nuvemshop (VENDAS SITE), admin (ADMINISTRATIVO), consignment
  // (CONSIGNAÇÃO/ATAKADO), or other revenue (RECEITA MIRA - MIRAGEM).
  // Miranda's R$ 82.944,79 for March matches "sem centro" pago (R$ 79.934)
  // plus some items. We keep only "sem centro" to stay closest to their number.
  const lojaRecebiveis = allRecebiveis.filter(r => {
    const centros = r.centros_de_custo ?? [];
    return centros.length === 0;
  });

  // Only keep recebiveis that reference a venda
  const vendaRecebiveis = lojaRecebiveis.filter(r => /Venda \d+/.test(r.descricao));

  // Group by venda number — deduplicate parcelas
  const vendaGroups = new Map<number, {
    recebiveis: RecebItem[];
    earliestDate: string;
    totalPago: number;
    totalValor: number;
  }>();

  for (const r of vendaRecebiveis) {
    const match = r.descricao.match(/Venda (\d+)/);
    if (!match) continue;
    const num = parseInt(match[1]!, 10);

    const group = vendaGroups.get(num) ?? {
      recebiveis: [],
      earliestDate: r.data_vencimento,
      totalPago: 0,
      totalValor: 0,
    };

    group.recebiveis.push(r);
    group.totalPago += r.pago;
    group.totalValor += r.total;
    if (r.data_vencimento < group.earliestDate) {
      group.earliestDate = r.data_vencimento;
    }

    vendaGroups.set(num, group);
  }

  log(`\n  Total recebiveis: ${allRecebiveis.length}`);
  log(`  Loja física (excl SITE + ADMIN): ${lojaRecebiveis.length}`);
  log(`  Com ref a venda: ${vendaRecebiveis.length}`);
  log(`  Vendas únicas: ${vendaGroups.size}`);
  log(`  Sum(pago): R$ ${[...vendaGroups.values()].reduce((s, g) => s + g.totalPago, 0).toFixed(2)}\n`);

  // ============================================================
  // PHASE 3: For each venda, search → detail → items → upsert
  // ============================================================
  const vendaNums = [...vendaGroups.keys()].sort((a, b) => a - b);
  const BATCH_LOG_INTERVAL = 20;

  for (let i = 0; i < vendaNums.length; i++) {
    const num = vendaNums[i]!;
    const group = vendaGroups.get(num)!;

    try {
      // Search for venda by number (wide date range to find vendas from any month)
      await sleep(THROTTLE_MS);
      const searchResp = await fetch(
        `${BASE}/venda/busca?data_inicio=2024-01-01&data_fim=2027-01-01&situacoes=APPROVED&termo_busca=${num}&tamanho_pagina=50`,
        { headers },
      );

      if (!searchResp.ok) {
        // Try without status filter
        await sleep(THROTTLE_MS);
        const retryResp = await fetch(
          `${BASE}/venda/busca?data_inicio=2024-01-01&data_fim=2027-01-01&termo_busca=${num}&tamanho_pagina=50`,
          { headers },
        );
        if (!retryResp.ok) {
          log(`  ❌ Search #${num}: HTTP ${retryResp.status}`);
          vendasNotFound++;
          errors++;
          continue;
        }
        const retryJson = await retryResp.json() as { itens: Array<{ id: string; numero: number; total: number; data: string; origem?: string | null }> };
        const match = retryJson.itens.find(v => v.numero === num);
        if (!match) {
          vendasNotFound++;
          continue;
        }
        // Use this match
        await processVenda(match.id, num, group, supabase, headers, log);
        continue;
      }

      const searchJson = await searchResp.json() as { itens: Array<{ id: string; numero: number; total: number; data: string; origem?: string | null }> };
      const vendaMatch = searchJson.itens.find(v => v.numero === num);

      if (!vendaMatch) {
        vendasNotFound++;
        // Still create a sale record from recebivel data alone (no items)
        await createSaleFromRecebivel(num, group, supabase, log);
        continue;
      }

      vendasFound++;
      await processVenda(vendaMatch.id, num, group, supabase, headers, log);

    } catch (err) {
      log(`  ❌ Venda #${num}: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
    }

    // Progress log
    if ((i + 1) % BATCH_LOG_INTERVAL === 0 || i === vendaNums.length - 1) {
      log(`  📦 ${i + 1}/${vendaNums.length} vendas (${salesUpserted} sales, ${saleItemsInserted} items, ${vendasNotFound} not found)`);
    }
  }

  const durationMs = Date.now() - start;
  log(`\n✅ Conta Azul sync complete: ${salesUpserted} sales, ${saleItemsInserted} items, ${customersUpserted} customers, ${vendasNotFound} not found, ${errors} errors, ${(durationMs / 1000).toFixed(1)}s`);

  return { recebiveisFetched, vendasFound, vendasProcessed, vendasNotFound, customersUpserted, salesUpserted, saleItemsInserted, errors, durationMs };

  // ============================================================
  // Inner functions (close over counters and supabase)
  // ============================================================

  async function processVenda(
    vendaId: string,
    vendaNum: number,
    group: { earliestDate: string; totalPago: number; totalValor: number },
    sb: SupabaseClient,
    hdrs: Record<string, string>,
    lg: (msg: string) => void,
  ): Promise<void> {
    // Fetch detail
    await sleep(THROTTLE_MS);
    const detailResp = await fetch(`${BASE}/venda/${vendaId}`, { headers: hdrs });
    if (!detailResp.ok) {
      lg(`  ❌ Detail #${vendaNum}: HTTP ${detailResp.status}`);
      errors++;
      return;
    }

    const detailJson = await detailResp.json();
    const detailParsed = RawContaAzulVendaDetalheSchema.safeParse(detailJson);
    if (!detailParsed.success) {
      lg(`  ❌ Detail #${vendaNum}: validation — ${detailParsed.error.issues[0]?.message ?? '?'} at ${detailParsed.error.issues[0]?.path?.join('.') ?? '?'}`);
      errors++;
      return;
    }
    const detail = detailParsed.data;

    // Fetch items
    await sleep(THROTTLE_MS);
    const itemsResp = await fetch(`${BASE}/venda/${vendaId}/itens`, { headers: hdrs });
    let vendaItems: Array<{ nome: string; quantidade: number; valor: number; id_item?: string }> = [];
    if (itemsResp.ok) {
      const itemsJson = await itemsResp.json();
      const itemsParsed = VendaItensResponseSchema.safeParse(itemsJson);
      if (itemsParsed.success) {
        vendaItems = itemsParsed.data.itens;
      }
    }

    // Extract data
    // NOTE: Conta Azul naming is counterintuitive:
    //   valor_bruto = sum of product unit prices (subtotal)
    //   valor_liquido = final amount customer pays (subtotal - discount + frete)
    const composicao = detail.venda?.composicao_valor;
    const grossRevenue = group.totalPago;
    const netRevenue = composicao?.valor_bruto ?? grossRevenue;
    const paymentType = detail.venda?.condicao_pagamento?.tipo_pagamento;
    const customerDoc = detail.cliente?.documento;
    const customerName = detail.cliente?.nome;
    // Use recebivel date as sale_date (matches Miranda's monthly attribution)
    const saleDate = group.earliestDate;

    // Store raw payload
    await sb.from('raw_contaazul_sales').upsert(
      {
        source_id: vendaId,
        payload: { venda_id: vendaId, numero: vendaNum, detail: detailJson, recebivel_date: saleDate },
      },
      { onConflict: 'source_id' },
    );

    // Upsert customer
    const customerSourceId = customerDoc || detail.cliente?.uuid;
    if (customerSourceId && customerName) {
      const { error: custErr } = await sb
        .from('customers')
        .upsert(
          {
            source: 'conta_azul',
            source_customer_id: customerSourceId,
            name: customerName,
            gender: 'unknown',
            age_range: 'unknown',
            state: null,
            city: null,
            email: null,
            phone: null,
          },
          { onConflict: 'source,source_customer_id' },
        );
      if (custErr === null) customersUpserted++;
    }

    // Resolve customer FK
    let customerId: number | null = null;
    if (customerSourceId) {
      const { data: custData } = await sb
        .from('customers')
        .select('customer_id')
        .eq('source', 'conta_azul')
        .eq('source_customer_id', customerSourceId)
        .limit(1);
      customerId = custData?.[0]?.customer_id as number | null ?? null;
    }

    // Upsert sale (use venda UUID as source_sale_id, recebivel date as sale_date)
    const { data: saleData, error: saleErr } = await sb
      .from('sales')
      .upsert(
        {
          source: 'conta_azul',
          source_sale_id: vendaId,
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
      lg(`  ❌ Sale upsert #${vendaNum}: ${saleErr.message}`);
      errors++;
      return;
    }

    const saleId = saleData?.[0]?.sale_id as number | undefined;
    if (saleId !== undefined) {
      salesUpserted++;

      if (vendaItems.length > 0) {
        const items = vendaItems
          .filter(item => item.quantidade > 0)
          .map(item => ({
            sale_id: saleId,
            product_name: item.nome,
            sku: item.id_item || null,
            quantity: item.quantidade,
            unit_price: item.valor,
            total_price: item.valor * item.quantidade,
          }));

        await sb.from('sale_items').delete().eq('sale_id', saleId);
        const { error: itemErr } = await sb.from('sale_items').insert(items);
        if (itemErr === null) {
          saleItemsInserted += items.length;
        } else {
          lg(`  ❌ Items #${vendaNum}: ${itemErr.message}`);
        }
      }
    }

    vendasProcessed++;
  }

  async function createSaleFromRecebivel(
    vendaNum: number,
    group: { earliestDate: string; totalPago: number; totalValor: number; recebiveis: RecebItem[] },
    sb: SupabaseClient,
    lg: (msg: string) => void,
  ): Promise<void> {
    // Create sale record from recebivel data (no items available)
    // Use pago as revenue — if nothing was paid, skip (not yet realized revenue)
    const saleDate = group.earliestDate;
    const grossRevenue = group.totalPago;
    const clienteName = group.recebiveis[0]?.cliente?.nome;
    const clienteId = group.recebiveis[0]?.cliente?.id;

    // Upsert customer if available
    let customerId: number | null = null;
    if (clienteId && clienteName) {
      await sb.from('customers').upsert(
        {
          source: 'conta_azul',
          source_customer_id: clienteId,
          name: clienteName,
          gender: 'unknown',
          age_range: 'unknown',
          state: null,
          city: null,
          email: null,
          phone: null,
        },
        { onConflict: 'source,source_customer_id' },
      );

      const { data: custData } = await sb
        .from('customers')
        .select('customer_id')
        .eq('source', 'conta_azul')
        .eq('source_customer_id', clienteId)
        .limit(1);
      customerId = custData?.[0]?.customer_id as number | null ?? null;
    }

    // Use "receb-{vendaNum}" as source_sale_id since we don't have the venda UUID
    const sourceId = `receb-${vendaNum}`;

    const { data: saleData, error: saleErr } = await sb
      .from('sales')
      .upsert(
        {
          source: 'conta_azul',
          source_sale_id: sourceId,
          sale_date: saleDate,
          gross_revenue: grossRevenue,
          net_revenue: grossRevenue,
          status: 'paid',
          customer_id: customerId,
          payment_method: 'outros',
        },
        { onConflict: 'source,source_sale_id' },
      )
      .select('sale_id');

    if (saleErr === null && saleData?.[0]) {
      salesUpserted++;
      vendasProcessed++;
    } else if (saleErr) {
      lg(`  ❌ Recebivel-only #${vendaNum}: ${saleErr.message}`);
      errors++;
    }
  }
}

/**
 * Delete old records before re-sync. Handles both NF-e (44-char) and
 * venda UUID records. Call with --migrate flag.
 */
export async function cleanupOldRecords(
  supabase: SupabaseClient,
  log: (msg: string) => void,
): Promise<{ salesDeleted: number; itemsDeleted: number }> {
  log('🧹 Cleaning up old Conta Azul records...');

  const { data: oldSales } = await supabase
    .from('sales')
    .select('sale_id')
    .eq('source', 'conta_azul')
    .limit(10000);

  if (!oldSales || oldSales.length === 0) {
    log('  No old records found.');
    return { salesDeleted: 0, itemsDeleted: 0 };
  }

  const saleIds = oldSales.map((s) => s.sale_id as number);

  const { count: itemsCount } = await supabase
    .from('sale_items')
    .delete({ count: 'exact' })
    .in('sale_id', saleIds);

  const { count: salesCount } = await supabase
    .from('sales')
    .delete({ count: 'exact' })
    .in('sale_id', saleIds);

  const itemsDeleted = itemsCount ?? 0;
  const salesDeleted = salesCount ?? 0;

  log(`  ✅ Deleted ${salesDeleted} sales + ${itemsDeleted} items`);
  return { salesDeleted, itemsDeleted };
}
