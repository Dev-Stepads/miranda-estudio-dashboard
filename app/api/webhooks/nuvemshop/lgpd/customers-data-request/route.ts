import { NextResponse } from 'next/server';

/**
 * LGPD Webhook: Customers Data Request
 *
 * Called by Nuvemshop when a customer requests a copy of their data
 * (right of access under LGPD/GDPR).
 * We must respond with all data we hold about that customer.
 *
 * For now: acknowledges with 200 OK and logs the event.
 * TODO: implement actual data export.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();

    // TODO: validate HMAC-SHA256 signature
    // TODO: extract customer identifiers from body
    // TODO: query and return all data we hold:
    //   - customers row
    //   - sales associated with that customer
    //   - sale_items from those sales
    //   - abandoned_checkouts

    console.log('[LGPD] Customers data request webhook received:', JSON.stringify(body).slice(0, 200));

    return NextResponse.json({
      status: 'received',
      message: 'Data export will be processed. Full implementation pending.',
    }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
