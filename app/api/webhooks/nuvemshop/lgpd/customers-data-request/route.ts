import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * LGPD Webhook: Customers Data Request
 *
 * Called by Nuvemshop when a customer requests a copy of their data
 * (right of access under LGPD/GDPR Art. 18). We return all data we
 * hold about that customer. Nuvemshop forwards it to the customer.
 *
 * Must respond 2xx within 3 seconds.
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
    console.log('[LGPD] customers-data-request: invalid HMAC, rejected');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { store_id?: number; id?: number | string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const customerId = String(body.id ?? '');
  if (!customerId) {
    return NextResponse.json({ error: 'Missing customer id' }, { status: 400 });
  }

  console.log(`[LGPD] customers-data-request: store=${body.store_id} customer=${customerId}`);

  try {
    const sb = getSupabase();

    // Find customer
    const { data: customer } = await sb
      .from('customers')
      .select('*')
      .eq('source', 'nuvemshop')
      .eq('source_customer_id', customerId)
      .limit(1);

    const cust = customer?.[0];
    if (!cust) {
      return NextResponse.json({ status: 'no_data', message: 'No data found for this customer' });
    }

    // Find their sales
    const { data: sales } = await sb
      .from('sales')
      .select('sale_id, source_sale_id, sale_date, gross_revenue, net_revenue, status, payment_method')
      .eq('source', 'nuvemshop')
      .eq('customer_id', cust.customer_id)
      .limit(10000);

    // Find sale items
    const saleIds = (sales ?? []).map(s => s.sale_id as number);
    let saleItems: Record<string, unknown>[] = [];
    if (saleIds.length > 0) {
      const { data } = await sb
        .from('sale_items')
        .select('sale_id, product_name, sku, quantity, unit_price, total_price')
        .in('sale_id', saleIds)
        .limit(10000);
      saleItems = data ?? [];
    }

    // Find abandoned checkouts
    const { data: checkouts } = await sb
      .from('abandoned_checkouts')
      .select('*')
      .eq('customer_id', cust.customer_id)
      .limit(1000);

    return NextResponse.json({
      status: 'data_export',
      customer: cust,
      sales: sales ?? [],
      sale_items: saleItems,
      abandoned_checkouts: checkouts ?? [],
    });
  } catch (err) {
    console.error('[LGPD] customers-data-request error:', err);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
