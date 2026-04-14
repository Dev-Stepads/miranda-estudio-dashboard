/**
 * Conta Azul → Supabase ETL sync.
 *
 * Flow:
 * 1. Refresh access_token via ContaAzulTokenManager (rotates refresh_token)
 * 2. List NF-e from /v1/notas-fiscais with date range
 * 3. For each NF-e, fetch XML detail via /v1/notas-fiscais/{chave_acesso}
 * 4. Parse XML → extract customer, items, totals, payment
 * 5. Upsert into canonical tables (customers, sales, sale_items)
 * 6. Insert raw XML into raw_contaazul_sales
 *
 * Rate limit: Conta Azul has spike arrest of 10 req/s.
 * We throttle to ~5 req/s to stay safe.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ContaAzulTokenManager } from '../../integrations/conta-azul/auth.ts';
import { parseNfeXml } from '../../integrations/conta-azul/nfe-parser.ts';

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
  nfeFetched: number;
  nfeParsed: number;
  customersUpserted: number;
  salesUpserted: number;
  saleItemsInserted: number;
  errors: number;
  durationMs: number;
}

// ------------------------------------------------------------
// Throttle helper (respect 10 req/s spike arrest)
// ------------------------------------------------------------

const THROTTLE_MS = 200; // 5 req/s

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// Payment code map for DB
// ------------------------------------------------------------

const PAYMENT_NAMES: Record<string, string> = {
  '01': 'dinheiro', '02': 'cheque', '03': 'credito', '04': 'debito',
  '05': 'credito_loja', '10': 'vale_alimentacao', '11': 'vale_refeicao',
  '12': 'vale_presente', '13': 'vale_combustivel', '14': 'duplicata',
  '15': 'boleto', '16': 'deposito', '17': 'pix',
  '18': 'transferencia', '19': 'fidelidade', '90': 'sem_pagamento',
  '99': 'outros',
};

function mapPaymentForDb(code: string): string {
  return PAYMENT_NAMES[code] ?? 'outros';
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
  let nfeFetched = 0;
  let nfeParsed = 0;
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
    'User-Agent': 'Miranda Dashboard (dev@stepads.com.br)',
  };

  // 2. List NF-e (API has a 15-day max window, so we chunk the date range)
  log(`\n🔄 Listing NF-e from ${dataInicial} to ${dataFinal}...`);
  log(`  (API limit: 15 days per window — will chunk automatically)`);

  const allChaves: string[] = [];
  const MAX_WINDOW_DAYS = 14; // stay under 15

  // Break date range into 14-day windows
  let windowStart = new Date(dataInicial + 'T00:00:00');
  const endDate = new Date(dataFinal + 'T00:00:00');

  while (windowStart <= endDate) {
    // Subtract 1 day from the raw offset so the window is inclusive on both ends.
    // Without this, NF-e on chunk boundaries were skipped (24h gap).
    const windowEnd = new Date(Math.min(
      windowStart.getTime() + (MAX_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000,
      endDate.getTime(),
    ));

    const wStart = windowStart.toISOString().split('T')[0]!;
    const wEnd = windowEnd.toISOString().split('T')[0]!;

    // Paginate within each window (page size seems fixed at 10)
    let page = 1;
    while (true) {
      const url = `https://api-v2.contaazul.com/v1/notas-fiscais?data_inicial=${wStart}&data_final=${wEnd}&pagina=${page}`;
      const resp = await fetch(url, { headers });

      if (!resp.ok) {
        const body = await resp.text();
        log(`  ❌ Window ${wStart}→${wEnd} page ${page}: HTTP ${resp.status} — ${body.slice(0, 100)}`);
        break;
      }

      const json = await resp.json() as { itens?: Array<{ chave_acesso: string; status: string }> };
      const itens = json.itens ?? [];

      for (const item of itens) {
        if (item.status === 'EMITIDA' || item.status === 'CORRIGIDA COM SUCESSO') {
          allChaves.push(item.chave_acesso);
        }
      }

      log(`  ${wStart}→${wEnd} p${page}: ${itens.length} NF-e (${allChaves.length} total)`);

      if (itens.length === 0) break;
      page++;
      await sleep(THROTTLE_MS);
    }

    // Move to next window
    windowStart = new Date(windowEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  log(`  Total NF-e to process: ${allChaves.length}\n`);

  // 3. Fetch detail + parse + upsert for each NF-e
  const BATCH_LOG_INTERVAL = 10;

  for (let i = 0; i < allChaves.length; i++) {
    const chave = allChaves[i]!;

    try {
      // Fetch XML
      const xmlResp = await fetch(
        `https://api-v2.contaazul.com/v1/notas-fiscais/${chave}`,
        { headers },
      );

      if (!xmlResp.ok) {
        log(`  ❌ NF-e ${chave.slice(0, 20)}...: HTTP ${xmlResp.status}`);
        errors++;
        await sleep(THROTTLE_MS);
        continue;
      }

      const xml = await xmlResp.text();
      nfeFetched++;

      // Save raw XML before parsing so failed parses are recoverable
      await supabase.from('raw_contaazul_sales').upsert(
        { source_id: chave, payload: { xml_length: xml.length, raw_xml_saved: true } },
        { onConflict: 'source_id' },
      );

      // Parse XML
      const nfe = parseNfeXml(xml, chave);
      nfeParsed++;

      // 4. Upsert customer
      if (nfe.customer.cpfCnpj) {
        const { error: custErr } = await supabase
          .from('customers')
          .upsert(
            {
              source: 'conta_azul',
              source_customer_id: nfe.customer.cpfCnpj,
              name: nfe.customer.nome,
              gender: 'unknown',
              age_range: 'unknown',
              state: nfe.customer.uf,
              city: nfe.customer.cidade,
              email: nfe.customer.email,
              phone: nfe.customer.telefone,
            },
            { onConflict: 'source,source_customer_id' },
          );

        if (custErr === null) customersUpserted++;
      }

      // Resolve customer_id FK
      let customerId: number | null = null;
      if (nfe.customer.cpfCnpj) {
        const { data: custData } = await supabase
          .from('customers')
          .select('customer_id')
          .eq('source', 'conta_azul')
          .eq('source_customer_id', nfe.customer.cpfCnpj)
          .limit(1);

        customerId = custData?.[0]?.customer_id as number | null ?? null;
      }

      // 5. Upsert sale
      const { data: saleData, error: saleErr } = await supabase
        .from('sales')
        .upsert(
          {
            source: 'conta_azul',
            source_sale_id: nfe.chaveAcesso,
            sale_date: nfe.dataEmissao,
            gross_revenue: nfe.totalNota,
            net_revenue: nfe.totalProdutos,
            status: 'paid',
            customer_id: customerId,
            payment_method: mapPaymentForDb(nfe.paymentCode),
          },
          { onConflict: 'source,source_sale_id' },
        )
        .select('sale_id');

      if (saleErr !== null) {
        log(`  ❌ Sale upsert NF ${nfe.numeroNota}: ${saleErr.message}`);
        errors++;
        await sleep(THROTTLE_MS);
        continue;
      }

      const saleId = saleData?.[0]?.sale_id as number | undefined;
      if (saleId !== undefined) {
        salesUpserted++;

        // Delete old items + insert new. If insert fails, re-insert old items
        // to avoid leaving the sale with 0 items.
        if (nfe.items.length > 0) {
          const items = nfe.items
            .filter(item => item.quantidade > 0)
            .map(item => ({
              sale_id: saleId,
              product_name: item.nome,
              sku: item.sku || null,
              quantity: item.quantidade,
              unit_price: item.precoUnitario,
              total_price: item.precoTotal,
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
            log(`  ❌ Items NF ${nfe.numeroNota}: ${itemErr.message}`);
            // Rollback: re-insert old items so sale doesn't stay empty
            if (oldItems && oldItems.length > 0) {
              const restore = oldItems.map(({ item_id, ...rest }) => rest);
              await supabase.from('sale_items').insert(restore);
            }
          }
        }
      }

      // 6. Update raw with parsed data (pre-parse stub was saved above)
      await supabase.from('raw_contaazul_sales').upsert(
        { source_id: nfe.chaveAcesso, payload: { xml_length: xml.length, numero_nota: nfe.numeroNota, parsed: nfe } },
        { onConflict: 'source_id' },
      );

      // Progress log
      if ((i + 1) % BATCH_LOG_INTERVAL === 0 || i === allChaves.length - 1) {
        log(`  📦 ${i + 1}/${allChaves.length} NF-e processed (${salesUpserted} sales, ${saleItemsInserted} items)`);
      }

      await sleep(THROTTLE_MS);

    } catch (err) {
      log(`  ❌ NF-e ${chave.slice(0, 20)}...: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
      await sleep(THROTTLE_MS);
    }
  }

  const durationMs = Date.now() - start;
  log(`\n✅ Conta Azul sync complete: ${salesUpserted} sales, ${saleItemsInserted} items, ${customersUpserted} customers, ${errors} errors, ${durationMs}ms`);

  return { nfeFetched, nfeParsed, customersUpserted, salesUpserted, saleItemsInserted, errors, durationMs };
}
