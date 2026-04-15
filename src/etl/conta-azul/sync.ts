/**
 * Conta Azul → Supabase ETL sync (via Sales API).
 *
 * Flow:
 * 1. Refresh access_token via ContaAzulTokenManager
 * 2. Paginate /v1/venda/busca for the date range
 * 3. Skip vendas with origem="Nuvem Shop" (already handled by NS ETL)
 * 4. For each venda, fetch detail (/v1/venda/{id}) and items (/v1/venda/{id}/itens)
 * 5. Upsert into canonical tables (customers, sales, sale_items)
 * 6. Store raw payload in raw_contaazul_sales
 *
 * This replaces the old NF-e based sync that only captured ~25% of
 * physical store sales. See DECISOES.txt 2026-04-14c (T49).
 *
 * Rate limit: Conta Azul has spike arrest of 10 req/s.
 * We throttle to ~4 req/s to stay safe (each venda = 2-3 calls).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ContaAzulTokenManager } from '../../integrations/conta-azul/auth.ts';
import {
  VendaBuscaResponseSchema,
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
  vendasFetched: number;
  vendasProcessed: number;
  vendasSkippedNuvemshop: number;
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
  let vendasFetched = 0;
  let vendasProcessed = 0;
  let vendasSkippedNuvemshop = 0;
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
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'Miranda Dashboard ETL (dev@stepads.com.br)',
  };

  // 2. Paginate /v1/venda/busca
  log(`\n🔄 Listing vendas from ${dataInicial} to ${dataFinal}...`);

  interface VendaListItem {
    id: string;
    data: string;
    total: number;
    numero: number;
    origem?: string | null;
    cliente?: { id: string; nome: string; email?: string | null } | null;
    situacao?: { nome: string };
  }

  const allVendas: VendaListItem[] = [];
  let page = 1;
  const PAGE_SIZE = 200;

  while (true) {
    const url = `${BASE}/venda/busca?data_inicio=${dataInicial}&data_fim=${dataFinal}&situacoes=APPROVED&tamanho_pagina=${PAGE_SIZE}&pagina=${page}`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      const body = await resp.text();
      log(`  ❌ Page ${page}: HTTP ${resp.status} — ${body.slice(0, 200)}`);
      break;
    }

    const json = await resp.json();
    const parsed = VendaBuscaResponseSchema.safeParse(json);
    if (!parsed.success) {
      log(`  ❌ Page ${page}: validation error — ${parsed.error.message.slice(0, 200)}`);
      break;
    }

    const items = parsed.data.itens;
    if (items.length === 0) break;

    allVendas.push(...items);
    log(`  Page ${page}: ${items.length} vendas (total: ${allVendas.length})`);

    if (items.length < PAGE_SIZE) break;
    page++;
    await sleep(THROTTLE_MS);
  }

  // Filter: skip Nuvemshop vendas (case-insensitive to guard against API variations)
  const lojaVendas = allVendas.filter(v => {
    if (v.origem && v.origem.toLowerCase().includes('nuvem')) {
      vendasSkippedNuvemshop++;
      return false;
    }
    return true;
  });

  vendasFetched = allVendas.length;
  log(`\n  Total from API: ${allVendas.length}`);
  log(`  Skipped (Nuvem Shop): ${vendasSkippedNuvemshop}`);
  log(`  To process (loja fisica): ${lojaVendas.length}\n`);

  // 3. Process each venda: fetch detail + items + upsert
  const BATCH_LOG_INTERVAL = 10;

  for (let i = 0; i < lojaVendas.length; i++) {
    const venda = lojaVendas[i]!;

    try {
      // Fetch detail
      await sleep(THROTTLE_MS);
      const detailResp = await fetch(`${BASE}/venda/${venda.id}`, { headers });
      if (!detailResp.ok) {
        log(`  ❌ Detail #${venda.numero}: HTTP ${detailResp.status}`);
        errors++;
        continue;
      }

      const detailJson = await detailResp.json();
      const detailParsed = RawContaAzulVendaDetalheSchema.safeParse(detailJson);
      if (!detailParsed.success) {
        log(`  ❌ Detail #${venda.numero}: validation error — ${detailParsed.error.issues[0]?.message ?? 'unknown'} at ${detailParsed.error.issues[0]?.path?.join('.') ?? '?'}`);
        errors++;
        continue;
      }
      const detail = detailParsed.data;

      // Fetch items
      await sleep(THROTTLE_MS);
      const itemsResp = await fetch(`${BASE}/venda/${venda.id}/itens`, { headers });
      if (!itemsResp.ok) {
        log(`  ❌ Items #${venda.numero}: HTTP ${itemsResp.status}`);
        errors++;
        continue;
      }

      const itemsJson = await itemsResp.json();
      const itemsParsed = VendaItensResponseSchema.safeParse(itemsJson);
      if (!itemsParsed.success) {
        log(`  ❌ Items #${venda.numero}: validation error — ${itemsParsed.error.issues[0]?.message ?? 'unknown'} at ${itemsParsed.error.issues[0]?.path?.join('.') ?? '?'}`);
        errors++;
        continue;
      }
      const vendaItems = itemsParsed.data.itens;

      // Extract data
      // NOTE: Conta Azul naming is counterintuitive:
      //   valor_bruto = sum of product unit prices (subtotal)
      //   valor_liquido = final amount customer pays (subtotal - discount + frete)
      // Our mapping: gross_revenue = what customer pays (valor_liquido),
      //              net_revenue = product subtotal (valor_bruto)
      const composicao = detail.venda?.composicao_valor;
      const grossRevenue = composicao?.valor_liquido ?? venda.total;
      const netRevenue = composicao?.valor_bruto ?? venda.total;
      const paymentType = detail.venda?.condicao_pagamento?.tipo_pagamento;
      const customerDoc = detail.cliente?.documento;
      const customerName = detail.cliente?.nome ?? venda.cliente?.nome;
      const vendedorName = detail.vendedor?.nome ?? 'unknown';

      // Store raw payload
      await supabase.from('raw_contaazul_sales').upsert(
        {
          source_id: venda.id,
          payload: { venda_id: venda.id, numero: venda.numero, detail: detailJson, items: itemsJson },
        },
        { onConflict: 'source_id' },
      );

      // Upsert customer
      const customerSourceId = customerDoc || detail.cliente?.uuid || venda.cliente?.id;
      if (customerSourceId && customerName) {
        const { error: custErr } = await supabase
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
              email: venda.cliente?.email ?? null,
              phone: null,
            },
            { onConflict: 'source,source_customer_id' },
          );

        if (custErr === null) customersUpserted++;
      }

      // Resolve customer_id FK
      let customerId: number | null = null;
      if (customerSourceId) {
        const { data: custData } = await supabase
          .from('customers')
          .select('customer_id')
          .eq('source', 'conta_azul')
          .eq('source_customer_id', customerSourceId)
          .limit(1);

        customerId = custData?.[0]?.customer_id as number | null ?? null;
      }

      // Upsert sale (use venda UUID as source_sale_id)
      const { data: saleData, error: saleErr } = await supabase
        .from('sales')
        .upsert(
          {
            source: 'conta_azul',
            source_sale_id: venda.id,
            sale_date: venda.data,
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
        log(`  ❌ Sale upsert #${venda.numero}: ${saleErr.message}`);
        errors++;
        continue;
      }

      const saleId = saleData?.[0]?.sale_id as number | undefined;
      if (saleId !== undefined) {
        salesUpserted++;

        // Delete old items + insert new (same pattern as NF-e sync)
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

          // Snapshot old items before deleting
          const { data: oldItems } = await supabase
            .from('sale_items')
            .select('*')
            .eq('sale_id', saleId);

          await supabase.from('sale_items').delete().eq('sale_id', saleId);

          const { error: itemErr } = await supabase.from('sale_items').insert(items);
          if (itemErr === null) {
            saleItemsInserted += items.length;
          } else {
            log(`  ❌ Items #${venda.numero}: ${itemErr.message}`);
            // Rollback: re-insert old items
            if (oldItems && oldItems.length > 0) {
              const restore = oldItems.map(({ sale_item_id, ...rest }) => rest);
              await supabase.from('sale_items').insert(restore);
            }
          }
        }
      }

      vendasProcessed++;

      // Progress log
      if ((i + 1) % BATCH_LOG_INTERVAL === 0 || i === lojaVendas.length - 1) {
        log(`  📦 ${i + 1}/${lojaVendas.length} vendas processed (${salesUpserted} sales, ${saleItemsInserted} items) [vendedor: ${vendedorName}]`);
      }

    } catch (err) {
      log(`  ❌ Venda #${venda.numero}: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
    }
  }

  const durationMs = Date.now() - start;
  log(`\n✅ Conta Azul sync complete: ${salesUpserted} sales, ${saleItemsInserted} items, ${customersUpserted} customers, ${errors} errors, ${(durationMs / 1000).toFixed(1)}s`);

  return { vendasFetched, vendasProcessed, vendasSkippedNuvemshop, customersUpserted, salesUpserted, saleItemsInserted, errors, durationMs };
}

/**
 * Delete old NF-e based records before first venda sync.
 * Old records used chave_acesso (44-char) as source_sale_id.
 * New records use venda UUID. Both coexisting would cause double-counting.
 */
export async function cleanupOldNfeRecords(
  supabase: SupabaseClient,
  log: (msg: string) => void,
): Promise<{ salesDeleted: number; itemsDeleted: number }> {
  log('🧹 Cleaning up old NF-e based Conta Azul records...');

  // Find old NF-e sales (source_sale_id is 44 chars = chave_acesso)
  const { data: oldSales } = await supabase
    .from('sales')
    .select('sale_id, source_sale_id')
    .eq('source', 'conta_azul')
    .limit(10000);

  const nfeSales = (oldSales ?? []).filter(
    (s) => typeof s.source_sale_id === 'string' && (s.source_sale_id as string).length === 44,
  );

  if (nfeSales.length === 0) {
    log('  No old NF-e records found.');
    return { salesDeleted: 0, itemsDeleted: 0 };
  }

  const saleIds = nfeSales.map((s) => s.sale_id as number);

  // Delete items first (FK constraint)
  const { count: itemsCount } = await supabase
    .from('sale_items')
    .delete({ count: 'exact' })
    .in('sale_id', saleIds);

  // Delete sales
  const { count: salesCount } = await supabase
    .from('sales')
    .delete({ count: 'exact' })
    .in('sale_id', saleIds);

  const itemsDeleted = itemsCount ?? 0;
  const salesDeleted = salesCount ?? 0;

  log(`  ✅ Deleted ${salesDeleted} old NF-e sales + ${itemsDeleted} items`);
  return { salesDeleted, itemsDeleted };
}
