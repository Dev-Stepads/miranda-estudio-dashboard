import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * LGPD Webhook: Store Redact
 *
 * Called by Nuvemshop 48h after the merchant (Miranda) uninstalls our app.
 * We must delete ALL data belonging to that store from our database.
 *
 * This is the nuclear option — deletes everything from Nuvemshop source.
 * Conta Azul and Meta Ads data are NOT affected.
 *
 * Must respond 2xx within 3 seconds. Actual deletion runs inline since
 * we don't have a background queue — but the deletes are fast (batched).
 */

function verifyHmac(rawBody: string, signature: string | null): boolean {
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-linkedstore-hmac-sha256');

  if (!verifyHmac(rawBody, signature)) {
    console.log('[LGPD] store-redact: invalid HMAC, rejected');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { store_id?: number };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log(`[LGPD] store-redact: store=${body.store_id} — DELETING ALL NUVEMSHOP DATA`);

  try {
    const sb = getSupabase();

    // Order matters: delete children before parents (FK constraints)

    // 1. Get all NS sale IDs to delete their items
    const { data: nsSales } = await sb
      .from('sales')
      .select('sale_id')
      .eq('source', 'nuvemshop')
      .limit(100000);

    const saleIds = (nsSales ?? []).map(s => s.sale_id as number);

    // 2. Delete sale_items in batches
    let itemsDeleted = 0;
    for (let i = 0; i < saleIds.length; i += 500) {
      const batch = saleIds.slice(i, i + 500);
      const { count } = await sb
        .from('sale_items')
        .delete({ count: 'exact' })
        .in('sale_id', batch);
      itemsDeleted += count ?? 0;
    }

    // 3. Delete sales
    const { count: salesDeleted } = await sb
      .from('sales')
      .delete({ count: 'exact' })
      .eq('source', 'nuvemshop');

    // 4. Delete abandoned checkouts (all are from Nuvemshop)
    const { count: checkoutsDeleted } = await sb
      .from('abandoned_checkouts')
      .delete({ count: 'exact' })
      .not('source_checkout_id', 'is', null);

    // 5. Delete customers
    const { count: customersDeleted } = await sb
      .from('customers')
      .delete({ count: 'exact' })
      .eq('source', 'nuvemshop');

    // 6. Delete raw tables
    await sb.from('raw_nuvemshop_orders').delete().not('source_id', 'is', null);
    await sb.from('raw_nuvemshop_customers').delete().not('source_id', 'is', null);
    await sb.from('raw_nuvemshop_abandoned_checkouts').delete().not('source_id', 'is', null);

    console.log(
      `[LGPD] store-redact complete: ${salesDeleted} sales, ${itemsDeleted} items, ` +
      `${customersDeleted} customers, ${checkoutsDeleted} checkouts deleted`
    );

    return NextResponse.json({ status: 'redacted' });
  } catch (err) {
    console.error('[LGPD] store-redact error:', err);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
