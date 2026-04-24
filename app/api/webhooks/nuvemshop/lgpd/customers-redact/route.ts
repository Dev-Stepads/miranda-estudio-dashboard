import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * LGPD Webhook: Customers Redact
 *
 * Called by Nuvemshop when a customer requests data deletion
 * (right to be forgotten under LGPD/GDPR Art. 18).
 * We delete all PII for that customer but preserve anonymized
 * sales data for financial reporting integrity.
 *
 * Must respond 2xx within 3 seconds.
 */

function verifyHmac(rawBody: string, signature: string | null): boolean {
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== signature.length) return false;
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
    console.log('[LGPD] customers-redact: invalid HMAC, rejected');
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

  console.log(`[LGPD] customers-redact: store=${body.store_id} customer=${customerId}`);

  try {
    const sb = getSupabase();

    // Find customer to get internal ID
    const { data: customer } = await sb
      .from('customers')
      .select('customer_id')
      .eq('source', 'nuvemshop')
      .eq('source_customer_id', customerId)
      .limit(1);

    const cust = customer?.[0];
    if (!cust) {
      // No data to delete — still return 200 (idempotent)
      return NextResponse.json({ status: 'no_data' });
    }

    const internalId = cust.customer_id as number;

    // Find this customer's sales to clean raw order payloads
    const { data: custSales } = await sb
      .from('sales')
      .select('source_sale_id')
      .eq('customer_id', internalId)
      .eq('source', 'nuvemshop')
      .limit(100000);

    // Anonymize sales (keep financial data, remove customer link)
    await sb
      .from('sales')
      .update({ customer_id: null })
      .eq('customer_id', internalId)
      .eq('source', 'nuvemshop');

    // Delete abandoned checkouts (contains PII: name, email, phone)
    // By customer_id (linked checkouts)
    await sb
      .from('abandoned_checkouts')
      .delete()
      .eq('customer_id', internalId);

    // Also by contact_email (unlinked checkouts where customer_id is null)
    const { data: custRecord } = await sb
      .from('customers')
      .select('email')
      .eq('customer_id', internalId)
      .limit(1);
    const custEmail = custRecord?.[0]?.email as string | null;
    if (custEmail) {
      await sb
        .from('abandoned_checkouts')
        .delete()
        .is('customer_id', null)
        .eq('contact_email', custEmail);
    }

    // Delete raw order payloads that contain this customer's PII
    const saleSourceIds = (custSales ?? [])
      .map(s => s.source_sale_id as string)
      .filter(Boolean);
    for (let i = 0; i < saleSourceIds.length; i += 500) {
      const batch = saleSourceIds.slice(i, i + 500);
      await sb.from('raw_nuvemshop_orders').delete().in('source_id', batch);
    }

    // Delete raw customer data
    await sb
      .from('raw_nuvemshop_customers')
      .delete()
      .eq('source_id', customerId);

    // Delete the customer record
    await sb
      .from('customers')
      .delete()
      .eq('customer_id', internalId);

    console.log(`[LGPD] customers-redact: deleted customer ${customerId} (internal ${internalId})`);

    return NextResponse.json({ status: 'redacted' });
  } catch (err) {
    console.error('[LGPD] customers-redact error:', err);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
