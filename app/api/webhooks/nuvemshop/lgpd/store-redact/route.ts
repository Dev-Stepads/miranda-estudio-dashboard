import { NextResponse } from 'next/server';

/**
 * LGPD Webhook: Store Redact
 *
 * Called by Nuvemshop 48h after the merchant uninstalls our app.
 * We must delete ALL data belonging to that store from our database.
 *
 * For now: acknowledges the webhook with 200 OK and logs the event.
 * TODO: implement actual data deletion from canonical + raw tables.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();

    // TODO: validate HMAC-SHA256 signature using NUVEMSHOP_CLIENT_SECRET
    // TODO: delete all data for the store_id from:
    //   - sales (source='nuvemshop')
    //   - sale_items (via sale_id FK cascade)
    //   - customers (source='nuvemshop')
    //   - abandoned_checkouts
    //   - raw_nuvemshop_* tables

    console.log('[LGPD] Store redact webhook received:', JSON.stringify(body).slice(0, 200));

    return NextResponse.json({ status: 'received' }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
