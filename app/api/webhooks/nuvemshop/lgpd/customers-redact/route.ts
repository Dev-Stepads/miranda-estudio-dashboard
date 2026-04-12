import { NextResponse } from 'next/server';

/**
 * LGPD Webhook: Customers Redact
 *
 * Called by Nuvemshop when a specific customer requests data deletion
 * (right to be forgotten under LGPD/GDPR).
 * We must delete all data belonging to that customer from our database.
 *
 * For now: acknowledges with 200 OK and logs the event.
 * TODO: implement actual customer data deletion.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();

    // TODO: validate HMAC-SHA256 signature
    // TODO: extract customer identifiers from body
    // TODO: delete from:
    //   - customers WHERE source='nuvemshop' AND source_customer_id = <id>
    //   - sales WHERE customer_id = <resolved_id> (or set customer_id = null)
    //   - raw_nuvemshop_customers WHERE source_id = <id>

    console.log('[LGPD] Customers redact webhook received:', JSON.stringify(body).slice(0, 200));

    return NextResponse.json({ status: 'received' }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
